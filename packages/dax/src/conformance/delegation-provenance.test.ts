import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionSummary } from "@/session/summary"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { TaskTool } from "@/tool/task"
import { Permission } from "@/governance"
import { Storage } from "@/storage/storage"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import {
  beginNativeInvocation,
  completeNativeAuthorization,
  denyNativeAuthorization,
  discardNativeSettlement,
  noteNativePolicyDecision,
  recordNativeDelegation,
} from "@/execution/native-settlement"
import {
  createEventAuthorityRun,
  getEventAuthorityState,
  transitionEventAuthority,
} from "@/state/events/event-transitions"
import { projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

const testModel = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  name: "Delegation provenance test model",
  api: { id: "gpt-4o", url: "https://example.invalid", npm: "@ai-sdk/openai" },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 128_000, output: 4_096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
})

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-delegation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  testProject = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  await fs.mkdir(testProject, { recursive: true })
  await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  await fs.rm(testHome, { recursive: true, force: true })
})

function modelText(text: string) {
  return {
    fullStream: (async function* () {
      yield { type: "start" }
      yield { type: "text-start" }
      yield { type: "text-delta", text }
      yield { type: "text-end" }
      yield {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1 },
        providerMetadata: {},
      }
      yield { type: "finish" }
    })(),
  } as unknown as Awaited<ReturnType<typeof LLM.stream>>
}

function modelError(message: string) {
  return {
    fullStream: (async function* () {
      yield { type: "start" }
      yield { type: "error", error: new Error(message) }
      yield { type: "finish" }
    })(),
  } as unknown as Awaited<ReturnType<typeof LLM.stream>>
}

async function governedRoot() {
  const root = await Session.create({ title: "Delegation authority root" })
  await Session.update(root.id, (draft) => {
    draft.permission = [{ permission: "task", pattern: "*", action: "allow" }]
  })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Delegate one governed task." } }, availableTools: ["task"] },
    root.id,
  )
  contract.toolAllowlist = ["task"]
  contract.toolBlocklist = []
  await ContractGuardian.create(root.id, contract)
  await Session.bindGoverningRun(root.id, root.id)
  await createEventAuthorityRun(root.id, contract.contractId)
  await transitionEventAuthority(root.id, "queued", "execution_queued", {})
  await transitionEventAuthority(root.id, "running", "execution_started", {})
  return { root, contract }
}

async function prepareConversation(sessionID: string) {
  await SessionPrompt.prompt({
    sessionID,
    model: { providerID: "openai", modelID: "gpt-4o" },
    parts: [{ type: "text", text: "Prepare delegation test history." }],
    noReply: true,
  })
}

describe("production delegation provenance", () => {
  test("ordinary provider-tool dispatch records nested-session provenance and replays without child storage", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const nested = await Session.fork({ sessionID: root.id })
        await Session.update(nested.id, (draft) => {
          draft.permission = [{ permission: "task", pattern: "*", action: "allow" }]
        })

        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
        let activeDelegatorId = nested.id
        let parentDispatched = false
        let activeCall: {
          id: string
          args: { description: string; prompt: string; subagent_type: string; task_id?: string }
        } = {
          id: "call_nested_task",
          args: { description: "inspect project", prompt: "Inspect the project.", subagent_type: "general" },
        }
        let childSessionId = ""
        let childModelCalls = 0
        const stream = spyOn(LLM, "stream").mockImplementation(async (input: LLM.StreamInput) => {
          if (input.sessionID !== activeDelegatorId) {
            childSessionId = input.sessionID
            childModelCalls++
            const eventsAtChildStart = await readRunEvents(root.id)
            const delegationEvent = eventsAtChildStart.find(
              (candidate) => candidate.type === "delegation_recorded" && candidate.correlationId === activeCall.id,
            )
            expect(delegationEvent).toBeDefined()
            expect(
              eventsAtChildStart.some(
                (candidate) => candidate.type === "tool_result_recorded" && candidate.correlationId === activeCall.id,
              ),
            ).toBe(false)
            return modelText("child completed")
          }

          const task = input.tools.task
          if (task?.execute && !parentDispatched) {
            parentDispatched = true
            const output = await task.execute(activeCall.args, {
              toolCallId: activeCall.id,
              abortSignal: new AbortController().signal,
              messages: [],
            })
            return {
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "tool-call", toolCallId: activeCall.id, toolName: "task", input: activeCall.args }
                yield { type: "tool-result", toolCallId: activeCall.id, output }
                yield {
                  type: "finish-step",
                  finishReason: "tool-calls",
                  usage: { inputTokens: 1, outputTokens: 1 },
                  providerMetadata: {},
                }
                yield { type: "finish" }
              })(),
            } as unknown as Awaited<ReturnType<typeof LLM.stream>>
          }
          return modelError("stop after ordinary delegation")
        })

        try {
          await SessionPrompt.prompt({
            sessionID: nested.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Delegate the inspection." }],
          })

          expect(childModelCalls).toBe(1)
          const resumer = await Session.fork({ sessionID: root.id })
          await Session.update(resumer.id, (draft) => {
            draft.permission = [{ permission: "task", pattern: "*", action: "allow" }]
          })
          activeDelegatorId = resumer.id
          parentDispatched = false
          activeCall = {
            id: "call_resumed_task",
            args: {
              description: "resume inspection",
              prompt: "Continue the inspection.",
              subagent_type: "general",
              task_id: childSessionId,
            },
          }
          await SessionPrompt.prompt({
            sessionID: resumer.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Resume the delegated inspection." }],
          })

          expect(childModelCalls).toBe(2)
          const events = await readRunEvents(root.id)
          const invocation = events.find(
            (candidate) =>
              candidate.type === "tool_invocation_recorded" &&
              (candidate.payload as { invocationId: string }).invocationId === "call_nested_task",
          )
          const authorization = events.find(
            (candidate) =>
              candidate.type === "authorization_recorded" && candidate.correlationId === "call_nested_task",
          )
          const delegation = events.find(
            (candidate) => candidate.type === "delegation_recorded" && candidate.correlationId === "call_nested_task",
          )
          expect(invocation).toBeDefined()
          expect(delegation).toMatchObject({
            runId: root.id,
            causationId: authorization?.eventId,
            payload: {
              invocationId: "call_nested_task",
              parentSessionId: nested.id,
              childSessionId,
              agent: "general",
              mode: "created",
            },
          })
          expect(
            events.find(
              (candidate) =>
                candidate.type === "delegation_recorded" && candidate.correlationId === "call_resumed_task",
            ),
          ).toMatchObject({
            runId: root.id,
            payload: {
              invocationId: "call_resumed_task",
              parentSessionId: resumer.id,
              childSessionId,
              agent: "general",
              mode: "resumed",
            },
          })

          await Session.remove(childSessionId)
          let removedChildReadFailed = false
          try {
            await Session.get(childSessionId)
          } catch {
            removedChildReadFailed = true
          }
          expect(removedChildReadFailed).toBe(true)
          const replayed = await projectRunStateFromEvents(root.id)
          expect(replayed?.delegationHistory).toMatchObject({
            coverage: "complete",
            records: [
              {
                invocationId: "call_nested_task",
                parentSessionId: nested.id,
                childSessionId,
                agent: "general",
                mode: "created",
              },
              {
                invocationId: "call_resumed_task",
                parentSessionId: resumer.id,
                childSessionId,
                agent: "general",
                mode: "resumed",
              },
            ],
          })
        } finally {
          stream.mockRestore()
          summary.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  }, 30_000)

  test("queued-subtask dispatch uses the real TaskTool and records before child model execution", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
        let childModelCalls = 0
        let sawAuthorizedRecord = false
        const stream = spyOn(LLM, "stream").mockImplementation(async (input: LLM.StreamInput) => {
          if (input.sessionID !== root.id) {
            childModelCalls++
            const state = await getEventAuthorityState(root.id)
            sawAuthorizedRecord =
              state?.delegationHistory.records.length === 1 &&
              Object.values(state.invocations ?? {}).some(
                (invocation) => invocation.toolId === "task" && invocation.status === "authorized",
              )
            return modelText("queued child completed")
          }
          return modelError("stop after queued delegation")
        })

        try {
          await SessionPrompt.prompt({
            sessionID: root.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [
              {
                type: "subtask",
                agent: "general",
                description: "queued inspection",
                prompt: "Inspect through the queued path.",
              },
            ],
          })

          expect(childModelCalls).toBe(1)
          expect(sawAuthorizedRecord).toBe(true)
          const state = await projectRunStateFromEvents(root.id)
          expect(state?.delegationHistory).toMatchObject({
            coverage: "complete",
            records: [{ parentSessionId: root.id, agent: "general", mode: "created" }],
          })
          const delegation = state?.delegationHistory.records[0]
          if (!delegation) throw new Error("missing durable delegation")
          const childMessage = state?.assistantHistory.messages.find(
            (message) => message.sessionId === delegation.childSessionId,
          )
          expect(childMessage?.source).toEqual({
            kind: "task_delegated",
            invocationId: delegation?.invocationId,
            delegationEventId: delegation?.eventId,
            authorizationEventId: delegation?.authorizationEventId,
            parentSessionId: root.id,
            agent: "general",
            mode: "created",
          })
        } finally {
          stream.mockRestore()
          summary.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  }, 30_000)

  test("denied real TaskTool dispatch creates no child, delegation record, or child model call", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const invocationId = "call_denied_task"
        await beginNativeInvocation({
          sessionID: root.id,
          invocationId,
          toolId: "task",
          executor: { kind: "builtin", id: "task" },
          args: { description: "deny child", prompt: "must not run", subagent_type: "general" },
          originTurnId: "msg_denied_task",
        })

        const sessionsBefore = await Array.fromAsync(Session.list()).then((sessions) =>
          sessions.map((session) => session.id),
        )
        let childModelCalls = 0
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          childModelCalls++
          return modelText("must not run")
        })
        const task = await TaskTool.init()
        try {
          let denialError: unknown
          try {
            await task.execute(
              { description: "deny child", prompt: "must not run", subagent_type: "general" },
              {
                sessionID: root.id,
                messageID: "msg_denied_task",
                callID: invocationId,
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata() {},
                async ask() {
                  await denyNativeAuthorization(invocationId, {
                    finalDisposition: "denied",
                    runtimeGuardDisposition: "allowed",
                    permissionDisposition: "denied",
                    approvalIds: [],
                    reasonCodes: ["permission_denied"],
                  })
                  throw new Permission.RejectedError()
                },
                async authorize() {
                  throw new Error("authorization must not run after denial")
                },
              },
            )
          } catch (error) {
            denialError = error
          }
          expect(denialError).toBeInstanceOf(Permission.RejectedError)

          const sessionsAfter = await Array.fromAsync(Session.list()).then((sessions) =>
            sessions.map((session) => session.id),
          )
          const events = await readRunEvents(root.id)
          expect(sessionsAfter).toEqual(sessionsBefore)
          expect(childModelCalls).toBe(0)
          expect(events.filter((event) => event.type === "delegation_recorded")).toHaveLength(0)
          expect(
            events.find((event) => event.type === "authorization_recorded" && event.correlationId === invocationId),
          ).toMatchObject({ payload: { finalDisposition: "denied" } })
        } finally {
          discardNativeSettlement(invocationId)
          stream.mockRestore()
        }
      },
    })
  })

  test("delegation persistence failure prevents the real TaskTool child model call", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const invocationId = "call_delegation_io_failure"
        await beginNativeInvocation({
          sessionID: root.id,
          invocationId,
          toolId: "task",
          executor: { kind: "builtin", id: "task" },
          args: { description: "fail persistence", prompt: "must not run", subagent_type: "general" },
          originTurnId: "msg_delegation_io_failure",
        })

        const sessionsBefore = await Array.fromAsync(Session.list()).then((sessions) =>
          sessions.map((session) => session.id),
        )
        let childModelCalls = 0
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          childModelCalls++
          return modelText("must not run")
        })
        let renameFailure: { mockRestore(): void } | undefined
        const task = await TaskTool.init()
        try {
          let persistenceError: unknown
          try {
            await task.execute(
              { description: "fail persistence", prompt: "must not run", subagent_type: "general" },
              {
                sessionID: root.id,
                messageID: "msg_delegation_io_failure",
                callID: invocationId,
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata() {},
                async ask() {
                  noteNativePolicyDecision(invocationId, {
                    finalDisposition: "allowed",
                    runtimeGuardDisposition: "allowed",
                    permissionDisposition: "allowed",
                    approvalIds: [],
                    reasonCodes: [],
                  })
                },
                async authorize() {
                  await completeNativeAuthorization(invocationId)
                  renameFailure = spyOn(Storage, "rename").mockRejectedValue(
                    new Error("forced delegation persistence failure"),
                  )
                },
              },
            )
          } catch (error) {
            persistenceError = error
          }
          expect(String(persistenceError)).toMatch(
            /Failed to durably record delegation.*forced delegation persistence failure/,
          )

          const sessionsAfter = await Array.fromAsync(Session.list()).then((sessions) =>
            sessions.map((session) => session.id),
          )
          expect(sessionsAfter).toHaveLength(sessionsBefore.length + 1)
          expect(childModelCalls).toBe(0)
          expect((await readRunEvents(root.id)).filter((event) => event.type === "delegation_recorded")).toHaveLength(0)
        } finally {
          renameFailure?.mockRestore()
          discardNativeSettlement(invocationId)
          stream.mockRestore()
        }
      },
    })
  })

  test("duplicate durable delegation fails closed before a second child prompt", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const invocationId = "call_duplicate_task"
        await beginNativeInvocation({
          sessionID: root.id,
          invocationId,
          toolId: "task",
          executor: { kind: "builtin", id: "task" },
          args: { description: "duplicate", prompt: "duplicate", subagent_type: "general" },
          originTurnId: "msg_duplicate",
        })

        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        let modelCalls = 0
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          modelCalls++
          return modelText("must not run")
        })
        const task = await TaskTool.init()
        try {
          let duplicateError: unknown
          try {
            await task.execute(
              { description: "duplicate", prompt: "duplicate", subagent_type: "general" },
              {
                sessionID: root.id,
                messageID: "msg_duplicate",
                callID: invocationId,
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata() {},
                async ask() {
                  noteNativePolicyDecision(invocationId, {
                    finalDisposition: "allowed",
                    runtimeGuardDisposition: "allowed",
                    permissionDisposition: "allowed",
                    approvalIds: [],
                    reasonCodes: [],
                  })
                },
                async authorize() {
                  await completeNativeAuthorization(invocationId)
                  await recordNativeDelegation(invocationId, {
                    parentSessionId: root.id,
                    childSessionId: "ses_preexisting_child",
                    agent: "general",
                    mode: "created",
                  })
                },
              },
            )
          } catch (error) {
            duplicateError = error
          }
          expect(String(duplicateError)).toMatch(/Failed to durably record delegation|Duplicate command/)
          expect(modelCalls).toBe(0)
          expect((await readRunEvents(root.id)).filter((event) => event.type === "delegation_recorded")).toHaveLength(1)
        } finally {
          discardNativeSettlement(invocationId)
          stream.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  })

  test("canonical task execution cannot downgrade when invocation identity is missing", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        let modelCalls = 0
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          modelCalls++
          return modelText("must not run")
        })
        const task = await TaskTool.init()
        try {
          let missingIdentityError: unknown
          try {
            await task.execute(
              { description: "missing identity", prompt: "must fail closed", subagent_type: "general" },
              {
                sessionID: root.id,
                messageID: "msg_missing_identity",
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata() {},
                async ask() {},
                async authorize() {},
              },
            )
          } catch (error) {
            missingIdentityError = error
          }
          expect(String(missingIdentityError)).toMatch(/no invocation identity/)
          expect(modelCalls).toBe(0)
          expect((await readRunEvents(root.id)).some((event) => event.type === "delegation_recorded")).toBe(false)
        } finally {
          stream.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  })

  test("production TaskTool interruption after append replays without child re-execution", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const invocationId = "call_interrupted_after_delegation"
        await beginNativeInvocation({
          sessionID: root.id,
          invocationId,
          toolId: "task",
          executor: { kind: "builtin", id: "task" },
          args: { description: "interrupt", prompt: "interrupt", subagent_type: "general" },
          originTurnId: "msg_interrupted_after_delegation",
        })

        let childPromptAttempts = 0
        let childModelCalls = 0
        let selectedChildId = ""
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          childModelCalls++
          return modelText("must not run")
        })
        const interruptAfterAppend = (async (input: Parameters<typeof SessionPrompt.prompt>[0]) => {
          childPromptAttempts++
          selectedChildId = input.sessionID
          expect(
            (await readRunEvents(root.id)).find(
              (event) => event.type === "delegation_recorded" && event.correlationId === invocationId,
            ),
          ).toMatchObject({ payload: { childSessionId: input.sessionID } })
          throw new Error("interrupted immediately after delegation append")
        }) as unknown as typeof SessionPrompt.prompt
        const prompt = spyOn(SessionPrompt, "prompt").mockImplementation(interruptAfterAppend)
        const task = await TaskTool.init()
        try {
          let interruptionError: unknown
          try {
            await task.execute(
              { description: "interrupt", prompt: "interrupt", subagent_type: "general" },
              {
                sessionID: root.id,
                messageID: "msg_interrupted_after_delegation",
                callID: invocationId,
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata() {},
                async ask() {
                  noteNativePolicyDecision(invocationId, {
                    finalDisposition: "allowed",
                    runtimeGuardDisposition: "allowed",
                    permissionDisposition: "allowed",
                    approvalIds: [],
                    reasonCodes: [],
                  })
                },
                async authorize() {
                  await completeNativeAuthorization(invocationId)
                },
              },
            )
          } catch (error) {
            interruptionError = error
          }
          expect(String(interruptionError)).toContain("interrupted immediately after delegation append")
          discardNativeSettlement(invocationId)

          const replayed = await projectRunStateFromEvents(root.id)
          expect(replayed?.invocations[invocationId]).toMatchObject({
            status: "authorized",
            resultEventId: null,
          })
          expect(replayed?.delegationHistory).toMatchObject({
            coverage: "complete",
            records: [{ invocationId, childSessionId: selectedChildId }],
          })
          expect(childPromptAttempts).toBe(1)
          expect(childModelCalls).toBe(0)
        } finally {
          discardNativeSettlement(invocationId)
          prompt.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })
})
