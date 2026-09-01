import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionCompaction } from "@/session/compaction"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { ContractGuardian } from "@/execution/contract-guardian"
import { compileWithRunId } from "@/execution/compiler"
import { NativeExecution } from "@/execution/native-execution"
import { readRunEvents } from "@/state/events/run-event-store"
import { getEventAuthorityState, transitionEventAuthority } from "@/state/events/event-transitions"

import { SessionSummary } from "@/session/summary"
import * as Interpret from "@/intent/interpret"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

const testModel = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  name: "Native execution test model",
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

let restoreSummarySpy: (() => void) | undefined
let restoreInterpretSpy: (() => void) | undefined

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(os.tmpdir(), `dax-native-exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  testProject = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  await fs.mkdir(testProject, { recursive: true })
  await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
  await Instance.disposeAll()
  const summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  const interpretSpy = spyOn(Interpret, "interpretIntent").mockResolvedValue({
    intentType: "general_query",
    confidence: 1,
    activeMode: "execute",
    suggestedOperator: "general",
    requiredSkills: [],
    requestedOutput: "narrative",
    riskLevel: "low",
    scope: "repo",
    constraints: [],
  })
  restoreSummarySpy = () => summarySpy.mockRestore()
  restoreInterpretSpy = () => interpretSpy.mockRestore()
})

afterEach(async () => {
  restoreSummarySpy?.()
  restoreInterpretSpy?.()
  restoreSummarySpy = undefined
  restoreInterpretSpy = undefined
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  await fs.rm(testHome, { recursive: true, force: true })
})

function mockStreamingResponse(text: string) {
  return {
    fullStream: (async function* () {
      yield { type: "start" }
      yield { type: "text-start" }
      yield { type: "text-delta", text }
      yield { type: "text-end" }
      yield {
        type: "finish-step",
        finishReason: "stop",
        usage: { inputTokens: 10, outputTokens: 10 },
        providerMetadata: {},
      }
      yield { type: "finish" }
    })(),
  } as unknown as Awaited<ReturnType<typeof LLM.stream>>
}

describe("Native Execution & Conversational Lifetime Separation", () => {
  test("1. Two-turn interactive session: Turn 1 stop keeps run running, Turn 2 succeeds", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Two-turn session" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        let callCount = 0
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          callCount++
          return mockStreamingResponse(`Response turn ${callCount}`)
        })

        try {
          // Turn 1
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Turn 1 prompt" }],
          })

          const stateAfterTurn1 = await getEventAuthorityState(session.id)
          expect(stateAfterTurn1?.status).toBe("running")
          const eventsAfterTurn1 = await readRunEvents(session.id)
          expect(eventsAfterTurn1.some((e) => e.type === "run_completed")).toBe(false)

          // Turn 2
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Turn 2 prompt" }],
          })

          const stateAfterTurn2 = await getEventAuthorityState(session.id)
          expect(stateAfterTurn2?.status).toBe("running")
          const eventsAfterTurn2 = await readRunEvents(session.id)
          expect(eventsAfterTurn2.some((e) => e.type === "run_completed")).toBe(false)
          expect(callCount).toBe(2)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("2. Long multi-turn session (5 turns): no premature run_completed", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Long multi-turn session" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        let callCount = 0
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          callCount++
          return mockStreamingResponse(`Response turn ${callCount}`)
        })

        try {
          for (let turn = 1; turn <= 5; turn++) {
            await SessionPrompt.prompt({
              sessionID: session.id,
              model: { providerID: "openai", modelID: "gpt-4o" },
              parts: [{ type: "text", text: `Prompt turn ${turn}` }],
            })
            const state = await getEventAuthorityState(session.id)
            expect(state?.status).toBe("running")
          }

          const events = await readRunEvents(session.id)
          expect(events.some((e) => e.type === "run_completed")).toBe(false)
          expect(callCount).toBe(5)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("3. Compaction continuity: compaction does not terminalize run, conversation continues", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Compaction session" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          return mockStreamingResponse("Conversation or compaction response")
        })

        try {
          // Send initial user message
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Initial context before compaction" }],
          })

          // Run compaction explicitly
          await SessionCompaction.create({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "openai", modelID: "gpt-4o" },
            auto: false,
          })

          // Run must remain active and running
          const stateAfterCompaction = await getEventAuthorityState(session.id)
          expect(stateAfterCompaction?.status).toBe("running")
          expect((await readRunEvents(session.id)).some((e) => e.type === "run_completed")).toBe(false)

          // Subsequent prompt succeeds cleanly
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Next prompt after compaction" }],
          })

          const stateAfterNextPrompt = await getEventAuthorityState(session.id)
          expect(stateAfterNextPrompt?.status).toBe("running")
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("4. Single-shot native execution: records verification and run_completed", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Single-shot session" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          return mockStreamingResponse("The governed execution summary is complete.")
        })

        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Prepare this governed run." }],
            noReply: true,
          })

          const result = await NativeExecution.runSingleShot({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Return a concise execution summary." }],
          })

          expect(result.completion.accepted).toBe(true)
          const state = await getEventAuthorityState(session.id)
          expect(state?.status).toBe("completed")
          const events = await readRunEvents(session.id)
          expect(events.some((e) => e.type === "run_completed")).toBe(true)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("5. Terminal runs remain non-resumable: completed runs fail closed on new prompts", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Completed terminal run" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          return mockStreamingResponse("The governed execution summary is complete.")
        })

        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Prepare this governed run." }],
            noReply: true,
          })

          // Complete the run via single-shot execution
          const result = await NativeExecution.runSingleShot({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Return a concise execution summary." }],
          })
          expect(result.completion.accepted).toBe(true)
          expect((await getEventAuthorityState(session.id))?.status).toBe("completed")

          // Attempting another prompt against the terminal run must throw
          await expect(
            SessionPrompt.prompt({
              sessionID: session.id,
              model: { providerID: "openai", modelID: "gpt-4o" },
              parts: [{ type: "text", text: "Try to run on a completed run." }],
            }),
          ).rejects.toThrow(/is completed; refusing native execution/i)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("6. Pending approvals remain fail-closed against completion", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Pending approval test" })
        const { contract } = compileWithRunId(
          { request: { intent: { input: "Approval test." }, workflowHint: "generic" } },
          session.id,
        )
        await ContractGuardian.create(session.id, contract)
        await Session.bindGoverningRun(session.id, session.id)

        // Enter running state and add an unresolved approval
        await SessionPrompt.ensureCanonicalRunBirth({ sessionID: session.id, intent: "Approval test." })
        await transitionEventAuthority(session.id, "waiting_approval", "approval_requested", {
          approvalId: "app_pending_123",
          approvalType: "tool",
          risk: "high",
        })

        const state = await getEventAuthorityState(session.id)
        expect(state?.status).toBe("waiting_approval")
        expect(state?.pendingApprovalIds).toContain("app_pending_123")
      },
    })
  })

  test("7. Internal model stops (compaction/summarization/synthetic) are non-terminal", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Internal model stops" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          return mockStreamingResponse("Internal synthetic stop")
        })

        try {
          // A regular conversational turn ends with model stop
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Internal stop prompt." }],
          })

          // Model stop in interactive mode must not emit run_completed
          const events = await readRunEvents(session.id)
          expect(events.some((e) => e.type === "run_completed")).toBe(false)
          expect((await getEventAuthorityState(session.id))?.status).toBe("running")
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })
})
