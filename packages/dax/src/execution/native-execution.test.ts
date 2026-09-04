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
import { adjudicateNativeCompletionCandidate } from "@/execution/native-completion"
import { MessageV2 } from "@/session/message-v2"
import { Identifier } from "@/id/id"
import { Bus } from "@/bus"

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

  test("6. Pending approvals are refused by completion adjudication, not merely present", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Pending approval test" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () =>
          mockStreamingResponse("The governed execution summary is complete."),
        )

        try {
          const { contract } = compileWithRunId(
            { request: { intent: { input: "Approval test." }, workflowHint: "generic" } },
            session.id,
          )
          await ContractGuardian.create(session.id, contract)
          await Session.bindGoverningRun(session.id, session.id)

          // A real turn, so there is an actual assistant result to adjudicate.
          const turn = await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Do the approval-gated work." }],
          })
          expect(turn.info.role).toBe("assistant")

          await transitionEventAuthority(session.id, "waiting_approval", "approval_requested", {
            approvalId: "app_pending_123",
            approvalType: "tool",
            risk: "high",
          })

          // The point of the test: adjudication must refuse, not just record.
          const decision = await adjudicateNativeCompletionCandidate({
            sessionID: session.id,
            assistantMessageID: turn.info.id,
            finishReason: "stop",
            hasError: false,
          })

          expect(decision.accepted).toBe(false)
          expect(decision.reasonCodes).toContain("approval_pending:app_pending_123")

          const state = await getEventAuthorityState(session.id)
          expect(state?.status).not.toBe("completed")
          expect(state?.status).toBe("waiting_approval")
          expect(state?.pendingApprovalIds).toContain("app_pending_123")
          expect((await readRunEvents(session.id)).some((e) => e.type === "run_completed")).toBe(false)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("7. A compaction model generation finishes without terminalizing the governing run", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Internal model stops" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () =>
          mockStreamingResponse("Internal synthetic stop"),
        )

        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Context that compaction will summarize." }],
          })

          // The internal path this test claims to exercise. `create` only
          // enqueues the compaction task; the loop performs the actual internal
          // model generation on the next turn, so both calls are required for
          // this to exercise anything at all.
          await SessionCompaction.create({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "openai", modelID: "gpt-4o" },
            auto: false,
          })
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Turn that drives the queued compaction." }],
          })

          // The internal generation really did complete. Read the raw message
          // stream, not the compacted view: filterCompacted deliberately elides
          // the boundary this test is about.
          const messages = await Array.fromAsync(MessageV2.stream(session.id))
          const summary = messages.find((m) => m.info.role === "assistant" && (m.info as MessageV2.Assistant).summary)
          expect(summary).toBeDefined()
          expect((summary!.info as MessageV2.Assistant).finish).toBeDefined()

          // ...and it did not terminalize the governing run.
          expect((await readRunEvents(session.id)).some((e) => e.type === "run_completed")).toBe(false)
          expect((await getEventAuthorityState(session.id))?.status).toBe("running")

          // The next conversational turn still works against the live run.
          const next = await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Continue after the internal generation." }],
          })
          expect(next.info.role).toBe("assistant")
          expect((await getEventAuthorityState(session.id))?.status).toBe("running")
          expect((await readRunEvents(session.id)).some((e) => e.type === "run_completed")).toBe(false)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("8. Single-shot adjudicates the message this invocation produced, not the newest in history", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Exact-result adjudication" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () =>
          mockStreamingResponse("A completed earlier assistant turn."),
        )

        try {
          // A. A prior assistant already exists in history, and it finished "stop".
          const prior = await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Earlier turn." }],
          })
          expect((prior.info as MessageV2.Assistant).finish).toBe("stop")

          // B. This invocation produces its own result, and C. that result has no
          // finish reason. Scanning history would have found this same message and
          // read its missing finish as "stop"; adjudicating the exact result and
          // refusing to default the finish reason are what make it fail closed.
          const produced = (await Session.updateMessage({
            id: Identifier.ascending("message"),
            parentID: prior.info.id,
            role: "assistant",
            mode: "build",
            agent: "build",
            path: { cwd: testProject, root: testProject },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: "gpt-4o",
            providerID: "openai",
            time: { created: Date.now() },
            sessionID: session.id,
          })) as MessageV2.Assistant
          expect(produced.finish).toBeUndefined()

          const promptSpy = spyOn(SessionPrompt, "prompt").mockResolvedValue({ info: produced, parts: [] })
          try {
            const result = await NativeExecution.runSingleShot({
              sessionID: session.id,
              model: { providerID: "openai", modelID: "gpt-4o" },
              parts: [{ type: "text", text: "Return a concise execution summary." }],
            })

            expect(result.message.info.id).toBe(produced.id)
            expect(result.completion.candidate).toBe(false)
            expect(result.completion.accepted).toBe(false)
            expect(result.completion.reasonCodes).toContain("finish_reason:missing")
          } finally {
            promptSpy.mockRestore()
          }

          expect((await getEventAuthorityState(session.id))?.status).not.toBe("completed")
          expect((await readRunEvents(session.id)).some((e) => e.type === "run_completed")).toBe(false)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("9. A malformed non-assistant single-shot result cannot complete the run", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Malformed single-shot result" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () =>
          mockStreamingResponse("An earlier assistant turn."),
        )

        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Earlier turn." }],
          })

          const notAnAssistant = await Session.updateMessage({
            id: Identifier.ascending("message"),
            role: "user",
            model: { providerID: "openai", modelID: "gpt-4o" },
            sessionID: session.id,
            agent: "build",
            time: { created: Date.now() },
          })

          const promptSpy = spyOn(SessionPrompt, "prompt").mockResolvedValue({ info: notAnAssistant, parts: [] })
          try {
            const result = await NativeExecution.runSingleShot({
              sessionID: session.id,
              model: { providerID: "openai", modelID: "gpt-4o" },
              parts: [{ type: "text", text: "Return a concise execution summary." }],
            })
            expect(result.completion.accepted).toBe(false)
            expect(result.completion.reasonCodes).toContain("non_assistant_result:user")
          } finally {
            promptSpy.mockRestore()
          }

          expect((await getEventAuthorityState(session.id))?.status).not.toBe("completed")
          expect((await readRunEvents(session.id)).some((e) => e.type === "run_completed")).toBe(false)
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("10. A refused completion surfaces as a session error, so a single-shot caller cannot read it as success", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Refused completion surfaces" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () =>
          mockStreamingResponse("Claiming to be done."),
        )

        const errors: string[] = []
        const unsubscribe = Bus.subscribe(Session.Event.Error, (event) => {
          if (event.properties.sessionID !== session.id) return
          const message = (event.properties.error as { data?: { message?: string } } | undefined)?.data?.message
          if (message) errors.push(message)
        })

        try {
          const { contract } = compileWithRunId(
            { request: { intent: { input: "Refused completion." }, workflowHint: "generic" } },
            session.id,
          )
          // The contract owes a patch. A text-only turn cannot satisfy it, so
          // completion proof fails and adjudication refuses the provider stop.
          contract.expectedOutputs = [{ type: "patch", description: "The governed change" }]
          await ContractGuardian.create(session.id, contract)
          await Session.bindGoverningRun(session.id, session.id)

          // `dax run` and RunFactory both drive this policy. The decision used to
          // be logged and dropped, so the loop exited, the session went idle, and
          // the caller exited 0 for a run that never reached completed.
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Finish the governed task." }],
            completionPolicy: "on_provider_stop",
          })

          expect(errors.some((message) => message.includes("Governed completion was not accepted"))).toBe(true)
          expect(errors.some((message) => message.includes("completion_proof:missing_expected_outputs"))).toBe(true)
          expect(errors.some((message) => message.includes("did not reach completed"))).toBe(true)
          expect((await getEventAuthorityState(session.id))?.status).not.toBe("completed")
          expect((await readRunEvents(session.id)).some((e) => e.type === "run_completed")).toBe(false)
        } finally {
          unsubscribe()
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })
})
