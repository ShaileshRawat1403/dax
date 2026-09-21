import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionProcessor } from "@/session/processor"
import { SessionCompaction } from "@/session/compaction"
import { SessionRetry } from "@/session/retry"
import { SessionSummary } from "@/session/summary"
import { MessageV2 } from "@/session/message-v2"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { Plugin } from "@/plugin"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import { adjudicateNativeCompletionCandidate } from "@/execution/native-completion"
import {
  AssistantProvenancePersistenceError,
  AssistantProvenanceRecoveryRequiredError,
  markDerivedAssistantSession,
  openAssistantMessageProvenance,
} from "@/execution/assistant-provenance"
import {
  beginNativeInvocation,
  completeNativeAuthorization,
  discardNativeSettlement,
  noteNativePolicyDecision,
  recordNativeDelegation,
} from "@/execution/native-settlement"
import {
  createEventAuthorityRun,
  recordAssistantMessageOpened,
  startAssistantRecording,
  transitionEventAuthority,
} from "@/state/events/event-transitions"
import { appendRunEventAtTail, projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

const testModel = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  name: "Assistant provenance test model",
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
  testHome = path.join(os.tmpdir(), `dax-assistant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
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

function modelText(text: string, finishReason = "stop") {
  return {
    fullStream: (async function* () {
      yield { type: "start" }
      yield { type: "text-start" }
      yield { type: "text-delta", text }
      yield { type: "text-end" }
      yield {
        type: "finish-step",
        finishReason,
        usage: { inputTokens: 3, outputTokens: 2 },
        providerMetadata: {},
      }
      yield { type: "finish" }
    })(),
  } as unknown as Awaited<ReturnType<typeof LLM.stream>>
}

async function governedRoot() {
  const root = await Session.create({ title: "Assistant provenance root" })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Produce one governed assistant response." } } },
    root.id,
  )
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
    parts: [{ type: "text", text: "Produce the response." }],
    noReply: true,
  })
}

function installModelSpies(stream: (input: LLM.StreamInput) => Promise<Awaited<ReturnType<typeof LLM.stream>>>) {
  const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  const llm = spyOn(LLM, "stream").mockImplementation(stream)
  return {
    restore() {
      llm.mockRestore()
      summary.mockRestore()
      getModel.mockRestore()
    },
  }
}

describe("production assistant-message provenance", () => {
  test("streams a root response into commitment-only durable replay", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const secretText = "response with token sk-test-sensitive-value"
        let calls = 0
        const spies = installModelSpies(async () => {
          calls++
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "reasoning-start", id: "reasoning", providerMetadata: { secret: "provider-secret" } }
              yield { type: "reasoning-delta", id: "reasoning", text: "private chain of thought" }
              yield { type: "reasoning-end", id: "reasoning" }
              yield { type: "text-start", providerMetadata: { secret: "provider-secret" } }
              yield { type: "text-delta", text: secretText }
              yield { type: "text-end" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 3, outputTokens: 2 },
                providerMetadata: { secret: "provider-secret" },
              }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })
        try {
          await SessionPrompt.loop({ sessionID: root.id })
          expect(calls).toBe(1)
          const events = await readRunEvents(root.id)
          await Session.remove(root.id)
          const replayed = await projectRunStateFromEvents(root.id)
          expect(replayed?.assistantHistory).toMatchObject({
            coverage: "complete",
            unsettledMessageIds: [],
            messages: [
              {
                source: { kind: "root" },
                settlement: {
                  status: "completed",
                  finishReason: "stop",
                  attemptCount: 1,
                  usage: { basis: "reported_finish_steps_only", finishStepCount: 1, input: 3, output: 2 },
                  text: { partCount: 1, finalizedPartCount: 1, interruptedPartCount: 0 },
                  reasoningPartCount: 1,
                },
              },
            ],
          })
          expect(replayed?.assistantHistory.sessions[0]?.cutoverMessageId).toBe(
            replayed?.assistantHistory.messages[0]?.messageId,
          )
          const serialized = JSON.stringify(events)
          expect(serialized).not.toContain(secretText)
          expect(serialized).not.toContain("sk-test-sensitive-value")
          expect(serialized).not.toContain("redactedPreview")
          expect(serialized).not.toContain("private chain of thought")
          expect(serialized).not.toContain("provider-secret")
        } finally {
          spies.restore()
        }
      },
    })
  })

  test("retains an interrupted partial part across a successful provider retry", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        let calls = 0
        const spies = installModelSpies(async () => {
          calls++
          if (calls === 1) {
            return {
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "text-start" }
                yield { type: "text-delta", text: "partial attempt" }
                yield { type: "error", error: new Error("retry provider") }
              })(),
            } as unknown as Awaited<ReturnType<typeof LLM.stream>>
          }
          return modelText("final attempt")
        })
        const retryable = spyOn(SessionRetry, "retryable").mockImplementation((_error, attempt) =>
          attempt === 0 ? "retry" : undefined,
        )
        const sleep = spyOn(SessionRetry, "sleep").mockResolvedValue(undefined)
        try {
          await SessionPrompt.loop({ sessionID: root.id })
          expect(calls).toBe(2)
          const message = (await projectRunStateFromEvents(root.id))?.assistantHistory.messages[0]
          expect(message?.settlement).toMatchObject({
            status: "completed",
            attemptCount: 2,
            usage: { finishStepCount: 1 },
            text: {
              partCount: 2,
              finalizedPartCount: 1,
              interruptedPartCount: 1,
              parts: [
                { attempt: 1, finalization: "interrupted_before_text_end" },
                { attempt: 2, finalization: "finalized_post_plugin" },
              ],
            },
          })
        } finally {
          sleep.mockRestore()
          retryable.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("abort during retry backoff settles cancelled without another provider call", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const assistant = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: Identifier.ascending("message"),
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: testProject, root: testProject },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: testModel.id,
          providerID: testModel.providerID,
          time: { created: Date.now() },
          sessionID: root.id,
        })) as MessageV2.Assistant
        const abort = new AbortController()
        let calls = 0
        const llm = spyOn(LLM, "stream").mockImplementation(async () => {
          calls++
          return {
            fullStream: (async function* () {
              yield { type: "error", error: new Error("retry provider") }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })
        const retryable = spyOn(SessionRetry, "retryable").mockReturnValue("retry")
        const sleep = spyOn(SessionRetry, "sleep").mockImplementation(async () => {
          abort.abort(new DOMException("Aborted", "AbortError"))
          throw abort.signal.reason
        })
        try {
          const processor = SessionProcessor.create({
            assistantMessage: assistant,
            sessionID: root.id,
            model: testModel,
            abort: abort.signal,
          })
          await processor.process({ sessionID: root.id } as LLM.StreamInput)
          expect(calls).toBe(1)
          expect((await projectRunStateFromEvents(root.id))?.assistantHistory.messages[0]?.settlement).toMatchObject({
            status: "cancelled",
            errorCode: "aborted",
            attemptCount: 1,
          })
        } finally {
          sleep.mockRestore()
          retryable.mockRestore()
          llm.mockRestore()
        }
      },
    })
  })

  test("plugin failure is stable, non-retryable provenance and stream exhaustion is not success", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const originalTrigger = Plugin.trigger.bind(Plugin)
        for (const scenario of ["plugin", "exhaustion"] as const) {
          const { root } = await governedRoot()
          await prepareConversation(root.id)
          let calls = 0
          const spies = installModelSpies(async () => {
            calls++
            if (scenario === "plugin") return modelText("plugin candidate")
            return {
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "text-start" }
                yield { type: "text-delta", text: "unterminated" }
              })(),
            } as unknown as Awaited<ReturnType<typeof LLM.stream>>
          })
          const retryable = spyOn(SessionRetry, "retryable").mockReturnValue("must not retry")
          const plugin =
            scenario === "plugin"
              ? spyOn(Plugin, "trigger").mockImplementation(((name: string, ...args: unknown[]) => {
                  if (name === "experimental.text.complete") return Promise.reject(new Error("secret plugin detail"))
                  return (originalTrigger as (...input: unknown[]) => Promise<unknown>)(name, ...args)
                }) as typeof Plugin.trigger)
              : undefined
          try {
            await SessionPrompt.loop({ sessionID: root.id })
            expect(calls).toBe(1)
            const settlement = (await projectRunStateFromEvents(root.id))?.assistantHistory.messages[0]?.settlement
            expect(settlement).toMatchObject({
              status: "failed",
              errorCode: scenario === "plugin" ? "assistant_text_plugin_failed" : "stream_exhausted_without_finish",
            })
            if (scenario === "plugin") {
              expect(settlement?.text.parts[0]?.finalization).toBe("text_end_unfinalized")
            }
            expect(JSON.stringify(await readRunEvents(root.id))).not.toContain("secret plugin detail")
          } finally {
            plugin?.mockRestore()
            retryable.mockRestore()
            spies.restore()
          }
        }
      },
    })
  })

  test("message-open persistence failure never enters provider retry or calls the model", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        await startAssistantRecording(root.id, {
          sessionId: root.id,
          priorScopeHistory: "none",
          copiedHistory: "none",
        })
        let modelCalls = 0
        const spies = installModelSpies(async () => {
          modelCalls++
          return modelText("must not run")
        })
        const retryable = spyOn(SessionRetry, "retryable")
        const rename = spyOn(Storage, "rename").mockRejectedValue(new Error("forced open failure"))
        try {
          let error: unknown
          try {
            await SessionPrompt.loop({ sessionID: root.id })
          } catch (caught) {
            error = caught
          }
          expect(error).toBeInstanceOf(AssistantProvenancePersistenceError)
          expect((error as AssistantProvenancePersistenceError).stage).toBe("open")
          expect(modelCalls).toBe(0)
          expect(retryable).not.toHaveBeenCalled()
          expect(
            (await readRunEvents(root.id))
              .filter((event) => event.type.startsWith("assistant_"))
              .map((event) => event.type),
          ).toEqual(["assistant_recording_started"])
        } finally {
          rename.mockRestore()
          retryable.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("settlement failure survives restart and resume without output acceptance or model replay", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        let modelCalls = 0
        let renameFailure: ReturnType<typeof spyOn<typeof Storage, "rename">> | undefined
        const retryable = spyOn(SessionRetry, "retryable")
        const spies = installModelSpies(async () => {
          modelCalls++
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "text-start" }
              yield { type: "text-delta", text: "candidate output" }
              yield { type: "text-end" }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1 },
                providerMetadata: {},
              }
              yield { type: "finish" }
              renameFailure = spyOn(Storage, "rename").mockRejectedValue(new Error("forced settlement failure"))
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })
        try {
          let error: unknown
          try {
            await SessionPrompt.loop({ sessionID: root.id, completionPolicy: "on_provider_stop" })
          } catch (caught) {
            error = caught
          }
          expect(error).toBeInstanceOf(AssistantProvenancePersistenceError)
          expect((error as AssistantProvenancePersistenceError).stage).toBe("settle")
          expect(retryable).not.toHaveBeenCalled()
          renameFailure?.mockRestore()
          renameFailure = undefined

          await Instance.disposeAll()
          await SessionPrompt.loop({
            sessionID: root.id,
            completionPolicy: "on_provider_stop",
          })
          expect(modelCalls).toBe(1)
          const state = await projectRunStateFromEvents(root.id)
          const events = await readRunEvents(root.id)
          expect(state?.status).toBe("running")
          expect(state?.assistantHistory.unsettledMessageIds).toHaveLength(1)
          expect(events.some((event) => event.type === "run_completed")).toBe(false)
          expect(events.some((event) => event.type === "artifact_created")).toBe(false)
          expect(events.some((event) => event.type === "verification_recorded")).toBe(false)
        } finally {
          renameFailure?.mockRestore()
          retryable.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("restart with an unfinished opened message requires recovery before provider dispatch", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const messages = await Session.messages({ sessionID: root.id })
        const user = messages.findLast((message) => message.info.role === "user")
        if (!user) throw new Error("missing user message")
        const assistant = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: user.info.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: testProject, root: testProject },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: testModel.id,
          providerID: testModel.providerID,
          time: { created: Date.now() },
          sessionID: root.id,
        })) as MessageV2.Assistant
        await openAssistantMessageProvenance({ assistantMessage: assistant })
        await Instance.disposeAll()

        let modelCalls = 0
        const spies = installModelSpies(async () => {
          modelCalls++
          return modelText("replacement response")
        })
        try {
          const error = await SessionPrompt.loop({
            sessionID: root.id,
            completionPolicy: "on_provider_stop",
          }).catch((cause) => cause)

          expect(error).toBeInstanceOf(AssistantProvenanceRecoveryRequiredError)
          expect(error).toMatchObject({
            code: "assistant_provenance_recovery_required",
            runId: root.id,
            sessionId: root.id,
            unsettledMessageIds: [assistant.id],
          })
          expect(modelCalls).toBe(0)
          const state = await projectRunStateFromEvents(root.id)
          expect(state?.assistantHistory.messages).toHaveLength(1)
          expect(state?.assistantHistory.unsettledMessageIds).toEqual([assistant.id])
          expect((await Session.messages({ sessionID: root.id })).filter((message) => message.info.role === "assistant")).toHaveLength(1)
        } finally {
          spies.restore()
        }
      },
    })
  })

  test("ordinary forks and task-delegated compaction retain distinct exact sources", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const ordinary = await Session.fork({ sessionID: root.id })
        const ordinarySpies = installModelSpies(async () => modelText("ordinary derived"))
        try {
          await SessionPrompt.prompt({
            sessionID: ordinary.id,
            model: { providerID: testModel.providerID, modelID: testModel.id },
            parts: [{ type: "text", text: "Continue ordinary fork." }],
          })
        } finally {
          ordinarySpies.restore()
        }

        const invocationId = "call_compaction_delegation"
        await beginNativeInvocation({
          sessionID: root.id,
          invocationId,
          toolId: "task",
          executor: { kind: "builtin", id: "task" },
          args: { prompt: "compact", subagent_type: "general" },
        })
        noteNativePolicyDecision(invocationId, {
          finalDisposition: "allowed",
          runtimeGuardDisposition: "allowed",
          permissionDisposition: "allowed",
          approvalIds: [],
          reasonCodes: [],
        })
        await completeNativeAuthorization(invocationId)
        const delegated = await Session.fork({ sessionID: root.id, deferAssistantMarker: true })
        const receipt = await recordNativeDelegation(invocationId, {
          parentSessionId: root.id,
          childSessionId: delegated.id,
          agent: "general",
          mode: "created",
        })
        await markDerivedAssistantSession({ sessionId: delegated.id, copiedFromSessionId: root.id })
        const messages = await Session.messages({ sessionID: delegated.id })
        const parent = messages.findLast((message) => message.info.role === "user")
        if (!parent) throw new Error("missing copied user message")
        const compactionSpies = installModelSpies(async () => modelText("compaction summary"))
        try {
          await SessionCompaction.process({
            parentID: parent.info.id,
            messages,
            sessionID: delegated.id,
            abort: new AbortController().signal,
            auto: false,
            assistantProvenance: receipt,
          })
        } finally {
          compactionSpies.restore()
          discardNativeSettlement(invocationId)
        }

        const state = await projectRunStateFromEvents(root.id)
        const derivedMessage = state?.assistantHistory.messages.find((message) => message.sessionId === ordinary.id)
        const compactedMessage = state?.assistantHistory.messages.find(
          (message) => message.sessionId === delegated.id && message.summary,
        )
        expect(derivedMessage?.source).toEqual({ kind: "derived", parentSessionId: root.id })
        expect(compactedMessage?.source).toEqual(receipt)
        expect(state?.assistantHistory.coverage).toBe("partial")
        expect(state?.assistantHistory.sessions.find((session) => session.sessionId === root.id)).toMatchObject({
          coverage: "unavailable",
          markerEventId: null,
        })
        expect(state?.assistantHistory.sessions.find((session) => session.sessionId === ordinary.id)).toMatchObject({
          coverage: "complete",
          copiedHistory: "excluded",
          sourceSessionId: root.id,
        })
        expect(state?.assistantHistory.sessions.find((session) => session.sessionId === delegated.id)).toMatchObject({
          coverage: "complete",
          copiedHistory: "excluded",
          sourceSessionId: root.id,
        })
      },
    })
  })

  test("a pre-cutover persisted candidate cannot auto-complete or create output evidence", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const messageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: messageID,
          parentID: Identifier.ascending("message"),
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: testProject, root: testProject },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: testModel.id,
          providerID: testModel.providerID,
          time: { created: Date.now(), completed: Date.now() },
          sessionID: root.id,
          finish: "stop",
        })
        const decision = await adjudicateNativeCompletionCandidate({
          sessionID: root.id,
          assistantMessageID: messageID,
          finishReason: "stop",
        })
        expect(decision).toMatchObject({ accepted: false, reasonCodes: ["assistant_settlement_unavailable"] })
        const events = await readRunEvents(root.id)
        expect(events.some((event) => event.type === "artifact_created")).toBe(false)
        expect(events.some((event) => event.type === "verification_recorded")).toBe(false)
        expect(events.some((event) => event.type === "run_completed")).toBe(false)
      },
    })
  })
})

describe("assistant provenance authority and coverage", () => {
  test("historical completed journals without assistant events still replay as completed", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await transitionEventAuthority(root.id, "completed", "run_completed", {})
        await Instance.disposeAll()
        const state = await projectRunStateFromEvents(root.id)
        expect(state?.status).toBe("completed")
        expect(state?.assistantHistory).toMatchObject({
          coverage: "unavailable",
          messages: [],
          unsettledMessageIds: [],
        })
      },
    })
  })

  test("direct settlement append rejects arbitrary error text without retaining it", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const markerState = await startAssistantRecording(root.id, {
          sessionId: root.id,
          priorScopeHistory: "none",
          copiedHistory: "none",
          cutoverMessageId: "msg_error_code",
        })
        const marker = markerState.assistantHistory.sessions[0]?.markerEventId
        if (!marker) throw new Error("missing marker")
        const opened = await recordAssistantMessageOpened(root.id, marker, {
          phase: "opened",
          scope: "session_processor_v1",
          messageId: "msg_error_code",
          sessionId: root.id,
          parentMessageId: "msg_parent",
          providerId: "provider",
          modelId: "model",
          agent: "build",
          summary: false,
          source: { kind: "root" },
        })
        const openedEvent = opened.assistantHistory.messages[0]?.openedEventId
        if (!openedEvent) throw new Error("missing open event")
        const before = await readRunEvents(root.id)
        const secret = "raw provider failure containing SECRET_OUTPUT"
        const invalidSettlement = {
          type: "assistant_message_recorded",
          payload: {
            phase: "settled",
            scope: "session_processor_v1",
            messageId: "msg_error_code",
            sessionId: root.id,
            status: "failed",
            errorCode: secret,
            attemptCount: 1,
            usage: {
              basis: "reported_finish_steps_only",
              finishStepCount: 0,
              input: 0,
              output: 0,
              reasoning: 0,
              cacheRead: 0,
              cacheWrite: 0,
              cost: 0,
            },
            text: {
              canonicalization: "assistant-visible-parts-v1",
              digest: `sha256:${"0".repeat(64)}`,
              partCount: 0,
              finalizedPartCount: 0,
              interruptedPartCount: 0,
              utf8Bytes: 0,
              parts: [],
            },
            reasoningPartCount: 0,
            reasoningUtf8Bytes: 0,
          },
          causationId: openedEvent,
          correlationId: "msg_error_code",
        } as unknown as Parameters<typeof appendRunEventAtTail>[1]
        const rejection = await appendRunEventAtTail(root.id, invalidSettlement).then(
          () => null,
          (error: unknown) => error,
        )
        expect(rejection).toBeInstanceOf(Error)
        expect(await readRunEvents(root.id)).toEqual(before)
        expect(JSON.stringify(await readRunEvents(root.id))).not.toContain(secret)
      },
    })
  })

  test.each(["run_completed", "workflow_completed"] as const)(
    "%s cannot bypass an unsettled message and leaves the journal unchanged",
    async (completionType) => {
      await Instance.provide({
        directory: testProject,
        async fn() {
          const { root } = await governedRoot()
          const markerState = await startAssistantRecording(root.id, {
            sessionId: root.id,
            priorScopeHistory: "none",
            copiedHistory: "none",
            cutoverMessageId: "msg_open",
          })
          const marker = markerState.assistantHistory.sessions[0]?.markerEventId
          if (!marker) throw new Error("missing marker")
          await recordAssistantMessageOpened(root.id, marker, {
            phase: "opened",
            scope: "session_processor_v1",
            messageId: "msg_open",
            sessionId: root.id,
            parentMessageId: "msg_parent",
            providerId: "provider",
            modelId: "model",
            agent: "build",
            summary: false,
            source: { kind: "root" },
          })
          const before = await readRunEvents(root.id)
          const rejection = await appendRunEventAtTail(root.id, { type: completionType, payload: {} }).then(
            () => null,
            (error: unknown) => error,
          )
          expect((rejection as Error).message).toMatch(/unsettled assistant messages/)
          expect(await readRunEvents(root.id)).toEqual(before)
        },
      })
    },
  )

  test("a concurrent open wins the lock before completion and rejected completion writes nothing", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const markerState = await startAssistantRecording(root.id, {
          sessionId: root.id,
          priorScopeHistory: "none",
          copiedHistory: "none",
          cutoverMessageId: "msg_race",
        })
        const marker = markerState.assistantHistory.sessions[0]?.markerEventId
        if (!marker) throw new Error("missing marker")
        const originalRename = Storage.rename.bind(Storage)
        let releaseOpen!: () => void
        const release = new Promise<void>((resolve) => {
          releaseOpen = resolve
        })
        let openAtBoundary!: () => void
        const boundary = new Promise<void>((resolve) => {
          openAtBoundary = resolve
        })
        let paused = false
        const rename = spyOn(Storage, "rename").mockImplementation(async (source, target) => {
          const events = await Storage.read<unknown[]>(source)
          const last = events.at(-1) as { type?: string; payload?: { phase?: string } } | undefined
          if (!paused && last?.type === "assistant_message_recorded" && last.payload?.phase === "opened") {
            paused = true
            openAtBoundary()
            await release
          }
          return originalRename(source, target)
        })
        try {
          const opening = recordAssistantMessageOpened(root.id, marker, {
            phase: "opened",
            scope: "session_processor_v1",
            messageId: "msg_race",
            sessionId: root.id,
            parentMessageId: "msg_parent",
            providerId: "provider",
            modelId: "model",
            agent: "build",
            summary: false,
            source: { kind: "root" },
          })
          await boundary
          const completion = appendRunEventAtTail(root.id, { type: "run_completed", payload: {} })
          releaseOpen()
          await opening
          const afterOpen = await readRunEvents(root.id)
          const rejection = await completion.then(
            () => null,
            (error: unknown) => error,
          )
          expect((rejection as Error).message).toMatch(/unsettled assistant messages/)
          expect(await readRunEvents(root.id)).toEqual(afterOpen)
        } finally {
          releaseOpen()
          rename.mockRestore()
        }
      },
    })
  })

  test("mixed old root and newly marked child remains partial with per-session unknown coverage", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        const child = await Session.create({ title: "new child" })
        await Session.bindGoverningRun(child.id, root.id)
        await startAssistantRecording(root.id, {
          sessionId: child.id,
          priorScopeHistory: "none",
          copiedHistory: "none",
          cutoverMessageId: "msg_child",
        })
        const history = (await projectRunStateFromEvents(root.id))?.assistantHistory
        expect(history?.coverage).toBe("partial")
        expect(history?.sessions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ sessionId: root.id, coverage: "unavailable", markerEventId: null }),
            expect.objectContaining({ sessionId: child.id, coverage: "complete" }),
          ]),
        )
      },
    })
  })
})
