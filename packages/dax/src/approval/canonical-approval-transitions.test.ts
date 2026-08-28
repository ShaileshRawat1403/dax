import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdirSync, rmSync } from "node:fs"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Identifier } from "@/id/id"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import {
  createEventAuthorityRun,
  getEventAuthorityState,
  transitionEventAuthority,
} from "@/state/events/event-transitions"
import { appendRunEventAtTail, readRunEvents } from "@/state/events/run-event-store"
import { ApprovalStore } from "./approval-store"
import { ApprovalTransitions } from "./approval-transitions"
import { Permission } from "@/governance"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
let testHome = ""
let previousTestHome: string | undefined

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-canonical-approval-${crypto.randomUUID()}`)
  process.env.DAX_TEST_HOME = testHome
  mkdirSync(testHome, { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  rmSync(testHome, { recursive: true, force: true })
})

async function runningRun(title: string) {
  const session = await Session.create({ title })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Exercise canonical approval replay." } } },
    session.id,
  )
  await ContractGuardian.create(session.id, contract)
  await Session.bindGoverningRun(session.id, session.id)
  await createEventAuthorityRun(session.id, contract.contractId)
  await transitionEventAuthority(session.id, "queued", "execution_queued", {})
  await transitionEventAuthority(session.id, "running", "execution_started", {})
  return { session, contract }
}

async function waitForPending(count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const pending = await Permission.list()
    if (pending.length === count) return pending
    await Bun.sleep(10)
  }
  return Permission.list()
}

describe("canonical approval authority", () => {
  test("request and resolution replay the complete operator-visible decision without ApprovalStore", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session } = await runningRun("Approval replay")
        const approval = await ApprovalTransitions.create({
          runId: session.id,
          stepId: "step_review",
          type: "command_execute",
          risk: "high",
          title: "Approve verification command",
          reason: "The command crosses a governed boundary.",
          expectedConsequence: "The command may write generated output.",
          context: {
            stepId: "step_review",
            command: "bun test",
            toolName: "shell",
            notes: ["operator-visible"],
          },
          source: "permission",
        })

        let state = await getEventAuthorityState(session.id)
        expect(state?.status).toBe("waiting_approval")
        expect(state?.approvals[0]).toMatchObject({
          approvalId: approval.approvalId,
          approvalType: "command_execute",
          risk: "high",
          title: "Approve verification command",
          reason: "The command crosses a governed boundary.",
          expectedConsequence: "The command may write generated output.",
          stepId: "step_review",
          context: { command: "bun test", toolName: "shell", notes: ["operator-visible"] },
          source: "permission",
          status: "pending",
        })

        await ApprovalTransitions.approve(session.id, approval.approvalId, "operator-1", "Reviewed and allowed")
        state = await getEventAuthorityState(session.id)
        expect(state?.status).toBe("running")
        expect(state?.approvals[0]).toMatchObject({
          status: "approved",
          decidedBy: "operator-1",
          comment: "Reviewed and allowed",
        })

        const eventsBeforeStoreRemoval = await readRunEvents(session.id)
        expect(eventsBeforeStoreRemoval.filter((event) => event.type === "approval_requested")).toHaveLength(1)
        expect(eventsBeforeStoreRemoval.filter((event) => event.type === "approval_resolved")).toHaveLength(1)

        // Canonical replay is sufficient even when the compatibility store is absent.
        const { Storage } = await import("@/storage/storage")
        await Storage.remove(["approvals", Instance.project.id, session.id])
        const replayed = await getEventAuthorityState(session.id)
        expect(replayed?.approvals[0]).toMatchObject({
          status: "approved",
          decidedBy: "operator-1",
          comment: "Reviewed and allowed",
        })
      },
    })
  })

  test("expiration and cancellation are terminal canonical decisions", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const first = await runningRun("Approval expiry")
        const expiring = await ApprovalTransitions.create({
          runId: first.session.id,
          type: "workflow_gate",
          risk: "medium",
          title: "Timed gate",
          reason: "No operator response arrived.",
        })
        await ApprovalTransitions.expire(first.session.id, expiring.approvalId)
        expect((await getEventAuthorityState(first.session.id))?.approvals[0]?.status).toBe("expired")

        const second = await runningRun("Approval cancellation")
        const cancelling = await ApprovalTransitions.create({
          runId: second.session.id,
          type: "workflow_gate",
          risk: "medium",
          title: "Cancelled gate",
          reason: "The operation was withdrawn.",
        })
        await ApprovalTransitions.cancel(second.session.id, cancelling.approvalId)
        expect((await getEventAuthorityState(second.session.id))?.approvals[0]?.status).toBe("cancelled")
      },
    })
  })

  test("canonical admission precedes compatibility storage and a failed store write is retryable", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session } = await runningRun("Approval retry")
        const add = spyOn(ApprovalStore, "add").mockImplementationOnce(async () => {
          throw new Error("compatibility store unavailable")
        })
        const input = {
          runId: session.id,
          type: "tool_use" as const,
          risk: "medium" as const,
          title: "Approve tool",
          reason: "Retry canonical-first persistence.",
          source: "system" as const,
        }

        await expect(ApprovalTransitions.create(input)).rejects.toThrow("compatibility store unavailable")
        expect((await readRunEvents(session.id)).filter((event) => event.type === "approval_requested")).toHaveLength(1)

        add.mockRestore()
        await expect(ApprovalTransitions.create({ ...input, title: "Changed authority request" })).rejects.toThrow(
          "does not match the requested authority fact",
        )
        const approval = await ApprovalTransitions.create(input)
        expect(await ApprovalStore.get(session.id, approval.approvalId)).not.toBeNull()
        expect((await readRunEvents(session.id)).filter((event) => event.type === "approval_requested")).toHaveLength(1)
      },
    })
  })

  test("semantic rejection occurs before contradictory approval history is persisted", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session } = await runningRun("Approval semantic admission")
        const before = await readRunEvents(session.id)
        await expect(
          appendRunEventAtTail(session.id, {
            type: "approval_resolved",
            payload: { approvalId: "apr_unknown", decision: "approved" },
          }),
        ).rejects.toThrow("unknown approval")
        expect(await readRunEvents(session.id)).toEqual(before)

        await transitionEventAuthority(session.id, "completed", "run_completed", {})
        await expect(
          ApprovalTransitions.create({
            runId: session.id,
            type: "tool_use",
            risk: "low",
            title: "Too late",
            reason: "Terminal runs cannot request authority.",
          }),
        ).rejects.toThrow("terminal run")
        expect(await ApprovalStore.pending(session.id)).toEqual([])
      },
    })
  })

  test("a governed child permission is requested and resolved under its governing run without Gateway", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session: parent } = await runningRun("Child permission authority")
        const child = await Session.fork({ sessionID: parent.id })
        const requestID = Identifier.ascending("permission")
        const waiting = Permission.ask({
          id: requestID,
          sessionID: child.id,
          permission: "shell",
          patterns: ["bun test"],
          always: ["bun test"],
          metadata: { command: "bun test" },
          ruleset: Permission.fromConfig({ shell: "ask" } as never),
        })

        const pending = await waitForPending(1)
        expect(pending.map((item) => item.id)).toContain(requestID)
        const parentState = await getEventAuthorityState(parent.id)
        expect(parentState?.approvals).toHaveLength(1)
        expect(parentState?.approvals[0]).toMatchObject({
          source: "permission",
          context: { originalPermissionId: requestID, command: "bun test", toolName: "shell" },
          status: "pending",
        })
        expect(await readRunEvents(child.id)).toEqual([])

        const resolve = spyOn(ApprovalStore, "resolve").mockImplementationOnce(async () => {
          throw new Error("compatibility resolution unavailable")
        })
        await expect(Permission.reply({ requestID, reply: "once", message: "Proceed" })).rejects.toThrow(
          "compatibility resolution unavailable",
        )
        expect((await Permission.list()).map((item) => item.id)).toContain(requestID)
        expect((await getEventAuthorityState(parent.id))?.approvals[0]).toMatchObject({
          status: "approved",
          comment: "Proceed",
        })

        resolve.mockRestore()
        await expect(Permission.reply({ requestID, reply: "once", message: "Different decision context" })).rejects.toThrow(
          "does not match the requested authority fact",
        )
        await Permission.reply({ requestID, reply: "once", message: "Proceed" })
        await waiting
        expect((await getEventAuthorityState(parent.id))?.approvals[0]).toMatchObject({
          status: "approved",
          comment: "Proceed",
        })
      },
    })
  })

  test("an explicit governing reference with no contract fails closed before entering pending state", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const missingRun = Identifier.ascending("session")
        const child = await Session.createNext({
          directory: repoRoot,
          title: "Broken authority child",
          governingRunId: missingRun,
        })
        await expect(
          Permission.ask({
            sessionID: child.id,
            permission: "shell",
            patterns: ["bun test"],
            always: ["bun test"],
            metadata: {},
            ruleset: Permission.fromConfig({ shell: "ask" } as never),
          }),
        ).rejects.toThrow("Governing ExecutionContract not found")
        expect(await Permission.list()).toEqual([])
      },
    })
  })
})
