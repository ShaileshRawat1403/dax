import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { simulateReadableStream, type ModelMessage } from "ai"
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionCompaction } from "@/session/compaction"
import { SessionRetry } from "@/session/retry"
import { SessionProcessor } from "@/session/processor"
import { SessionSummary } from "@/session/summary"
import { MessageV2 } from "@/session/message-v2"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { Plugin } from "@/plugin"
import { Storage } from "@/storage/storage"
import { Identifier } from "@/id/id"
import { Agent } from "@/agent/agent"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import {
  openAssistantMessageProvenance,
  settleAssistantMessageProvenance,
  type AssistantProvenanceContext,
} from "@/execution/assistant-provenance"
import {
  createPromptProvenanceTracker,
  type PromptProvenanceTracker,
} from "@/execution/prompt-provenance"
import { adjudicateNativeCompletionCandidate } from "@/execution/native-completion"
import {
  createEventAuthorityRun,
  recordAssistantMessageOpened,
  recordAssistantMessageSettled,
  startAssistantRecording,
  transitionEventAuthority,
} from "@/state/events/event-transitions"
import {
  appendRunEventAtTail,
  projectRunStateFromEvents,
  readRunEvents,
} from "@/state/events/run-event-store"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

const testModel = Provider.Model.parse({
  id: "prompt-model",
  providerID: "prompt-test",
  name: "Prompt provenance test model",
  api: { id: "prompt-model", url: "https://example.invalid", npm: "@ai-sdk/openai" },
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

const testProvider = Provider.Info.parse({
  id: testModel.providerID,
  name: "Prompt test provider",
  source: "custom",
  env: [],
  options: {},
  models: { [testModel.id]: testModel },
})

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
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

function successfulChunks(text = "durable output"): LanguageModelV2StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    {
      type: "finish",
      finishReason: "stop",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    },
  ]
}

function streamResult(chunks: LanguageModelV2StreamPart[]) {
  return {
    stream: simulateReadableStream({ chunks, initialDelayInMs: null, chunkDelayInMs: null }),
  }
}

type TestLanguageModel = LanguageModelV2 & { doStreamCalls: LanguageModelV2CallOptions[] }

function languageModel(doStream: LanguageModelV2["doStream"]): TestLanguageModel {
  const doStreamCalls: LanguageModelV2CallOptions[] = []
  return {
    specificationVersion: "v2",
    provider: testModel.providerID,
    modelId: testModel.id,
    supportedUrls: {},
    doStreamCalls,
    async doGenerate() {
      throw new Error("non-streaming generation is outside this producer scope")
    },
    async doStream(input) {
      doStreamCalls.push(input)
      return doStream(input)
    },
  }
}

function installActualStreamingModel(model: LanguageModelV2) {
  const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
  const getProvider = spyOn(Provider, "getProvider").mockResolvedValue(testProvider)
  const getLanguage = spyOn(Provider, "getLanguage").mockResolvedValue(model)
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  return {
    restore() {
      summary.mockRestore()
      getLanguage.mockRestore()
      getProvider.mockRestore()
      getModel.mockRestore()
    },
  }
}

async function governedRoot() {
  const root = await Session.create({ title: "Prompt provenance root" })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Produce one governed response." } } },
    root.id,
  )
  await ContractGuardian.create(root.id, contract)
  await Session.bindGoverningRun(root.id, root.id)
  await createEventAuthorityRun(root.id, contract.contractId)
  await transitionEventAuthority(root.id, "queued", "execution_queued", {})
  await transitionEventAuthority(root.id, "running", "execution_started", {})
  return { root, contract }
}

async function prepareConversation(sessionID: string, text = "Produce the response.") {
  await SessionPrompt.prompt({
    sessionID,
    model: { providerID: testModel.providerID, modelID: testModel.id },
    parts: [{ type: "text", text }],
    noReply: true,
  })
}

async function rejection<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise
    throw new Error("expected promise to reject")
  } catch (error) {
    return error
  }
}

async function consume(stream: Awaited<ReturnType<typeof LLM.stream>>) {
  for await (const _part of stream.fullStream) {
    // Consumption is what crosses the lazy AI SDK provider boundary.
  }
}

function settlement(context: AssistantProvenanceContext, promptDispatch: { count: number; finalEventId: string | null }) {
  return settleAssistantMessageProvenance(context, {
    status: "completed",
    finishReason: "stop",
    attemptCount: Math.max(1, promptDispatch.count),
    usage: {
      basis: "reported_finish_steps_only",
      finishStepCount: 1,
      input: 3,
      output: 2,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    },
    textParts: [],
    reasoningPartCount: 0,
    reasoningUtf8Bytes: 0,
    promptDispatch,
  })
}

describe("durable prompt provenance", () => {
  test("records commitment-only provider-adapter input and reconstructs it without session storage", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id, "ordinary context with secret sk-user-not-retained")
        let providerCalls = 0
        const model = languageModel(async () => {
          providerCalls++
          return streamResult(successfulChunks("assistant secret sk-output-not-retained"))
        })
        const spies = installActualStreamingModel(model)
        try {
          await SessionPrompt.loop({ sessionID: root.id })
          expect(providerCalls).toBe(1)
          const events = await readRunEvents(root.id)
          const record = events.find((event) => event.type === "prompt_contribution_recorded")
          expect(record?.payload).toMatchObject({
            scope: "session_processor_instructions_v1",
            sessionId: root.id,
            dispatchOrdinal: 1,
            providerId: testModel.providerID,
            modelId: testModel.id,
            commitment: {
              canonicalization: "provider-adapter-instructions-v1",
            },
          })
          const serialized = JSON.stringify(events)
          expect(serialized).not.toContain("sk-user-not-retained")
          expect(serialized).not.toContain("sk-output-not-retained")
          expect(serialized).not.toContain("Produce one governed response")

          await Session.remove(root.id)
          const replayed = await projectRunStateFromEvents(root.id)
          expect(replayed?.promptHistory).toMatchObject({
            coverage: "complete",
            missingMessageIds: [],
            sessions: [{ sessionId: root.id, coverage: "complete" }],
            dispatches: [{ sessionId: root.id, dispatchOrdinal: 1 }],
          })
          expect(replayed?.assistantHistory.messages[0]?.settlement?.promptDispatch).toEqual({
            count: 1,
            finalEventId: replayed?.promptHistory.dispatches[0]?.eventId ?? null,
          })
        } finally {
          spies.restore()
        }
      },
    })
  })

  test("system replacement retains supplied-source metadata without claiming the originals survived", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const model = languageModel(async () => streamResult(successfulChunks()))
        const spies = installActualStreamingModel(model)
        const originalTrigger = Plugin.trigger
        const plugin = spyOn(Plugin, "trigger").mockImplementation(((name: string, ...args: unknown[]) => {
          if (name === "experimental.chat.system.transform") {
            const output = args[1] as { system: string[] }
            output.system.splice(0, output.system.length, "plugin replacement secret")
            return Promise.resolve(output)
          }
          return (originalTrigger as (...input: unknown[]) => Promise<unknown>)(name, ...args)
        }) as typeof Plugin.trigger)
        try {
          await SessionPrompt.loop({ sessionID: root.id })
          const dispatch = (await projectRunStateFromEvents(root.id))?.promptHistory.dispatches[0]
          expect(dispatch?.commitment.supplied.some((source) => source.kind === "reflection_policy")).toBe(true)
          const system = dispatch?.commitment.effective.filter((entry) => entry.channel === "system") ?? []
          expect(system).toEqual([
            expect.objectContaining({ origin: "transform_output", sourceIds: [] }),
          ])
          expect(JSON.stringify(await readRunEvents(root.id))).not.toContain("plugin replacement secret")
        } finally {
          plugin.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("message transformation commits the final instruction without claiming the supplied source survived", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await SessionPrompt.prompt({
          sessionID: root.id,
          agent: "plan",
          model: { providerID: testModel.providerID, modelID: testModel.id },
          parts: [{ type: "text", text: "Plan the work." }],
          noReply: true,
        })
        const replacement = "transformed plan instruction secret"
        const model = languageModel(async () => streamResult(successfulChunks()))
        const spies = installActualStreamingModel(model)
        const originalTrigger = Plugin.trigger
        const plugin = spyOn(Plugin, "trigger").mockImplementation(((name: string, ...args: unknown[]) => {
          if (name === "experimental.chat.messages.transform") {
            const output = args[1] as { messages: MessageV2.WithParts[] }
            for (const message of output.messages) {
              if (message.info.role !== "user") continue
              for (const part of message.parts) {
                if (part.type === "text" && part.synthetic) part.text = replacement
              }
            }
            return Promise.resolve(output)
          }
          return (originalTrigger as (...input: unknown[]) => Promise<unknown>)(name, ...args)
        }) as typeof Plugin.trigger)
        try {
          await SessionPrompt.loop({ sessionID: root.id })
          expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(replacement)
          const dispatch = (await projectRunStateFromEvents(root.id))?.promptHistory.dispatches[0]
          const source = dispatch?.commitment.supplied.find((candidate) => candidate.kind === "plan_reminder")
          expect(source).toBeDefined()
          const digest = `sha256:${createHash("sha256").update(JSON.stringify(replacement), "utf8").digest("hex")}`
          expect(dispatch?.commitment.effective).toContainEqual(
            expect.objectContaining({
              channel: "message",
              role: "user",
              origin: "transform_output",
              sourceIds: [],
              digest,
            }),
          )
          expect(JSON.stringify(await readRunEvents(root.id))).not.toContain(replacement)
        } finally {
          plugin.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("message transformation that destroys instruction identity fails before provider dispatch", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await SessionPrompt.prompt({
          sessionID: root.id,
          agent: "plan",
          model: { providerID: testModel.providerID, modelID: testModel.id },
          parts: [{ type: "text", text: "Plan the work." }],
          noReply: true,
        })
        let providerCalls = 0
        const model = languageModel(async () => {
          providerCalls++
          return streamResult(successfulChunks())
        })
        const spies = installActualStreamingModel(model)
        const retryable = spyOn(SessionRetry, "retryable").mockReturnValue("must-not-retry")
        const originalTrigger = Plugin.trigger
        const plugin = spyOn(Plugin, "trigger").mockImplementation(((name: string, ...args: unknown[]) => {
          if (name === "experimental.chat.messages.transform") {
            const output = args[1] as { messages: MessageV2.WithParts[] }
            for (const message of output.messages) {
              if (message.info.role !== "user") continue
              message.parts = message.parts.filter((part) => part.type !== "text" || !part.synthetic)
            }
            return Promise.resolve(output)
          }
          return (originalTrigger as (...input: unknown[]) => Promise<unknown>)(name, ...args)
        }) as typeof Plugin.trigger)
        try {
          const error = await rejection(SessionPrompt.loop({ sessionID: root.id }))
          expect(error).toMatchObject({
            name: "PromptProvenancePersistenceError",
            code: "prompt_provenance_persistence_failed",
            stage: "dispatch",
          })
          expect(providerCalls).toBe(0)
          expect(retryable).not.toHaveBeenCalled()
          const state = await projectRunStateFromEvents(root.id)
          expect(state?.promptHistory.dispatches).toHaveLength(0)
          expect(state?.assistantHistory.unsettledMessageIds).toHaveLength(1)
          expect(state?.completion).toBeNull()
          expect(state?.artifactIds).toEqual([])
        } finally {
          plugin.mockRestore()
          retryable.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("captures a plugin-replaced compaction prompt as an effective user-role instruction", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const messages = await Session.messages({ sessionID: root.id })
        const parent = messages.findLast((message) => message.info.role === "user")
        if (!parent) throw new Error("missing compaction parent")
        const model = languageModel(async () => streamResult(successfulChunks("summary")))
        const spies = installActualStreamingModel(model)
        const originalTrigger = Plugin.trigger
        const plugin = spyOn(Plugin, "trigger").mockImplementation(((name: string, ...args: unknown[]) => {
          if (name === "experimental.session.compacting") {
            const output = args[1] as { context: string[]; prompt?: string }
            output.prompt = "replacement compaction secret"
            return Promise.resolve(output)
          }
          return (originalTrigger as (...input: unknown[]) => Promise<unknown>)(name, ...args)
        }) as typeof Plugin.trigger)
        try {
          await SessionCompaction.process({
            parentID: parent.info.id,
            messages,
            sessionID: root.id,
            abort: new AbortController().signal,
            auto: false,
          })
          const dispatch = (await projectRunStateFromEvents(root.id))?.promptHistory.dispatches[0]
          const source = dispatch?.commitment.supplied.find((candidate) => candidate.kind === "compaction_prompt")
          expect(source?.reference).toBe("plugin-replacement")
          expect(dispatch?.commitment.effective).toContainEqual(
            expect.objectContaining({
              channel: "message",
              role: "user",
              origin: "supplied",
              sourceIds: [source?.sourceId],
            }),
          )
          expect(JSON.stringify(await readRunEvents(root.id))).not.toContain("replacement compaction secret")
        } finally {
          plugin.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("captures turn-limit guidance independently of message role", async () => {
    await fs.writeFile(path.join(testProject, "dax.json"), JSON.stringify({ agent: { build: { steps: 1 } } }))
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const model = languageModel(async () => streamResult(successfulChunks()))
        const spies = installActualStreamingModel(model)
        try {
          await SessionPrompt.loop({ sessionID: root.id })
          const dispatch = (await projectRunStateFromEvents(root.id))?.promptHistory.dispatches[0]
          const source = dispatch?.commitment.supplied.find((candidate) => candidate.kind === "turn_limit")
          expect(source).toMatchObject({ channel: "message", role: "assistant", reference: "max-steps" })
          expect(dispatch?.commitment.effective).toContainEqual(
            expect.objectContaining({
              channel: "message",
              role: "assistant",
              origin: "supplied",
              sourceIds: [source?.sourceId],
            }),
          )
        } finally {
          spies.restore()
        }
      },
    })
  })

  test("processor retries create distinct dispatch ordinals while SDK retries stay disabled", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        let providerCalls = 0
        const model = languageModel(async () => {
          providerCalls++
          if (providerCalls === 1) throw new Error("retryable provider failure")
          return streamResult(successfulChunks())
        })
        const spies = installActualStreamingModel(model)
        const retryable = spyOn(SessionRetry, "retryable").mockImplementation((_error, attempt) =>
          attempt === 0 ? "retry" : undefined,
        )
        const sleep = spyOn(SessionRetry, "sleep").mockResolvedValue(undefined)
        try {
          await SessionPrompt.loop({ sessionID: root.id })
          expect(providerCalls).toBe(2)
          expect(model.doStreamCalls).toHaveLength(2)
          const state = await projectRunStateFromEvents(root.id)
          expect(state?.promptHistory.dispatches.map((dispatch) => dispatch.dispatchOrdinal)).toEqual([1, 2])
          expect(state?.assistantHistory.messages[0]?.settlement?.promptDispatch).toEqual({
            count: 2,
            finalEventId: state?.promptHistory.dispatches[1]?.eventId ?? null,
          })
        } finally {
          sleep.mockRestore()
          retryable.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("a rejected persistence append escapes processor and SDK retries before any provider call", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        let providerCalls = 0
        const model = languageModel(async () => {
          providerCalls++
          return streamResult(successfulChunks())
        })
        const spies = installActualStreamingModel(model)
        const retryable = spyOn(SessionRetry, "retryable").mockReturnValue("must-not-retry")
        const originalWrite = Storage.write
        const write = spyOn(Storage, "write").mockImplementation(async (key, value) => {
          if (
            key[0] === "run_events" &&
            Array.isArray(value) &&
            value.at(-1)?.type === "prompt_contribution_recorded"
          ) {
            throw new Error("storage detail containing secret")
          }
          return originalWrite(key, value)
        })
        try {
          const error = await rejection(SessionPrompt.loop({ sessionID: root.id }))
          expect(error).toMatchObject({
            name: "PromptProvenancePersistenceError",
            code: "prompt_provenance_persistence_failed",
            stage: "dispatch",
          })
          expect(providerCalls).toBe(0)
          expect(retryable).not.toHaveBeenCalled()
          const state = await projectRunStateFromEvents(root.id)
          expect(state?.promptHistory.dispatches).toHaveLength(0)
          expect(state?.assistantHistory.unsettledMessageIds).toHaveLength(1)
          expect(state?.completion).toBeNull()
          expect(state?.artifactIds).toEqual([])
          expect(JSON.stringify(await readRunEvents(root.id))).not.toContain("storage detail containing secret")
        } finally {
          write.mockRestore()
          retryable.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("configured SDK retries cannot repeat a rejected provenance append", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const user = (await Session.messages({ sessionID: root.id })).findLast(
          (message) => message.info.role === "user",
        )
        if (!user || user.info.role !== "user") throw new Error("missing user")
        const assistant = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: user.info.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: Instance.directory, root: Instance.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: testModel.id,
          providerID: testModel.providerID,
          time: { created: Date.now() },
          sessionID: root.id,
        })) as MessageV2.Assistant
        const processor = SessionProcessor.create({
          assistantMessage: assistant,
          sessionID: root.id,
          model: testModel,
          abort: new AbortController().signal,
        })
        let providerCalls = 0
        const model = languageModel(async () => {
          providerCalls++
          return streamResult(successfulChunks())
        })
        const spies = installActualStreamingModel(model)
        const retryable = spyOn(SessionRetry, "retryable").mockReturnValue("must-not-retry")
        const originalWrite = Storage.write
        let rejectedPromptWrites = 0
        const write = spyOn(Storage, "write").mockImplementation(async (key, value) => {
          if (
            key[0] === "run_events" &&
            Array.isArray(value) &&
            value.at(-1)?.type === "prompt_contribution_recorded"
          ) {
            rejectedPromptWrites++
            throw new Error("reject prompt append")
          }
          return originalWrite(key, value)
        })
        try {
          const error = await rejection(
            processor.process({
              user: user.info,
              sessionID: root.id,
              model: testModel,
              agent: await Agent.get("build"),
              abort: new AbortController().signal,
              system: [],
              messages: MessageV2.toModelMessages([user], testModel) as ModelMessage[],
              tools: {},
              retries: 3,
            }),
          )
          expect(error).toMatchObject({ code: "prompt_provenance_persistence_failed", stage: "dispatch" })
          expect(rejectedPromptWrites).toBe(1)
          expect(providerCalls).toBe(0)
          expect(retryable).not.toHaveBeenCalled()
          const state = await projectRunStateFromEvents(root.id)
          expect(state?.completion).toBeNull()
          expect(state?.artifactIds).toEqual([])
        } finally {
          write.mockRestore()
          retryable.mockRestore()
          spies.restore()
        }
      },
    })
  })

  test("an uncertain append prevents dispatch and restart does not execute a replacement message", async () => {
    let sessionID = ""
    let providerCalls = 0
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        sessionID = root.id
        await prepareConversation(root.id)
        const model = languageModel(async () => {
          providerCalls++
          return streamResult(successfulChunks())
        })
        const spies = installActualStreamingModel(model)
        const originalRename = Storage.rename
        let promptWriteReached = false
        const originalWrite = Storage.write
        const write = spyOn(Storage, "write").mockImplementation(async (key, value) => {
          promptWriteReached =
            key[0] === "run_events" &&
            Array.isArray(value) &&
            value.at(-1)?.type === "prompt_contribution_recorded"
          return originalWrite(key, value)
        })
        const rename = spyOn(Storage, "rename").mockImplementation(async (from, to) => {
          await originalRename(from, to)
          if (promptWriteReached) throw new Error("uncertain rename result")
        })
        try {
          const error = await rejection(SessionPrompt.loop({ sessionID: root.id }))
          expect(error).toMatchObject({ code: "prompt_provenance_persistence_failed", stage: "dispatch" })
          expect(providerCalls).toBe(0)
          expect((await readRunEvents(root.id)).filter((event) => event.type === "prompt_contribution_recorded")).toHaveLength(1)
        } finally {
          rename.mockRestore()
          write.mockRestore()
          spies.restore()
        }
      },
    })

    await Instance.disposeAll()
    await Instance.provide({
      directory: testProject,
      async fn() {
        const model = languageModel(async () => {
          providerCalls++
          return streamResult(successfulChunks())
        })
        const spies = installActualStreamingModel(model)
        try {
          const error = await rejection(SessionPrompt.loop({ sessionID }))
          expect(error).toMatchObject({ code: "assistant_provenance_recovery_required" })
          expect(providerCalls).toBe(0)
          expect((await Session.messages({ sessionID })).filter((message) => message.info.role === "assistant")).toHaveLength(1)
          const state = await projectRunStateFromEvents(sessionID)
          expect(state?.completion).toBeNull()
          expect(state?.artifactIds).toEqual([])
        } finally {
          spies.restore()
        }
      },
    })
  })

  test("two adapter dispatches with one missing record cannot settle and leave the journal unchanged", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const user = (await Session.messages({ sessionID: root.id })).findLast(
          (message) => message.info.role === "user",
        )
        if (!user || user.info.role !== "user") throw new Error("missing user")
        const assistant = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: user.info.id,
          role: "assistant",
          mode: "build",
          agent: "build",
          path: { cwd: Instance.directory, root: Instance.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: testModel.id,
          providerID: testModel.providerID,
          time: { created: Date.now() },
          sessionID: root.id,
        })) as MessageV2.Assistant
        const context = await openAssistantMessageProvenance({ assistantMessage: assistant })
        if (!context) throw new Error("missing canonical assistant context")
        const realTracker = createPromptProvenanceTracker(context)
        let requested = 0
        const skippingTracker = {
          messageId: context.messageId,
          async record(input: Parameters<PromptProvenanceTracker["record"]>[0]) {
            requested++
            if (requested === 1) await realTracker.record(input)
          },
          settlement() {
            return { count: requested, finalEventId: realTracker.settlement().finalEventId }
          },
          enrolled() {
            return realTracker.enrolled()
          },
        } satisfies PromptProvenanceTracker
        let providerCalls = 0
        const model = languageModel(async () => {
          providerCalls++
          return streamResult(successfulChunks())
        })
        const spies = installActualStreamingModel(model)
        const agent = await Agent.get("build")
        const streamInput = {
          user: user.info,
          sessionID: root.id,
          model: testModel,
          agent,
          system: [],
          abort: new AbortController().signal,
          messages: MessageV2.toModelMessages([user], testModel) as ModelMessage[],
          tools: {},
          promptProvenance: skippingTracker,
        }
        try {
          await consume(await LLM.stream(streamInput))
          await consume(await LLM.stream(streamInput))
          expect(providerCalls).toBe(2)
          expect(requested).toBe(2)
          const before = await readRunEvents(root.id)
          expect(await rejection(settlement(context, skippingTracker.settlement()))).toBeInstanceOf(Error)
          expect(await readRunEvents(root.id)).toEqual(before)
          const state = await projectRunStateFromEvents(root.id)
          expect(state?.promptHistory.dispatches).toHaveLength(1)
          expect(state?.assistantHistory.unsettledMessageIds).toEqual([context.messageId])
        } finally {
          spies.restore()
        }
      },
    })
  })

  test("predispatch failure may settle failed with zero dispatches", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const getLanguage = spyOn(Provider, "getLanguage").mockRejectedValue(new Error("model unavailable"))
        const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
        const retryable = spyOn(SessionRetry, "retryable").mockReturnValue(undefined)
        try {
          await SessionPrompt.loop({ sessionID: root.id })
          const state = await projectRunStateFromEvents(root.id)
          expect(state?.promptHistory.dispatches).toHaveLength(0)
          expect(state?.assistantHistory.messages[0]?.settlement?.status).toBe("failed")
          expect(state?.assistantHistory.messages[0]?.settlement).not.toHaveProperty("promptDispatch")
        } finally {
          retryable.mockRestore()
          summary.mockRestore()
          getLanguage.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  })

  test("an enrolled later predispatch failure settles with an explicit zero-dispatch binding", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const model = languageModel(async () => streamResult(successfulChunks()))
        const spies = installActualStreamingModel(model)
        try {
          await SessionPrompt.loop({ sessionID: root.id })
        } finally {
          spies.restore()
        }

        await prepareConversation(root.id, "Second request.")
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const getLanguage = spyOn(Provider, "getLanguage").mockRejectedValue(new Error("model unavailable"))
        const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
        const retryable = spyOn(SessionRetry, "retryable").mockReturnValue(undefined)
        try {
          expect(await SessionPrompt.loop({ sessionID: root.id }).then(() => null, (error) => error)).toBeNull()
          const state = await projectRunStateFromEvents(root.id)
          const message = state?.assistantHistory.messages.at(-1)
          expect(message?.settlement).toMatchObject({
            status: "failed",
            promptDispatch: { count: 0, finalEventId: null },
          })
          expect(state?.assistantHistory.unsettledMessageIds).not.toContain(message?.messageId)
          expect(
            state?.promptHistory.dispatches.filter((dispatch) => dispatch.messageId === message?.messageId),
          ).toHaveLength(0)
        } finally {
          retryable.mockRestore()
          summary.mockRestore()
          getLanguage.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  })

  test("mixed unmarked root and newly marked fork remains partial rather than globally complete", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const oldMessageId = Identifier.ascending("message")
        const markerState = await startAssistantRecording(root.id, {
          sessionId: root.id,
          priorScopeHistory: "none",
          copiedHistory: "none",
          cutoverMessageId: oldMessageId,
        })
        const marker = markerState.assistantHistory.sessions.find((session) => session.sessionId === root.id)
        if (!marker?.markerEventId) throw new Error("missing assistant marker")
        await recordAssistantMessageOpened(root.id, marker.markerEventId, {
          phase: "opened",
          scope: "session_processor_v1",
          sessionId: root.id,
          messageId: oldMessageId,
          parentMessageId: "historical-user",
          providerId: testModel.providerID,
          modelId: testModel.id,
          agent: "build",
          summary: false,
          source: { kind: "root" },
        })
        await recordAssistantMessageSettled(
          root.id,
          (await projectRunStateFromEvents(root.id))!.assistantHistory.messages[0]!.openedEventId,
          {
            phase: "settled",
            scope: "session_processor_v1",
            sessionId: root.id,
            messageId: oldMessageId,
            status: "completed",
            finishReason: "stop",
            attemptCount: 1,
            usage: {
              basis: "reported_finish_steps_only",
              finishStepCount: 1,
              input: 1,
              output: 1,
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
        )

        const child = await Session.fork({ sessionID: root.id })
        await prepareConversation(child.id, "new child turn")
        const model = languageModel(async () => streamResult(successfulChunks()))
        const spies = installActualStreamingModel(model)
        try {
          await SessionPrompt.loop({ sessionID: child.id })
          const state = await projectRunStateFromEvents(root.id)
          expect(state?.promptHistory.sessions).toContainEqual(
            expect.objectContaining({ sessionId: root.id, coverage: "unavailable", markerEventId: null }),
          )
          expect(state?.promptHistory.sessions).toContainEqual(
            expect.objectContaining({ sessionId: child.id, coverage: "complete" }),
          )
          expect(state?.promptHistory.coverage).toBe("partial")
        } finally {
          spies.restore()
        }
      },
    })
  })

  test("completion checks run before artifacts and direct terminal append cannot bypass unsettled prompt state", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const { root } = await governedRoot()
        await prepareConversation(root.id)
        const model = languageModel(async () => streamResult(successfulChunks()))
        const spies = installActualStreamingModel(model)
        try {
          await SessionPrompt.loop({ sessionID: root.id })
          const settled = (await Session.messages({ sessionID: root.id })).findLast(
            (message) => message.info.role === "assistant",
          )
          if (!settled || settled.info.role !== "assistant") throw new Error("missing settled assistant")
          const marker = (await projectRunStateFromEvents(root.id))?.assistantHistory.sessions[0]?.markerEventId
          if (!marker) throw new Error("missing assistant marker")
          const openId = Identifier.ascending("message")
          await recordAssistantMessageOpened(root.id, marker, {
            phase: "opened",
            scope: "session_processor_v1",
            sessionId: root.id,
            messageId: openId,
            parentMessageId: settled.info.parentID,
            providerId: testModel.providerID,
            modelId: testModel.id,
            agent: "build",
            summary: false,
            source: { kind: "root" },
          })
          const before = await readRunEvents(root.id)
          const decision = await adjudicateNativeCompletionCandidate({
            sessionID: root.id,
            assistantMessageID: settled.info.id,
            finishReason: "stop",
            hasError: false,
          })
          expect(decision.accepted).toBe(false)
          expect((await projectRunStateFromEvents(root.id))?.artifactIds).toEqual([])
          expect(await rejection(appendRunEventAtTail(root.id, { type: "run_completed", payload: {} }))).toBeInstanceOf(Error)
          expect(await readRunEvents(root.id)).toEqual(before)
        } finally {
          spies.restore()
        }
      },
    })
  })
})
