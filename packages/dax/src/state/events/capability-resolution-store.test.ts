import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { nativeCapabilities } from "@/capability/registry"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import {
  beginNativeInvocation,
  isNativeSettlementPending,
  NativeSettlementAppendError,
} from "@/execution/native-settlement"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Storage } from "@/storage/storage"
import {
  createEventAuthorityRun,
  getEventAuthorityState,
  recordAuthorization,
  recordCapabilityResolution,
  recordToolInvocation,
} from "./event-transitions"
import { appendRunEventAtTail, projectRunStateFromEvents, readRunEvents } from "./run-event-store"

/**
 * The record-only resolution at the real event store. A resolution the reducer
 * would reject must be rejected under the run lock before it is persisted: an
 * invalid record written first and rejected on the next read would leave a
 * journal that can no longer be replayed.
 */

let home = ""
let directory = ""
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-resolution-store-"))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory, { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

const INPUT = {
  basis: "validated_tool_input" as const,
  canonicalization: "sorted-json-v1" as const,
  digest: `sha256:${"a".repeat(64)}`,
  redactedPreview: "{}",
  truncated: false,
}

async function born() {
  const session = await Session.create({ title: "Resolution store" })
  const { contract } = compileWithRunId({ request: { intent: { input: "Read one file." } } }, session.id)
  contract.toolAllowlist = []
  contract.toolBlocklist = []
  await ContractGuardian.create(session.id, contract)
  await createEventAuthorityRun(session.id, contract.contractId)
  return { runId: session.id, contractId: contract.contractId }
}

function resolution(subjectId: string, contractId: string) {
  return {
    subjectId,
    enforcement: "record_only" as const,
    path: "native_tool" as const,
    initiator: "model" as const,
    capabilityId: "native.tool.read",
    enrolled: true,
    basis: "v1_contract" as const,
    contractId,
    decision: "allow" as const,
  }
}

async function invoke(runId: string, contractId: string, invocationId: string) {
  await recordToolInvocation(runId, invocationId, {
    toolId: "read",
    contractId,
    executor: { kind: "builtin", id: "read" },
    input: INPUT,
  })
}

async function authorize(runId: string, invocationId: string) {
  await recordAuthorization(runId, invocationId, {
    finalDisposition: "allowed",
    contractDisposition: "allowed",
    runtimeGuardDisposition: "allowed",
    permissionDisposition: "allowed",
    approvalIds: [],
    reasonCodes: [],
  })
}

/** The append must fail, leave the stored journal byte-for-byte as it was, and leave it replayable. */
async function expectRejectedWithoutPersistence(runId: string, append: () => Promise<unknown>, message: string) {
  const before = await readRunEvents(runId)
  let rejected: unknown
  await append().catch((error) => {
    rejected = error
  })
  expect(rejected).toBeInstanceOf(Error)
  expect(String(rejected)).toContain(message)
  expect(await readRunEvents(runId)).toEqual(before)
  expect(await projectRunStateFromEvents(runId)).not.toBeNull()
}

describe("record-only resolutions are validated under the run lock before persistence", () => {
  test("a valid resolution is persisted and replays", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { runId, contractId } = await born()
        await invoke(runId, contractId, "inv_ok")
        await recordCapabilityResolution(runId, resolution("inv_ok", contractId))
        await authorize(runId, "inv_ok")
        const state = await projectRunStateFromEvents(runId)
        expect(state?.capabilityResolutions.map((record) => record.subjectId)).toEqual(["inv_ok"])
        expect(state?.invocations["inv_ok"]?.status).toBe("authorized")
      },
    })
  })

  test("a resolution for an unknown invocation is not persisted", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { runId, contractId } = await born()
        await expectRejectedWithoutPersistence(
          runId,
          () => recordCapabilityResolution(runId, resolution("inv_unknown", contractId)),
          "unknown invocation",
        )
      },
    })
  })

  test("a resolution after its invocation's authorization is not persisted", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { runId, contractId } = await born()
        await invoke(runId, contractId, "inv_late")
        await authorize(runId, "inv_late")
        await expectRejectedWithoutPersistence(
          runId,
          () => recordCapabilityResolution(runId, resolution("inv_late", contractId)),
          "must precede its authorization",
        )
      },
    })
  })

  test("a resolution naming another contract is not persisted", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { runId, contractId } = await born()
        await invoke(runId, contractId, "inv_contract")
        await expectRejectedWithoutPersistence(
          runId,
          () => recordCapabilityResolution(runId, resolution("inv_contract", "ctr_someone_else")),
          "does not match run contract",
        )
      },
    })
  })

  test("a resolution whose correlation is not its subject is not persisted", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { runId, contractId } = await born()
        await invoke(runId, contractId, "inv_correlation")
        await invoke(runId, contractId, "inv_other")
        await expectRejectedWithoutPersistence(
          runId,
          () =>
            appendRunEventAtTail(runId, {
              type: "capability_resolution_recorded",
              payload: resolution("inv_correlation", contractId),
              correlationId: "inv_other",
              commandId: "cmd_capability_resolution_crossed",
            }),
          "correlation does not match",
        )
      },
    })
  })

  test("a second resolution for one subject under a different command is not persisted", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { runId, contractId } = await born()
        await invoke(runId, contractId, "inv_twice")
        await recordCapabilityResolution(runId, resolution("inv_twice", contractId))
        await expectRejectedWithoutPersistence(
          runId,
          () =>
            appendRunEventAtTail(runId, {
              type: "capability_resolution_recorded",
              payload: resolution("inv_twice", contractId),
              correlationId: "inv_twice",
              commandId: "cmd_capability_resolution_again",
            }),
          "already recorded",
        )
      },
    })
  })

  test("a storage failure writing a tool's resolution refuses the invocation and leaves no resolution", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const { runId } = await born()
        const original = Storage.write
        let injected = false
        const write = spyOn(Storage, "write").mockImplementation((async (key: string[], value: unknown) => {
          if (
            key[0] === "run_events" &&
            Array.isArray(value) &&
            (value.at(-1) as { type?: string } | undefined)?.type === "capability_resolution_recorded"
          ) {
            injected = true
            throw new Error("injected resolution write failure")
          }
          return original(key, value)
        }) as typeof Storage.write)
        let reached = false
        let failure: unknown
        try {
          await beginNativeInvocation({
            sessionID: runId,
            invocationId: "inv_write_failure",
            toolId: "read",
            executor: { kind: "builtin", id: "read" },
            capability: nativeCapabilities.require("native.tool.read"),
            args: {},
          })
          reached = true
        } catch (error) {
          failure = error
        } finally {
          write.mockRestore()
        }
        expect(injected).toBe(true)
        expect(failure).toBeInstanceOf(NativeSettlementAppendError)
        expect(failure).toMatchObject({ stage: "capability_resolution" })
        // The caller never reaches the point where it would run the executor.
        expect(reached).toBe(false)
        expect(isNativeSettlementPending("inv_write_failure")).toBe(false)
        const state = await getEventAuthorityState(runId)
        expect(state?.invocations?.["inv_write_failure"]).toMatchObject({
          status: "awaiting_authorization",
          authorizationEventId: null,
        })
        const events = await readRunEvents(runId)
        expect(events.some((event) => event.type === "capability_resolution_recorded")).toBe(false)
        expect(events.some((event) => event.type === "authorization_recorded")).toBe(false)
      },
    })
  })
})
