import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdirSync, rmSync } from "node:fs"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionProcessor } from "@/session/processor"
import { LLM } from "@/session/llm"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Identifier } from "@/id/id"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import {
  createEventAuthorityRun,
  getEventAuthorityState,
  transitionEventAuthority,
} from "@/state/events/event-transitions"
import { readRunEvents } from "@/state/events/run-event-store"
import { RunGateway } from "@/server/run-gateway"
import { ApprovalTransitions } from "@/approval/approval-transitions"
import { expectGap } from "./known-gaps"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
let testHome = ""
let previousTestHome: string | undefined

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(
    os.tmpdir(),
    `dax-authority-integrity-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  )
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

async function createRunningEventAuthorityRun(title: string) {
  const session = await Session.create({ title })
  const { contract } = compileWithRunId(
    {
      request: {
        intent: { input: "Read one file and report the result." },
      },
    },
    session.id,
  )

  await ContractGuardian.create(session.id, contract)
  await createEventAuthorityRun(session.id, contract.contractId)
  await transitionEventAuthority(session.id, "queued", "execution_queued", {})
  await transitionEventAuthority(session.id, "running", "execution_started", {})

  return { session, contract }
}

describe("P0 authority integrity", () => {
  test("a settled native mutation reaches canonical execution, mutation, and terminal events", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session } = await createRunningEventAuthorityRun("Native settlement")
        const assistant = (await Session.updateMessage({
          id: Identifier.ascending("message"),
          parentID: Identifier.ascending("message"),
          role: "assistant",
          mode: "test-agent",
          agent: "test-agent",
          path: { cwd: repoRoot, root: repoRoot },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: "test-model",
          providerID: "openai",
          time: { created: Date.now() },
          sessionID: session.id,
        })) as MessageV2.Assistant

        const model = Provider.Model.parse({
          id: "test-model",
          providerID: "openai",
          api: { id: "test-model", url: "https://example.invalid", npm: "@ai-sdk/openai" },
          name: "Authority integrity model",
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
        const stream = spyOn(LLM, "stream").mockImplementation(async () =>
          ({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "tool-input-start", id: "call_native_1", toolName: "apply_patch" }
              yield {
                type: "tool-call",
                toolCallId: "call_native_1",
                toolName: "apply_patch",
                input: { patchText: "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch" },
              }
              yield {
                type: "tool-result",
                toolCallId: "call_native_1",
                input: { patchText: "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch" },
                output: {
                  output: "Patch applied.",
                  title: "Update README.md",
                  metadata: { changedPaths: ["README.md"] },
                  attachments: [],
                },
              }
              yield {
                type: "finish-step",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1 },
                providerMetadata: {},
              }
              yield { type: "finish" }
            })(),
          }) as unknown as Awaited<ReturnType<typeof LLM.stream>>,
        )

        try {
          const result = await SessionProcessor.create({
            assistantMessage: assistant,
            sessionID: session.id,
            model,
            abort: new AbortController().signal,
          }).process({
            user: MessageV2.User.parse({
              id: Identifier.ascending("message"),
              sessionID: session.id,
              role: "user",
              time: { created: Date.now() },
              agent: "test-agent",
              model: { providerID: "openai", modelID: "test-model" },
            }),
            agent: Agent.Info.parse({
              name: "test-agent",
              mode: "primary",
              permission: [],
              options: {},
            }),
            abort: new AbortController().signal,
            sessionID: session.id,
            system: [],
            messages: [],
            tools: {},
            model,
          })

          expect(result).toBe("continue")
          const messages = await Session.messages({ sessionID: session.id })
          const completed = messages.find((message) => message.info.id === assistant.id)?.info
          expect(completed?.role).toBe("assistant")
          expect((completed as MessageV2.Assistant).finish).toBe("stop")
          expect((completed as MessageV2.Assistant).time.completed).toBeDefined()

          const events = await readRunEvents(session.id)
          const eventTypes = events.map((event) => event.type)

          expectGap("integrity.native-tool-settlement-canonical", () => {
            expect(eventTypes).toContain("step_completed")
          })
          expectGap("integrity.native-mutation-canonical", () => {
            expect(eventTypes).toContain("mutation_recorded")
          })
          expectGap("integrity.native-terminal-canonical", () => {
            expect(eventTypes.some((type) => type === "run_completed" || type === "workflow_completed")).toBe(true)
          })
          expect((await getEventAuthorityState(session.id))?.status).toBe("running")
        } finally {
          stream.mockRestore()
        }
      },
    })
  })

  test("the gateway compatibility stream cannot change event-authority snapshot truth", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session } = await createRunningEventAuthorityRun("Projection authority")
        await RunGateway.initialize()

        await RunGateway.__testing.appendEvent(session.id, {
          type: "approval.requested",
          payload: {
            approval: {
              approvalId: "apr_projection_only",
              runId: session.id,
              type: "tool_use",
              status: "pending",
              risk: "medium",
              title: "Compatibility-only approval",
              reason: "This record is absent from the canonical run log.",
              context: {},
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          },
        })

        const canonical = await getEventAuthorityState(session.id)
        const snapshot = await RunGateway.getSnapshot(session.id)
        const canonicalPendingApprovalCount = canonical?.pendingApprovalIds.length ?? -1
        expect(canonicalPendingApprovalCount).toBe(0)

        expectGap("integrity.gateway-projection-authority", () => {
          expect(snapshot.pendingApprovalCount).toBe(canonicalPendingApprovalCount)
        })
      },
    })
  })

  test("native approval state is reconstructable from the canonical run log", async () => {
    await Instance.provide({
      directory: repoRoot,
      async fn() {
        const { session } = await createRunningEventAuthorityRun("Native approval replay")

        const approval = await ApprovalTransitions.create({
          runId: session.id,
          type: "tool_use",
          risk: "medium",
          title: "Approve native tool",
          reason: "The native permission path requires operator approval.",
          source: "permission",
        })

        const events = await readRunEvents(session.id)
        const state = await getEventAuthorityState(session.id)

        expect(events.some((event) => event.type === "approval_requested")).toBe(true)
        expect(state?.pendingApprovalIds).toContain(approval.approvalId)
        expect(state?.approvals.find((item) => item.approvalId === approval.approvalId)).toMatchObject({
          title: "Approve native tool",
          reason: "The native permission path requires operator approval.",
          source: "permission",
          status: "pending",
        })
      },
    })
  })
})
