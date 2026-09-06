import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdirSync, rmSync } from "node:fs"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import { createEventAuthorityRun, transitionEventAuthority, getEventAuthorityState } from "@/state/events/event-transitions"
import * as EventTransitions from "@/state/events/event-transitions"
import { readRunEvents } from "@/state/events/run-event-store"
import {
  beginNativeInvocation,
  settleNativeAuthorization,
  finalizeNativeResult,
  isNativeSettlementPending,
  discardNativeSettlement,
  NativeSettlementAppendError,
  NativeSettlementStateError,
  completeNativeAuthorization,
} from "./native-settlement"
import { governedAsk } from "./governed-ask"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { BatchTool } from "@/tool/batch"
import z from "zod"

let testHome = ""
let testProject = ""
let previousTestHome: string | undefined

async function runGit(cwd: string, args: string[]): Promise<void> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
}

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-native-settlement-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  testProject = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  mkdirSync(testHome, { recursive: true })
  mkdirSync(path.join(testHome, ".config", "dax"), { recursive: true })
  mkdirSync(testProject, { recursive: true })
  await Bun.write(path.join(testProject, "README.md"), "# Native settlement fixture\n")
  await runGit(testProject, ["init", "--quiet"])
  await runGit(testProject, ["add", "."])
  await runGit(testProject, [
    "-c",
    "user.name=DAX Tests",
    "-c",
    "user.email=dax@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ])
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  rmSync(testHome, { recursive: true, force: true })
})

async function createGovernedRun(title: string, toolAllowlist?: string[]) {
  const session = await Session.create({ title })
  const { contract } = compileWithRunId({ request: { intent: { input: "Read one file and report the result." } } }, session.id)
  if (toolAllowlist) contract.toolAllowlist = toolAllowlist
  await ContractGuardian.create(session.id, contract)
  await createEventAuthorityRun(session.id, contract.contractId)
  await transitionEventAuthority(session.id, "queued", "execution_queued", {})
  await transitionEventAuthority(session.id, "running", "execution_started", {})
  return { session, contract }
}

describe("native settlement crash windows", () => {
  test("invocation append failure throws and leaves no tracked state, so the executor never runs", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Invocation append failure")
        const spy = spyOn(EventTransitions, "recordToolInvocation").mockRejectedValue(new Error("disk full"))
        try {
          const invocationId = "call_crash_invocation"
          let executorRan = false
          await expect(
            (async () => {
              await beginNativeInvocation({
                sessionID: session.id,
                invocationId,
                toolId: "shell",
                executor: { kind: "builtin", id: "shell" },
                args: { command: "echo hi" },
              })
              executorRan = true
            })(),
          ).rejects.toThrow(NativeSettlementAppendError)
          expect(executorRan).toBe(false)
          expect(isNativeSettlementPending(invocationId)).toBe(false)
          expect((await readRunEvents(session.id)).some((event) => event.type === "tool_invocation_recorded")).toBe(false)
        } finally {
          spy.mockRestore()
        }
      },
    })
  })

  test("authorization append failure throws and leaves the invocation without an authorization event, so the caller must not proceed to an effect", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Authorization append failure")
        const invocationId = "call_crash_authorization"
        await beginNativeInvocation({
          sessionID: session.id,
          invocationId,
          toolId: "shell",
          executor: { kind: "builtin", id: "shell" },
          args: { command: "echo hi" },
        })

        const spy = spyOn(EventTransitions, "recordAuthorization").mockRejectedValue(new Error("disk full"))
        try {
          let effectRan = false
          await expect(
            (async () => {
              await settleNativeAuthorization(invocationId, {
                finalDisposition: "allowed",
                runtimeGuardDisposition: "allowed",
                permissionDisposition: "allowed",
                approvalIds: [],
                reasonCodes: [],
              })
              effectRan = true
            })(),
          ).rejects.toThrow(NativeSettlementAppendError)
          expect(effectRan).toBe(false)

          const state = await getEventAuthorityState(session.id)
          expect(state?.invocations?.[invocationId]).toMatchObject({ status: "awaiting_authorization", authorizationEventId: null })
        } finally {
          spy.mockRestore()
          discardNativeSettlement(invocationId)
        }
      },
    })
  })

  test("policy denial is terminal and contradictory re-authorization is rejected", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Denial durability")
        const invocationId = "call_crash_denied"
        await beginNativeInvocation({
          sessionID: session.id,
          invocationId,
          toolId: "shell",
          executor: { kind: "builtin", id: "shell" },
          args: { command: "echo hi" },
        })

        await settleNativeAuthorization(invocationId, {
          finalDisposition: "denied",
          runtimeGuardDisposition: "denied",
          permissionDisposition: "not_evaluated",
          approvalIds: [],
          reasonCodes: ["sensitive_path"],
        })

        const state = await getEventAuthorityState(session.id)
        expect(state?.invocations?.[invocationId]?.status).toBe("denied")

        await expect(
          settleNativeAuthorization(invocationId, {
            finalDisposition: "allowed",
            runtimeGuardDisposition: "allowed",
            permissionDisposition: "allowed",
            approvalIds: [],
            reasonCodes: [],
          }),
        ).rejects.toBeInstanceOf(NativeSettlementStateError)
        const events = await readRunEvents(session.id)
        expect(events.filter((event) => event.type === "authorization_recorded")).toHaveLength(1)
        expect((await readRunEvents(session.id)).some((event) => event.type === "tool_result_recorded")).toBe(false)
      },
    })
  })

  test("result append failure after a real success throws, and no automatic retry re-authorizes or re-records", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Result append failure")
        const invocationId = "call_crash_result"
        await beginNativeInvocation({
          sessionID: session.id,
          invocationId,
          toolId: "shell",
          executor: { kind: "builtin", id: "shell" },
          args: { command: "echo hi" },
        })
        await settleNativeAuthorization(invocationId, {
          finalDisposition: "allowed",
          runtimeGuardDisposition: "allowed",
          permissionDisposition: "allowed",
          approvalIds: [],
          reasonCodes: [],
        })

        const spy = spyOn(EventTransitions, "recordToolResult").mockRejectedValue(new Error("disk full"))
        try {
          await expect(
            finalizeNativeResult(invocationId, {
              status: "completed",
              result: {
                basis: "validated_dax_result_pre_truncation",
                canonicalization: "sorted-json-v1",
                digest: `sha256:${"b".repeat(64)}`,
                redactedPreview: "{}",
                truncated: false,
              },
            }),
          ).rejects.toThrow(NativeSettlementAppendError)
        } finally {
          spy.mockRestore()
        }

        // Projection remains authorized/outcome-unknown.
        const state = await getEventAuthorityState(session.id)
        expect(state?.invocations?.[invocationId]).toMatchObject({ status: "authorized", resultEventId: null })

        // The coordination entry remains as an execution fence. A repeated
        // dispatch with the same invocation identity is rejected before an
        // executor can run.
        expect(isNativeSettlementPending(invocationId)).toBe(true)
        await expect(
          beginNativeInvocation({
            sessionID: session.id,
            invocationId,
            toolId: "shell",
            executor: { kind: "builtin", id: "shell" },
            args: { command: "echo hi" },
          }),
        ).rejects.toThrow("already in progress")
        expect((await readRunEvents(session.id)).some((event) => event.type === "tool_result_recorded")).toBe(false)
        discardNativeSettlement(invocationId)
      },
    })
  })

  test("successful result append projects a completed invocation", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Successful settlement")
        const invocationId = "call_crash_success"
        await beginNativeInvocation({
          sessionID: session.id,
          invocationId,
          toolId: "shell",
          executor: { kind: "builtin", id: "shell" },
          args: { command: "echo hi" },
        })
        await settleNativeAuthorization(invocationId, {
          finalDisposition: "allowed",
          runtimeGuardDisposition: "allowed",
          permissionDisposition: "allowed",
          approvalIds: [],
          reasonCodes: [],
        })
        await finalizeNativeResult(invocationId, {
          status: "completed",
          result: {
            basis: "validated_dax_result_pre_truncation",
            canonicalization: "sorted-json-v1",
            digest: `sha256:${"d".repeat(64)}`,
            redactedPreview: "{}",
            truncated: false,
          },
        })

        const state = await getEventAuthorityState(session.id)
        expect(state?.invocations?.[invocationId]?.status).toBe("completed")
        expect(isNativeSettlementPending(invocationId)).toBe(false)
      },
    })
  })

  test("an invocation identity cannot be replayed with identical or changed execution facts", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Invocation identity fence")
        const invocationId = "call_identity_fence"
        await beginNativeInvocation({
          sessionID: session.id,
          invocationId,
          toolId: "read",
          executor: { kind: "builtin", id: "read" },
          args: { filePath: "a.txt" },
        })

        await expect(
          beginNativeInvocation({
            sessionID: session.id,
            invocationId,
            toolId: "read",
            executor: { kind: "builtin", id: "read" },
            args: { filePath: "a.txt" },
          }),
        ).rejects.toBeInstanceOf(NativeSettlementStateError)
        await expect(
          beginNativeInvocation({
            sessionID: session.id,
            invocationId,
            toolId: "shell",
            executor: { kind: "plugin", id: "different" },
            args: { command: "echo changed" },
          }),
        ).rejects.toBeInstanceOf(NativeSettlementStateError)

        const invocationEvents = (await readRunEvents(session.id)).filter(
          (event) => event.type === "tool_invocation_recorded",
        )
        expect(invocationEvents).toHaveLength(1)
        expect(invocationEvents[0]?.payload).toMatchObject({ toolId: "read" })
        discardNativeSettlement(invocationId)
      },
    })
  })

  test("canonical policy evaluation without pending coordination fails before policy runs", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Missing policy handoff")
        await expect(
          governedAsk({
            sessionID: session.id,
            agent: "build",
            toolID: "read",
            callID: "call_missing_handoff",
            messageID: "message_missing_handoff",
            req: { permission: "read", patterns: ["README.md"], always: ["*"], metadata: {} },
          }),
        ).rejects.toThrow("canonical invocation coordination is missing")
        expect((await readRunEvents(session.id)).some((event) => event.type === "authorization_recorded")).toBeFalse()
      },
    })
  })

  test("multiple policy checks form one final authorization and a later denial wins", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Combined policy denial")
        await Session.update(session.id, (draft) => {
          draft.permission = [
            { permission: "external_directory", pattern: "*", action: "allow" },
            { permission: "shell", pattern: "*", action: "deny" },
          ]
        })
        const invocationId = "call_combined_policy"
        await beginNativeInvocation({
          sessionID: session.id,
          invocationId,
          toolId: "shell",
          executor: { kind: "builtin", id: "shell" },
          args: { command: "echo test" },
        })

        await governedAsk({
          sessionID: session.id,
          agent: "build",
          toolID: "shell",
          callID: invocationId,
          messageID: "message_combined_policy",
          req: { permission: "external_directory", patterns: ["/tmp/*"], always: ["/tmp/*"], metadata: {} },
        })
        expect((await readRunEvents(session.id)).some((event) => event.type === "authorization_recorded")).toBeFalse()

        await expect(
          governedAsk({
            sessionID: session.id,
            agent: "build",
            toolID: "shell",
            callID: invocationId,
            messageID: "message_combined_policy",
            req: { permission: "shell", patterns: ["echo test"], always: ["echo *"], metadata: {} },
          }),
        ).rejects.toThrow()

        const authorizations = (await readRunEvents(session.id)).filter(
          (event) => event.type === "authorization_recorded",
        )
        expect(authorizations).toHaveLength(1)
        expect(authorizations[0]?.payload).toMatchObject({
          invocationId,
          finalDisposition: "denied",
          runtimeGuardDisposition: "allowed",
          permissionDisposition: "denied",
        })
        expect((await getEventAuthorityState(session.id))?.invocations?.[invocationId]?.status).toBe("denied")
      },
    })
  })

  test("allowed policy remains non-executable until the combined authorization is sealed", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Explicit authorization seal")
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: "read", pattern: "*", action: "allow" }]
        })
        const invocationId = "call_explicit_seal"
        await beginNativeInvocation({
          sessionID: session.id,
          invocationId,
          toolId: "read",
          executor: { kind: "builtin", id: "read" },
          args: { filePath: "README.md" },
        })
        await governedAsk({
          sessionID: session.id,
          agent: "build",
          toolID: "read",
          callID: invocationId,
          messageID: "message_explicit_seal",
          req: { permission: "read", patterns: ["README.md"], always: ["*"], metadata: {} },
        })
        expect((await getEventAuthorityState(session.id))?.invocations?.[invocationId]?.status).toBe(
          "awaiting_authorization",
        )
        await completeNativeAuthorization(invocationId)
        expect((await getEventAuthorityState(session.id))?.invocations?.[invocationId]?.status).toBe("authorized")
        discardNativeSettlement(invocationId)
      },
    })
  })

  test("contract denial is canonical and happens before runtime policy or execution", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { session } = await createGovernedRun("Contract leaf denial", ["read"])
        await expect(
          beginNativeInvocation({
            sessionID: session.id,
            invocationId: "call_contract_denied",
            toolId: "shell",
            executor: { kind: "builtin", id: "shell" },
            args: { command: "echo denied" },
          }),
        ).rejects.toThrow("contract_tool_denied")
        const state = await getEventAuthorityState(session.id)
        expect(state?.invocations?.call_contract_denied?.status).toBe("denied")
        const authorization = (await readRunEvents(session.id)).find(
          (event) => event.type === "authorization_recorded",
        )
        expect(authorization?.payload).toMatchObject({
          finalDisposition: "denied",
          contractDisposition: "denied",
          runtimeGuardDisposition: "not_evaluated",
          permissionDisposition: "not_evaluated",
          reasonCodes: ["contract_tool_denied"],
        })
      },
    })
  })

  test("batch propagates an uncertain child result instead of reporting ordinary partial success", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const toolId = "batch_result_append_probe"
        const { session } = await createGovernedRun("Batch child result uncertainty", ["batch", toolId])
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: toolId, pattern: "*", action: "allow" }]
        })
        await ToolRegistry.register(
          Tool.define(toolId, {
            description: "Batch result append probe",
            parameters: z.object({}).strict(),
            result: Tool.result(z.object({}).strict()),
            async execute() {
              return { title: "probe", output: "effect complete", metadata: {} }
            },
          }),
        )
        const batch = await BatchTool.init()
        const ctx: Tool.Context = {
          sessionID: session.id,
          messageID: "message_batch_uncertain",
          callID: "call_batch_parent",
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata() {},
          async ask(req) {
            await governedAsk({
              sessionID: this.sessionID,
              agent: this.agent,
              toolID: toolId,
              callID: this.callID,
              messageID: this.messageID,
              req,
            })
          },
          async authorize() {
            if (this.callID && isNativeSettlementPending(this.callID)) {
              await completeNativeAuthorization(this.callID)
            }
          },
        }

        const resultAppend = spyOn(EventTransitions, "recordToolResult").mockRejectedValue(new Error("disk full"))
        try {
          await expect(batch.execute({ tool_calls: [{ tool: toolId, parameters: {} }] }, ctx)).rejects.toBeInstanceOf(
            NativeSettlementAppendError,
          )
          const invocation = (await readRunEvents(session.id)).find(
            (event) =>
              event.type === "tool_invocation_recorded" &&
              (event.payload as { toolId: string }).toolId === toolId,
          )
          const invocationId = (invocation?.payload as { invocationId: string } | undefined)?.invocationId
          expect(invocationId).toBeDefined()
          expect((await getEventAuthorityState(session.id))?.invocations?.[invocationId!]).toMatchObject({
            status: "authorized",
            resultEventId: null,
          })
          discardNativeSettlement(invocationId!)
        } finally {
          resultAppend.mockRestore()
        }
      },
    })
  })

  test("a non-canonical (ungoverned) session is not tracked and current behavior is preserved", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Ungoverned" })
        const result = await beginNativeInvocation({
          sessionID: session.id,
          invocationId: "call_ungoverned",
          toolId: "shell",
          executor: { kind: "builtin", id: "shell" },
          args: {},
        })
        expect(result).toEqual({ status: "not_canonical" })
        expect(isNativeSettlementPending("call_ungoverned")).toBe(false)
      },
    })
  })
})
