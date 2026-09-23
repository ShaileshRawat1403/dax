import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { simulateReadableStream } from "ai"
import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2StreamPart } from "@ai-sdk/provider"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionCompaction } from "@/session/compaction"
import { SessionRetry } from "@/session/retry"
import { SessionSummary } from "@/session/summary"
import { Plugin } from "@/plugin"
import { MessageV2 } from "@/session/message-v2"
import { Provider } from "@/provider/provider"
import { Storage } from "@/storage/storage"
import { Identifier } from "@/id/id"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import {
  beginCompactionAttempt,
  CompactionProvenancePersistenceError,
  CompactionRecoveryRequiredError,
  resolveCompactedMessages,
} from "@/execution/compaction-provenance"
import { commitCompactionPrefix } from "@/execution/compaction-prefix"
import { collectVerificationSignals } from "@/governance/trust-verification"
import { createEventAuthorityRun, transitionEventAuthority } from "@/state/events/event-transitions"
import { appendRunEventAtTail, projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"
import { reduceRunState } from "@/state/events/run-reducer"

let testHome = ""
let oldHome: string | undefined
let project = ""

const testModel = Provider.Model.parse({
  id: "compaction-test-model",
  providerID: "compaction-test",
  name: "Compaction provenance test model",
  api: { id: "compaction-test-model", url: "https://example.invalid", npm: "@ai-sdk/openai" },
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
  oldHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-compaction-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  project = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  await fs.mkdir(project, { recursive: true })
  await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (oldHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = oldHome
  await fs.rm(testHome, { recursive: true, force: true })
})

function chunks(text: string, finishReason: "stop" | "length" | "tool-calls" = "stop"): LanguageModelV2StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "summary" },
    ...(text ? [{ type: "text-delta" as const, id: "summary", delta: text }] : []),
    { type: "text-end", id: "summary" },
    { type: "finish", finishReason, usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
  ]
}

function installProvider(produce: (call: number) => LanguageModelV2StreamPart[]) {
  let calls = 0
  const prompts: LanguageModelV2CallOptions["prompt"][] = []
  const model: LanguageModelV2 = {
    specificationVersion: "v2",
    provider: testModel.providerID,
    modelId: testModel.id,
    supportedUrls: {},
    async doGenerate() { throw new Error("unexpected generation") },
    async doStream(options) {
      calls++
      prompts.push(options.prompt)
      return {
        stream: simulateReadableStream({
          chunks: produce(calls),
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      }
    },
  }
  const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
  const getProvider = spyOn(Provider, "getProvider").mockResolvedValue(Provider.Info.parse({
    id: testModel.providerID,
    name: "Compaction test provider",
    source: "custom",
    env: [],
    options: {},
    models: { [testModel.id]: testModel },
  }))
  const getLanguage = spyOn(Provider, "getLanguage").mockResolvedValue(model)
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  return {
    get calls() { return calls },
    prompts,
    restore() { summary.mockRestore(); getLanguage.mockRestore(); getProvider.mockRestore(); getModel.mockRestore() },
  }
}

async function governed() {
  const root = await Session.create({ title: "Compaction provenance root" })
  const { contract } = compileWithRunId({ request: { intent: { input: "Summarize governed history." } } }, root.id)
  await ContractGuardian.create(root.id, contract)
  await Session.bindGoverningRun(root.id, root.id)
  await createEventAuthorityRun(root.id, contract.contractId)
  await transitionEventAuthority(root.id, "queued", "execution_queued", {})
  await transitionEventAuthority(root.id, "running", "execution_started", {})
  return root
}

async function marker(sessionId: string, text = "Prior context with secret sk-compaction-secret") {
  await SessionPrompt.prompt({
    sessionID: sessionId,
    model: { providerID: testModel.providerID, modelID: testModel.id },
    parts: [{ type: "text", text }],
    noReply: true,
  })
  const messages = await Session.messages({ sessionID: sessionId })
  const parent = messages.findLast((message) => message.info.role === "user")
  if (!parent) throw new Error("missing marker")
  return { parent, messages }
}

async function produceCompaction(sessionId: string, input: Awaited<ReturnType<typeof marker>>, abort = new AbortController().signal) {
  return SessionCompaction.process({
    parentID: input.parent.info.id,
    messages: input.messages,
    sessionID: sessionId,
    abort,
    auto: false,
  })
}

async function rejection(promise: Promise<unknown>) {
  try { await promise; throw new Error("expected rejection") } catch (error) { return error }
}

describe("production compaction-replacement provenance", () => {
  test("binds the actual prefix, adopts a committed summary, and replays without session storage", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      await marker(root.id)
      const input = await marker(root.id, "Current marker")
      const provider = installProvider(() => chunks("Usable summary with secret sk-summary-secret"))
      try {
        expect(await produceCompaction(root.id, input)).toBe("continue")
        expect(provider.calls).toBe(1)
        const events = await readRunEvents(root.id)
        const state = reduceRunState(events)
        if (!state) throw new Error("missing replay state")
        const attempt = state.compactionHistory.attempts[0]!
        expect(attempt.status).toBe("adopted")
        expect(attempt.prefix.messageIds).toEqual(input.messages.map((message) => message.info.id))
        expect(state.compactionHistory.sessions.find((session) => session.sessionId === root.id)?.replacementEventId).toBe(attempt.outcomeEventId)
        const visible = await resolveCompactedMessages(root.id)
        expect(visible.map((message) => message.info.id)).toContain(attempt.summaryMessageId)
        expect(visible.map((message) => message.info.id)).not.toContain(input.messages[0]!.info.id)
        expect(JSON.stringify(events)).not.toContain("sk-compaction-secret")
        expect(JSON.stringify(events)).not.toContain("sk-summary-secret")
        const replacement = events.find((event) => event.type === "compaction_replacement_recorded")
        if (!replacement || replacement.type !== "compaction_replacement_recorded") throw new Error("missing replacement event")
        for (const commandId of [replacement.commandId!, `second_${replacement.commandId}`]) {
          expect(await rejection(appendRunEventAtTail(root.id, {
            type: replacement.type, payload: replacement.payload,
            causationId: replacement.causationId, correlationId: replacement.correlationId,
            commandId,
          }, { rejectDuplicateCommand: true }))).toBeInstanceOf(Error)
          expect(await readRunEvents(root.id)).toEqual(events)
        }
        await Session.remove(root.id)
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts[0]).toMatchObject({
          status: "adopted", prefix: attempt.prefix, outcomeEventId: attempt.outcomeEventId,
        })
      } finally { provider.restore() }
    } })
  })

  test.each(["length", "tool-calls"] as const)("%s finish durably closes without adoption", async (finish) => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => chunks("A truncated candidate", finish))
      try {
        expect(await produceCompaction(root.id, input)).toBe("stop")
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts[0]).toMatchObject({
          status: "not_adopted", reason: "finish_not_stop",
        })
        expect((await resolveCompactedMessages(root.id)).map((message) => message.info.id)).toContain(input.parent.info.id)
      } finally { provider.restore() }
    } })
  })

  test("empty finalized summary is terminal non-adoption", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => chunks(""))
      try {
        expect(await produceCompaction(root.id, input)).toBe("stop")
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts[0]).toMatchObject({
          status: "not_adopted", reason: "empty_summary",
        })
      } finally { provider.restore() }
    } })
  })

  test("a later message stays outside the bound provider prefix and survives replacement", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => chunks("Bound summary"))
      const originalTrigger = Plugin.trigger
      const plugin = spyOn(Plugin, "trigger").mockImplementation(((name: string, ...args: unknown[]) => {
        if (name === "experimental.session.compacting") {
          return (async () => {
            const later = await Session.updateMessage({
              id: Identifier.ascending("message"),
              sessionID: root.id,
              role: "user",
              time: { created: Date.now() },
              agent: "build",
              model: { providerID: testModel.providerID, modelID: testModel.id },
            })
            await Session.updatePart({
              id: Identifier.ascending("part"),
              sessionID: root.id,
              messageID: later.id,
              type: "text",
              text: "Later message outside the bound prefix",
            })
            return args[1]
          })()
        }
        return (originalTrigger as (...input: unknown[]) => Promise<unknown>)(name, ...args)
      }) as typeof Plugin.trigger)
      try {
        expect(await produceCompaction(root.id, input)).toBe("continue")
        expect(JSON.stringify(provider.prompts)).not.toContain("Later message outside the bound prefix")
        const active = await resolveCompactedMessages(root.id)
        expect(JSON.stringify(active)).toContain("Later message outside the bound prefix")
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts[0]?.prefix.messageIds).toEqual(
          input.messages.map((message) => message.info.id),
        )
      } finally { plugin.mockRestore(); provider.restore() }
    } })
  })

  test("ordinary provider retry retains one attempt and records each dispatch", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      let calls = 0
      const model: LanguageModelV2 = {
        specificationVersion: "v2", provider: testModel.providerID, modelId: testModel.id, supportedUrls: {},
        async doGenerate() { throw new Error("unexpected generation") },
        async doStream() {
          calls++
          if (calls === 1) throw new Error("provider temporarily unavailable")
          return { stream: simulateReadableStream({ chunks: chunks("Summary after retry"), initialDelayInMs: null, chunkDelayInMs: null }) }
        },
      }
      const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
      const getProvider = spyOn(Provider, "getProvider").mockResolvedValue(Provider.Info.parse({
        id: testModel.providerID, name: "Compaction test provider", source: "custom", env: [], options: {},
        models: { [testModel.id]: testModel },
      }))
      const getLanguage = spyOn(Provider, "getLanguage").mockResolvedValue(model)
      const retry = spyOn(SessionRetry, "retryable").mockImplementation((_error, ordinal) => ordinal === 0 ? "retry" : undefined)
      const sleep = spyOn(SessionRetry, "sleep").mockResolvedValue(undefined)
      const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
      try {
        expect(await produceCompaction(root.id, input)).toBe("continue")
        const state = await projectRunStateFromEvents(root.id)
        expect(calls).toBe(2)
        expect(state?.compactionHistory.attempts).toHaveLength(1)
        expect(state?.compactionHistory.attempts[0]?.status).toBe("adopted")
        expect(state?.promptHistory.dispatches.map((dispatch) => dispatch.dispatchOrdinal)).toEqual([1, 2])
        expect(state?.contextHistory.dispatches.map((dispatch) => dispatch.dispatchOrdinal)).toEqual([1, 2])
        expect(state?.assistantHistory.messages[0]?.settlement?.attemptCount).toBe(2)
      } finally { summary.mockRestore(); sleep.mockRestore(); retry.mockRestore(); getLanguage.mockRestore(); getProvider.mockRestore(); getModel.mockRestore() }
    } })
  })

  test("interrupted retry text cannot make an empty finalized summary adoptable", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider((call) => call === 1
        ? [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "partial" },
            { type: "text-delta", id: "partial", delta: "interrupted text must not become summary" },
            { type: "error", error: new Error("retry") },
          ]
        : chunks(""))
      const retry = spyOn(SessionRetry, "retryable").mockImplementation((_error, ordinal) => ordinal === 0 ? "retry" : undefined)
      const sleep = spyOn(SessionRetry, "sleep").mockResolvedValue(undefined)
      try {
        expect(await produceCompaction(root.id, input)).toBe("stop")
        const state = await projectRunStateFromEvents(root.id)
        expect(provider.calls).toBe(2)
        expect(state?.compactionHistory.attempts[0]).toMatchObject({ status: "not_adopted", reason: "empty_summary" })
        expect(state?.assistantHistory.messages[0]?.settlement?.text.interruptedPartCount).toBeGreaterThan(0)
      } finally { sleep.mockRestore(); retry.mockRestore(); provider.restore() }
    } })
  })

  test("terminal provider failure closes the attempt without replacement", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => [
        { type: "stream-start", warnings: [] },
        { type: "error", error: new Error("provider failed with secret sk-error") },
      ])
      try {
        expect(await produceCompaction(root.id, input)).toBe("stop")
        const state = await projectRunStateFromEvents(root.id)
        expect(state?.compactionHistory.attempts[0]).toMatchObject({ status: "not_adopted", reason: "failed" })
        expect(state?.assistantHistory.messages[0]?.settlement?.status).toBe("failed")
        expect(JSON.stringify(await readRunEvents(root.id))).not.toContain("sk-error")
        expect(provider.calls).toBe(1)
      } finally { provider.restore() }
    } })
  })

  test.each(["stream_exhaustion", "text_plugin_failure"] as const)("%s cannot adopt a summary", async (scenario) => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => scenario === "stream_exhaustion"
        ? [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "summary" },
            { type: "text-delta", id: "summary", delta: "unfinished" },
          ]
        : chunks("text rejected by plugin"))
      const originalTrigger = Plugin.trigger
      const plugin = scenario === "text_plugin_failure"
        ? spyOn(Plugin, "trigger").mockImplementation(((name: string, ...args: unknown[]) => {
            if (name === "experimental.text.complete") return Promise.reject(new Error("plugin output secret"))
            return (originalTrigger as (...input: unknown[]) => Promise<unknown>)(name, ...args)
          }) as typeof Plugin.trigger)
        : undefined
      try {
        expect(await produceCompaction(root.id, input)).toBe("stop")
        const state = await projectRunStateFromEvents(root.id)
        expect(state?.compactionHistory.attempts[0]).toMatchObject({
          status: "not_adopted",
          reason: scenario === "stream_exhaustion" ? "finish_not_stop" : "failed",
        })
        if (scenario === "text_plugin_failure") expect(state?.assistantHistory.messages[0]?.settlement?.status).toBe("failed")
        expect(provider.calls).toBe(1)
        expect(JSON.stringify(await readRunEvents(root.id))).not.toContain("plugin output secret")
      } finally { plugin?.mockRestore(); provider.restore() }
    } })
  })

  test("cancellation during retry backoff closes the same attempt", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const abort = new AbortController()
      const provider = installProvider(() => [{ type: "stream-start", warnings: [] }, { type: "error", error: new Error("retry") }])
      const retry = spyOn(SessionRetry, "retryable").mockReturnValue("retry")
      const sleep = spyOn(SessionRetry, "sleep").mockImplementation(async () => {
        abort.abort(new DOMException("Aborted", "AbortError"))
        throw abort.signal.reason
      })
      try {
        expect(await produceCompaction(root.id, input, abort.signal)).toBe("stop")
        const state = await projectRunStateFromEvents(root.id)
        expect(state?.compactionHistory.attempts[0]).toMatchObject({ status: "not_adopted", reason: "cancelled" })
        expect(state?.assistantHistory.messages[0]?.settlement?.status).toBe("cancelled")
        expect(provider.calls).toBe(1)
      } finally { sleep.mockRestore(); retry.mockRestore(); provider.restore() }
    } })
  })

  test("a second replacement binds the advanced boundary rather than the original prefix", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const earlier = await marker(root.id, "Older history")
      const first = await marker(root.id, "First compaction marker")
      const provider = installProvider(() => chunks("A usable summary"))
      try {
        expect(await produceCompaction(root.id, first)).toBe("continue")
        const firstAttempt = (await projectRunStateFromEvents(root.id))!.compactionHistory.attempts[0]!
        const second = await marker(root.id, "Later compaction marker")
        expect(await produceCompaction(root.id, second)).toBe("continue")
        const attempts = (await projectRunStateFromEvents(root.id))!.compactionHistory.attempts
        expect(attempts).toHaveLength(2)
        expect(attempts[1]!.previousReplacementEventId).toBe(firstAttempt.outcomeEventId)
        expect(attempts[1]!.prefix.messageIds).toContain(firstAttempt.summaryMessageId)
        expect(attempts[1]!.prefix.messageIds).toContain(first.parent.info.id)
        expect(attempts[1]!.prefix.messageIds).not.toContain(earlier.parent.info.id)
        expect(provider.calls).toBe(2)
      } finally { provider.restore() }
    } })
  })

  test("an unmarked historical summary stays explicitly partial at cutover", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const old = await marker(root.id, "Historical marker")
      const oldSummary = await Session.updateMessage({
        id: Identifier.ascending("message"), role: "assistant", parentID: old.parent.info.id,
        sessionID: root.id, mode: "compaction", agent: "compaction", summary: true,
        modelID: testModel.id, providerID: testModel.providerID,
        path: { cwd: project, root: project }, cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        finish: "stop", time: { created: Date.now(), completed: Date.now() },
      })
      await Session.updatePart({
        id: Identifier.ascending("part"), sessionID: root.id, messageID: oldSummary.id,
        type: "text", text: "Old uncommitted summary", time: { start: Date.now(), end: Date.now() },
      })
      const current = await marker(root.id, "First enrolled marker")
      const provider = installProvider(() => chunks("New committed summary"))
      try {
        expect(await produceCompaction(root.id, current)).toBe("continue")
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.sessions.find((session) => session.sessionId === root.id)).toMatchObject({
          coverage: "partial", priorScopeHistory: "unavailable", markerEventId: expect.any(String),
        })
        expect((await resolveCompactedMessages(root.id)).map((message) => message.info.id)).not.toContain(oldSummary.id)
      } finally { provider.restore() }
    } })
  })

  test("an interrupted bound attempt blocks resume before another model call", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const bound = await beginCompactionAttempt({
        sessionId: root.id, markerMessageId: input.parent.info.id, summaryMessageId: Identifier.ascending("message"),
      })
      expect(bound?.attempt.status).toBe("open")
      await Instance.disposeAll()
      const provider = installProvider(() => chunks("must not run"))
      try {
        const error = await rejection(SessionPrompt.loop({ sessionID: root.id }))
        expect(error).toBeInstanceOf(CompactionRecoveryRequiredError)
        expect(provider.calls).toBe(0)
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts[0]?.status).toBe("open")
      } finally { provider.restore() }
    } })
  })

  test("summary text mutation prevents adoption on every filtering caller", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => chunks("Verified summary"))
      try {
        await produceCompaction(root.id, input)
        const summaryId = (await projectRunStateFromEvents(root.id))!.compactionHistory.attempts[0]!.summaryMessageId
        const part = (await MessageV2.parts(summaryId)).find((candidate) => candidate.type === "text")
        if (!part || part.type !== "text") throw new Error("missing summary text")
        await Session.updatePart({ ...part, text: "Changed summary" })
        expect(await rejection(resolveCompactedMessages(root.id))).toBeInstanceOf(CompactionRecoveryRequiredError)
        expect(await rejection(collectVerificationSignals(root.id))).toBeInstanceOf(CompactionRecoveryRequiredError)
        expect(await rejection(SessionPrompt.prompt({
          sessionID: root.id,
          model: { providerID: testModel.providerID, modelID: testModel.id },
          parts: [{ type: "text", text: "Try continuation" }],
        }))).toBeInstanceOf(CompactionRecoveryRequiredError)
        expect(provider.calls).toBe(1)
      } finally { provider.restore() }
    } })
  })

  test("an extra finalized summary part also requires recovery before dispatch", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => chunks("Verified summary"))
      try {
        await produceCompaction(root.id, input)
        const summaryId = (await projectRunStateFromEvents(root.id))!.compactionHistory.attempts[0]!.summaryMessageId
        await Session.updatePart({
          id: Identifier.ascending("part"), sessionID: root.id, messageID: summaryId,
          type: "text", text: "Uncommitted extra summary", time: { start: Date.now(), end: Date.now() },
        })
        expect(await rejection(resolveCompactedMessages(root.id))).toBeInstanceOf(CompactionRecoveryRequiredError)
        expect(provider.calls).toBe(1)
      } finally { provider.restore() }
    } })
  })

  test("attempt append failure creates no summary or provider call", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => chunks("must not run"))
      const retryable = spyOn(SessionRetry, "retryable")
      const originalWrite = Storage.write
      const write = spyOn(Storage, "write")
      try {
        write.mockImplementation(async (key, value) => {
          if (key[0] === "run_events" && Array.isArray(value) && value.at(-1)?.type === "compaction_attempt_bound") {
            throw new Error("injected journal I/O fault")
          }
          return originalWrite(key, value)
        })
        const error = await rejection(produceCompaction(root.id, input))
        expect(error).toBeInstanceOf(CompactionProvenancePersistenceError)
        expect(provider.calls).toBe(0)
        expect(retryable).not.toHaveBeenCalled()
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts).toHaveLength(0)
        expect((await Session.messages({ sessionID: root.id })).some((message) => message.info.role === "assistant" && message.info.summary)).toBe(false)
        expect(await rejection(resolveCompactedMessages(root.id))).toBeInstanceOf(CompactionRecoveryRequiredError)
        const before = await readRunEvents(root.id)
        expect(await rejection(appendRunEventAtTail(root.id, {
          type: "run_completed", payload: {}, commandId: "completion_after_unbound_marker",
        }))).toBeInstanceOf(Error)
        expect(await readRunEvents(root.id)).toEqual(before)
      } finally { write.mockRestore(); retryable.mockRestore(); provider.restore() }
    } })
  })

  test("marker append failure cannot create a summary or call the provider", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => chunks("must not run"))
      const retryable = spyOn(SessionRetry, "retryable")
      const originalWrite = Storage.write
      const write = spyOn(Storage, "write").mockImplementation(async (key, value) => {
        if (key[0] === "run_events" && Array.isArray(value) && value.at(-1)?.type === "compaction_recording_started") {
          throw new Error("injected marker I/O fault")
        }
        return originalWrite(key, value)
      })
      try {
        const error = await rejection(produceCompaction(root.id, input))
        expect(error).toBeInstanceOf(CompactionProvenancePersistenceError)
        expect(provider.calls).toBe(0)
        expect(retryable).not.toHaveBeenCalled()
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts).toHaveLength(0)
        expect((await Session.messages({ sessionID: root.id })).some((message) => message.info.role === "assistant" && message.info.summary)).toBe(false)
      } finally { write.mockRestore(); retryable.mockRestore(); provider.restore() }
    } })
  })

  test("replacement append failure is recovery-required and does not retry the provider", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => chunks("Completed but unadopted summary"))
      const retryable = spyOn(SessionRetry, "retryable")
      const originalWrite = Storage.write
      const write = spyOn(Storage, "write").mockImplementation(async (key, value) => {
        if (key[0] === "run_events" && Array.isArray(value) && value.at(-1)?.type === "compaction_replacement_recorded") {
          throw new Error("injected journal I/O fault")
        }
        return originalWrite(key, value)
      })
      try {
        const error = await rejection(produceCompaction(root.id, input))
        expect(error).toBeInstanceOf(CompactionProvenancePersistenceError)
        expect(provider.calls).toBe(1)
        expect(retryable).not.toHaveBeenCalled()
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts[0]?.status).toBe("open")
        expect(await rejection(resolveCompactedMessages(root.id))).toBeInstanceOf(CompactionRecoveryRequiredError)
      } finally { write.mockRestore(); retryable.mockRestore(); provider.restore() }
    } })
  })

  test("post-commit interruption replays adoption without repeating the summary model call", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const provider = installProvider(() => chunks("Durable summary"))
      const originalRename = Storage.rename
      const rename = spyOn(Storage, "rename").mockImplementation(async (source, destination) => {
        const events = source[0] === "run_events" ? await Storage.read<unknown[]>(source) : null
        await originalRename(source, destination)
        if (Array.isArray(events) && (events.at(-1) as { type?: string } | undefined)?.type === "compaction_replacement_recorded") {
          throw new Error("injected interruption after atomic append")
        }
      })
      try {
        expect(await rejection(produceCompaction(root.id, input))).toBeInstanceOf(CompactionProvenancePersistenceError)
        expect(provider.calls).toBe(1)
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts[0]?.status).toBe("adopted")
      } finally { rename.mockRestore() }
      try {
        await Instance.disposeAll()
        expect((await resolveCompactedMessages(root.id)).map((message) => message.info.id)).toContain(
          (await projectRunStateFromEvents(root.id))!.compactionHistory.attempts[0]!.summaryMessageId,
        )
        await SessionPrompt.loop({ sessionID: root.id })
        expect(provider.calls).toBe(1)
        expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts).toHaveLength(1)
      } finally { provider.restore() }
    } })
  })

  test("a second attempt cannot reuse a stale boundary or an open attempt", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      await beginCompactionAttempt({ sessionId: root.id, markerMessageId: input.parent.info.id, summaryMessageId: Identifier.ascending("message") })
      const before = await readRunEvents(root.id)
      const second = await rejection(beginCompactionAttempt({ sessionId: root.id, markerMessageId: input.parent.info.id, summaryMessageId: Identifier.ascending("message") }))
      expect(second).toBeInstanceOf(CompactionRecoveryRequiredError)
      expect(await readRunEvents(root.id)).toEqual(before)
      expect((await projectRunStateFromEvents(root.id))?.compactionHistory.openAttemptEventIds).toHaveLength(1)
    } })
  })

  test("direct completion bypass is rejected under the run lock while an attempt is open", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      await beginCompactionAttempt({ sessionId: root.id, markerMessageId: input.parent.info.id, summaryMessageId: Identifier.ascending("message") })
      const before = await readRunEvents(root.id)
      for (const type of ["run_completed", "workflow_completed"] as const) {
        expect(await rejection(appendRunEventAtTail(root.id, {
          type, payload: {}, commandId: `direct_compaction_bypass_${type}`,
        }))).toBeInstanceOf(Error)
        expect(await readRunEvents(root.id)).toEqual(before)
      }
    } })
  })

  test("a stale direct attempt cannot bind after another replacement advanced the boundary", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const first = await marker(root.id)
      const provider = installProvider(() => chunks("Accepted first summary"))
      try {
        await produceCompaction(root.id, first)
        const second = await marker(root.id, "Second marker")
        const state = await projectRunStateFromEvents(root.id)
        const markerEventId = state?.compactionHistory.sessions.find((session) => session.sessionId === root.id)?.markerEventId
        if (!markerEventId) throw new Error("missing marker event")
        const prefix = commitCompactionPrefix((await resolveCompactedMessages(root.id)).map((message) => message.info.id))
        const summaryMessageId = Identifier.ascending("message")
        const before = await readRunEvents(root.id)
        expect(await rejection(appendRunEventAtTail(root.id, {
          type: "compaction_attempt_bound",
          payload: {
            scope: "session_compaction_replacement_v1", sessionId: root.id,
            markerMessageId: second.parent.info.id, summaryMessageId,
            previousReplacementEventId: null, prefix,
          },
          commandId: `stale_compaction_${summaryMessageId}`,
          correlationId: summaryMessageId,
          causationId: markerEventId,
        }, { rejectDuplicateCommand: true }))).toBeInstanceOf(Error)
        expect(await readRunEvents(root.id)).toEqual(before)
        expect(provider.calls).toBe(1)
      } finally { provider.restore() }
    } })
  })

  test("concurrent producers serialize to one bound attempt", async () => {
    await Instance.provide({ directory: project, async fn() {
      const root = await governed()
      const input = await marker(root.id)
      const results = await Promise.allSettled([
        beginCompactionAttempt({ sessionId: root.id, markerMessageId: input.parent.info.id, summaryMessageId: Identifier.ascending("message") }),
        beginCompactionAttempt({ sessionId: root.id, markerMessageId: input.parent.info.id, summaryMessageId: Identifier.ascending("message") }),
      ])
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
      expect((await projectRunStateFromEvents(root.id))?.compactionHistory.attempts).toHaveLength(1)
    } })
  })
})
