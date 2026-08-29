import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { compileWithRunId } from "./compiler"
import { ContractGuardian } from "./contract-guardian"
import { createEventAuthorityRun, getEventAuthorityState, transitionEventAuthority } from "@/state/events/event-transitions"
import { readRunEvents } from "@/state/events/run-event-store"
import {
  beginNativeInvocation,
  completeNativeAuthorization,
  discardNativeSettlement,
  finalizeNativeResult,
  noteNativePolicyDecision,
  settleNativeAuthorization,
} from "./native-settlement"
import { NativeMutationObservationError } from "./native-mutation-observation"
import { Global } from "@/global"
import { Snapshot } from "@/snapshot"
import { createMutationReceipt } from "@/sdlc/mutation-receipt"
import { recordNativeMutation } from "@/state/events/event-transitions"

let testHome = ""
let project = ""
let previousTestHome: string | undefined

const COMPLETED = {
  status: "completed" as const,
  result: {
    basis: "validated_dax_result_pre_truncation" as const,
    canonicalization: "sorted-json-v1" as const,
    digest: `sha256:${"a".repeat(64)}`,
    redactedPreview: "{}",
    truncated: false,
  },
}

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-native-mutation-${crypto.randomUUID()}`)
  project = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  await fs.mkdir(project, { recursive: true })
  await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
  await $`git init`.quiet().cwd(project)
  await fs.writeFile(path.join(project, "baseline.txt"), "baseline\n")
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  await fs.rm(testHome, { recursive: true, force: true })
})

async function createGovernedRun(title: string) {
  const session = await Session.create({ title })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Modify one workspace file and report the result." } } },
    session.id,
  )
  contract.toolAllowlist = ["write", "shell"]
  await ContractGuardian.create(session.id, contract)
  await createEventAuthorityRun(session.id, contract.contractId)
  await transitionEventAuthority(session.id, "queued", "execution_queued", {})
  await transitionEventAuthority(session.id, "running", "execution_started", {})
  return session
}

async function authorize(sessionID: string, invocationId: string, toolId = "write") {
  await beginNativeInvocation({
    sessionID,
    invocationId,
    toolId,
    executor: { kind: "builtin", id: toolId },
    args: toolId === "write" ? { filePath: "changed.txt", content: "changed\n" } : { command: "true" },
  })
  await settleNativeAuthorization(invocationId, {
    finalDisposition: "allowed",
    runtimeGuardDisposition: "allowed",
    permissionDisposition: "allowed",
    approvalIds: [],
    reasonCodes: [],
  })
}

describe("canonical native mutation observation", () => {
  test("records a full kernel-derived receipt before the terminal tool result", async () => {
    await Instance.provide({
      directory: project,
      async fn() {
        const session = await createGovernedRun("Native mutation receipt")
        const invocationId = "call_mutation_receipt"
        await authorize(session.id, invocationId)
        await fs.writeFile(path.join(project, "changed.txt"), "changed\n")
        await finalizeNativeResult(invocationId, COMPLETED)

        const events = await readRunEvents(session.id)
        const mutation = events.find((event) => event.type === "mutation_recorded")
        const result = events.find((event) => event.type === "tool_result_recorded")
        expect(mutation).toBeDefined()
        expect(mutation!.seq).toBeLessThan(result!.seq)
        expect(mutation!.payload).toMatchObject({
          basis: "native_snapshot_diff_v1",
          observationWindowInvocationIds: [invocationId],
          receipt: {
            schemaVersion: "dax.sdlc.mutation.v1",
            runId: session.id,
            proofType: "workspace_diff",
            source: "dax",
            changedPaths: ["changed.txt"],
          },
        })
        const receipt = (mutation!.payload as { receipt: { receiptId: string; digest: string } }).receipt
        expect(receipt.receiptId).toBeTruthy()
        expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/)

        const state = await getEventAuthorityState(session.id)
        expect(state?.governance.touchedFiles).toContain("changed.txt")
        expect(state?.governance.mutationReceiptIds).toContain(receipt.receiptId)
        expect(state?.governance.verification.required).toBe(true)
      },
    })
  })

  test("a successful no-change execution records a result but no mutation", async () => {
    await Instance.provide({
      directory: project,
      async fn() {
        const session = await createGovernedRun("Native no-change observation")
        const invocationId = "call_no_change"
        await authorize(session.id, invocationId, "shell")
        await finalizeNativeResult(invocationId, COMPLETED)

        const events = await readRunEvents(session.id)
        expect(events.some((event) => event.type === "mutation_recorded")).toBe(false)
        expect(events.some((event) => event.type === "tool_result_recorded")).toBe(true)
      },
    })
  })

  test("overlapping invocations are correlated as one observation window, not falsely attributed", async () => {
    await Instance.provide({
      directory: project,
      async fn() {
        const session = await createGovernedRun("Parallel mutation window")
        await authorize(session.id, "call_parallel_a")
        await authorize(session.id, "call_parallel_b")
        await fs.writeFile(path.join(project, "a.txt"), "a\n")
        await fs.writeFile(path.join(project, "b.txt"), "b\n")

        await finalizeNativeResult("call_parallel_a", COMPLETED)
        await finalizeNativeResult("call_parallel_b", COMPLETED)

        const mutations = (await readRunEvents(session.id)).filter((event) => event.type === "mutation_recorded")
        expect(mutations).toHaveLength(1)
        expect(mutations[0]!.payload).toMatchObject({
          observationWindowInvocationIds: ["call_parallel_a", "call_parallel_b"],
          receipt: { changedPaths: ["a.txt", "b.txt"] },
        })
      },
    })
  })

  test("diff observation failure remains authorized and uncertain with no false receipt or result", async () => {
    await Instance.provide({
      directory: project,
      async fn() {
        const session = await createGovernedRun("Mutation observation failure")
        const invocationId = "call_observation_failure"
        await authorize(session.id, invocationId)
        await fs.writeFile(path.join(project, "changed.txt"), "changed\n")
        await fs.rm(path.join(Global.Path.data, "snapshot", Instance.project.id), { recursive: true, force: true })

        await expect(finalizeNativeResult(invocationId, COMPLETED)).rejects.toBeInstanceOf(
          NativeMutationObservationError,
        )
        const events = await readRunEvents(session.id)
        expect(events.some((event) => event.type === "mutation_recorded")).toBe(false)
        expect(events.some((event) => event.type === "tool_result_recorded")).toBe(false)
        expect((await getEventAuthorityState(session.id))?.invocations?.[invocationId]).toMatchObject({
          status: "authorized",
          resultEventId: null,
        })
        discardNativeSettlement(invocationId)
      },
    })
  })

  test("baseline observation failure prevents a potentially mutating executor from starting", async () => {
    await Instance.provide({
      directory: project,
      async fn() {
        const session = await createGovernedRun("Mutation baseline failure")
        const invocationId = "call_baseline_failure"
        await beginNativeInvocation({
          sessionID: session.id,
          invocationId,
          toolId: "write",
          executor: { kind: "builtin", id: "write" },
          args: { filePath: "must-not-exist.txt", content: "blocked\n" },
        })
        noteNativePolicyDecision(invocationId, {
          finalDisposition: "allowed",
          runtimeGuardDisposition: "allowed",
          permissionDisposition: "allowed",
          approvalIds: [],
          reasonCodes: [],
        })

        const track = spyOn(Snapshot, "track").mockResolvedValue(undefined)
        let executorEntered = false
        try {
          await expect(async () => {
            await completeNativeAuthorization(invocationId)
            executorEntered = true
            await fs.writeFile(path.join(project, "must-not-exist.txt"), "blocked\n")
          }).toThrow(NativeMutationObservationError)
          await expect(completeNativeAuthorization(invocationId)).rejects.toBeInstanceOf(
            NativeMutationObservationError,
          )
        } finally {
          track.mockRestore()
        }

        expect(executorEntered).toBe(false)
        await expect(fs.stat(path.join(project, "must-not-exist.txt"))).rejects.toThrow()
        const events = await readRunEvents(session.id)
        expect(events.some((event) => event.type === "authorization_recorded")).toBe(true)
        expect(events.some((event) => event.type === "mutation_recorded")).toBe(false)
        expect(events.some((event) => event.type === "tool_result_recorded")).toBe(false)
        expect((await getEventAuthorityState(session.id))?.invocations?.[invocationId]).toMatchObject({
          status: "authorized",
          resultEventId: null,
        })
        discardNativeSettlement(invocationId)
      },
    })
  })

  test("rejects invalid native mutation authority before persisting the event", async () => {
    await Instance.provide({
      directory: project,
      async fn() {
        const session = await createGovernedRun("Mutation admission")
        const receipt = createMutationReceipt({
          runId: session.id,
          changedPaths: ["unattributed.txt"],
          diff: "diff --git a/unattributed.txt b/unattributed.txt\n",
        })

        await expect(recordNativeMutation(session.id, receipt, ["call_missing"])).rejects.toThrow(
          /unknown invocation/i,
        )
        expect((await readRunEvents(session.id)).some((event) => event.type === "mutation_recorded")).toBe(false)
      },
    })
  })
})
