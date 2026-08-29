import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import os from "node:os"
import path from "node:path"
import fs from "node:fs/promises"
import { mkdirSync, rmSync } from "node:fs"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { LLM } from "@/session/llm"
import { SessionPrompt } from "@/session/prompt"
import { SessionSummary } from "@/session/summary"
import { Provider } from "@/provider/provider"
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
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { TaskTool } from "@/tool/task"
import { Plugin } from "@/plugin"
import { Truncate } from "@/tool/truncation"
import { computeCanonicalCommitment } from "@/execution/canonical-commitment"
import z from "zod"
import { $ } from "bun"

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

const settlementModel = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  api: { id: "gpt-4o", url: "https://example.invalid", npm: "@ai-sdk/openai" },
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

describe("P0 authority integrity", () => {
  test("a no-ask native tool is authorized and settled before its executor body runs", async () => {
    const testProject = path.join(testHome, "no-ask-project")
    await fs.mkdir(testProject, { recursive: true })
    await $`git init`.quiet().cwd(testProject)
    await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })

    await Instance.provide({
      directory: testProject,
      async fn() {
        const toolId = "settlement_no_ask_probe"
        let beforeHookStatus: string | undefined
        let executorStatus: string | undefined
        let executorRuns = 0
        await ToolRegistry.register(
          Tool.define(toolId, {
            description: "Production wrapper settlement probe",
            parameters: z.object({ value: z.string() }).strict(),
            result: Tool.result(z.object({ value: z.string() }).strict()),
            async execute(args, ctx) {
              executorRuns++
              executorStatus = (await getEventAuthorityState(ctx.sessionID))?.invocations?.[ctx.callID!]?.status
              return { title: "probe", output: `executor-output:${args.value}`, metadata: { value: args.value } }
            },
          }),
        )

        const session = await Session.create({ title: "No-ask native settlement" })
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: toolId, pattern: "*", action: "allow" }]
        })
        const { contract } = compileWithRunId(
          { request: { intent: { input: "Run the no-ask settlement probe." } } },
          session.id,
        )
        contract.toolAllowlist = [toolId]
        contract.toolBlocklist = []
        await ContractGuardian.create(session.id, contract)
        await createEventAuthorityRun(session.id, contract.contractId)
        await transitionEventAuthority(session.id, "queued", "execution_queued", {})
        await transitionEventAuthority(session.id, "running", "execution_started", {})

        const originalGetModel = Provider.getModel
        const getModel = spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
          if (providerID === "openai" && modelID === "gpt-4o") return settlementModel
          return originalGetModel(providerID, modelID)
        })
        const summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
        const truncate = spyOn(Truncate, "output").mockResolvedValue({
          content: "short model output",
          truncated: true,
          outputPath: "/tmp/no-ask-probe.txt",
        })
        const trigger = spyOn(Plugin, "trigger").mockImplementation(async (name, hookInput, hookOutput) => {
          if (
            name === "tool.execute.before" &&
            typeof hookInput === "object" &&
            hookInput !== null &&
            "tool" in hookInput &&
            hookInput.tool === toolId
          ) {
            beforeHookStatus = (await getEventAuthorityState(session.id))?.invocations?.call_no_ask_probe?.status
          }
          return hookOutput
        })
        let dispatched = false
        const stream = spyOn(LLM, "stream").mockImplementation(async (input: LLM.StreamInput) => {
          const probe = input.tools[toolId]
          if (probe?.execute && !dispatched) {
            dispatched = true
            const args = { value: "settled" }
            const output = await probe.execute(args, {
              toolCallId: "call_no_ask_probe",
              abortSignal: new AbortController().signal,
              messages: [],
            })
            return {
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "tool-call", toolCallId: "call_no_ask_probe", toolName: toolId, input: args }
                yield { type: "tool-result", toolCallId: "call_no_ask_probe", output }
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
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "error", error: new Error("stop after no-ask probe") }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })

        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Run the settlement probe." }],
          })
          expect(executorRuns).toBe(1)
          expect(beforeHookStatus).toBe("authorized")
          expect(executorStatus).toBe("authorized")
          expect((await getEventAuthorityState(session.id))?.invocations?.call_no_ask_probe?.status).toBe(
            "completed",
          )
          const resultEvent = (await readRunEvents(session.id)).find((event) => event.type === "tool_result_recorded")
          const expectedCommitment = await computeCanonicalCommitment({
            title: "probe",
            output: "executor-output:settled",
            metadata: { value: "settled" },
          })
          expect(resultEvent?.payload).toMatchObject({
            status: "completed",
            result: { basis: "validated_dax_result_pre_truncation", digest: expectedCommitment.digest },
          })
          await new Promise((resolve) => setTimeout(resolve, 50))
        } finally {
          summarySpy.mockRestore()
          truncate.mockRestore()
          trigger.mockRestore()
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("the queued subtask dispatch path settles before its executor body runs", async () => {
    const testProject = path.join(testHome, "queued-subtask-project")
    await fs.mkdir(testProject, { recursive: true })
    await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })

    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Queued subtask settlement" })
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: "task", pattern: "*", action: "allow" }]
        })
        const { contract } = compileWithRunId(
          { request: { intent: { input: "Run the queued subtask settlement probe." } } },
          session.id,
        )
        contract.toolAllowlist = ["task"]
        contract.toolBlocklist = []
        await ContractGuardian.create(session.id, contract)
        await createEventAuthorityRun(session.id, contract.contractId)
        await transitionEventAuthority(session.id, "queued", "execution_queued", {})
        await transitionEventAuthority(session.id, "running", "execution_started", {})

        let executorStatus: string | undefined
        const realTask = await TaskTool.init()
        const taskInit = spyOn(TaskTool, "init").mockResolvedValue({
          ...realTask,
          async execute(_args, ctx) {
            await ctx.ask({ permission: "task", patterns: ["general"], always: ["general"], metadata: {} })
            await ctx.authorize()
            const authority = await getEventAuthorityState(session.id)
            executorStatus = Object.values(authority?.invocations ?? {}).find(
              (invocation) => invocation.toolId === "task",
            )?.status
            const result = {
              title: "queued task",
              output: "settled",
              metadata: { sessionId: "ses_probe", model: false as const },
            }
            ctx.captureValidatedResult?.(result)
            return result
          },
        })
        const originalGetModel = Provider.getModel
        const getModel = spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
          if (providerID === "openai" && modelID === "gpt-4o") return settlementModel
          return originalGetModel(providerID, modelID)
        })
        const summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
        const stream = spyOn(LLM, "stream").mockResolvedValue({
          fullStream: (async function* () {
            yield { type: "start" }
            yield { type: "error", error: new Error("stop after queued subtask probe") }
            yield { type: "finish" }
          })(),
        } as unknown as Awaited<ReturnType<typeof LLM.stream>>)

        try {
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [
              {
                type: "subtask",
                agent: "general",
                description: "Settlement probe",
                prompt: "Return a fixed result.",
              },
            ],
          })

          expect(executorStatus).toBe("authorized")
          const events = await readRunEvents(session.id)
          const invocation = events.find(
            (event) =>
              event.type === "tool_invocation_recorded" &&
              (event.payload as { toolId: string }).toolId === "task",
          )
          expect(invocation).toBeDefined()
          const invocationId = (invocation?.payload as { invocationId: string } | undefined)?.invocationId
          expect(events.find((event) => event.type === "authorization_recorded")?.correlationId).toBe(invocationId)
          expect(events.find((event) => event.type === "tool_result_recorded")?.correlationId).toBe(invocationId)
          expect((await getEventAuthorityState(session.id))?.invocations?.[invocationId!]?.status).toBe("completed")
        } finally {
          taskInit.mockRestore()
          getModel.mockRestore()
          summarySpy.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("a settled native mutation reaches canonical invocation, authorization, and result events", async () => {
    const testProject = path.join(testHome, "project")
    await fs.mkdir(testProject, { recursive: true })
    await $`git init`.quiet().cwd(testProject)
    await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
    // Deterministic authorization: the default ruleset asks interactively for
    // an unconfigured permission, which would hang this test forever. This is
    // the real production config surface, not a bypass of governedAsk.
    await fs.writeFile(path.join(testProject, "dax.json"), JSON.stringify({ permission: { edit: "allow" } }))

    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Native settlement" })

        const originalGetModel = Provider.getModel
        const getModel = spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
          if (providerID === "openai" && modelID === "gpt-4o") return settlementModel
          return originalGetModel(providerID, modelID)
        })
        const summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)

        let toolCallSettled = false
        let writeResult: { output: string; metadata: Record<string, unknown> } | undefined
        const targetFile = path.join(testProject, ".dax", "lab", "notes.txt")
        const stream = spyOn(LLM, "stream").mockImplementation(async (input: LLM.StreamInput) => {
          const write = input.tools.write
          const writeArgs = { filePath: targetFile, content: "hello from settlement\n" }
          if (write?.execute && !toolCallSettled) {
            toolCallSettled = true
            const output = await write.execute(writeArgs, {
              toolCallId: "call_native_1",
              abortSignal: new AbortController().signal,
              messages: [],
            })
            writeResult = output
            return {
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "tool-input-start", id: "call_native_1", toolName: "write" }
                yield { type: "tool-call", toolCallId: "call_native_1", toolName: "write", input: writeArgs }
                yield { type: "tool-result", toolCallId: "call_native_1", output }
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
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "error", error: new Error("stop after the characterized tool call") }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })

        try {
          // A real prior user message so the execution prompt enters the
          // native loop without intent classification assigning a mode.
          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Prepare this governed run." }],
            noReply: true,
          })
          await Session.update(session.id, (draft) => {
            draft.state_v2 = undefined
          })

          await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Write the file .dax/lab/notes.txt using the write tool." }],
          })

          expect(writeResult).toBeDefined()
          expect(await Bun.file(targetFile).text()).toContain("hello from settlement")

          const events = await readRunEvents(session.id)
          const eventTypes = events.map((event) => event.type)

          // Closes integrity.native-tool-settlement-canonical: a real native
          // mutation (write, dispatched through the production
          // resolveTools()/governedAsk() boundary, not a fabricated stream
          // event) leaves the full invocation -> authorization -> result
          // chain in the canonical run log.
          expect(eventTypes).toContain("tool_invocation_recorded")
          expect(eventTypes).toContain("authorization_recorded")
          expect(eventTypes).toContain("tool_result_recorded")

          const invocationEvent = events.find((event) => event.type === "tool_invocation_recorded")!
          const invocationId = (invocationEvent.payload as { invocationId: string }).invocationId
          const authorizationEvent = events.find((event) => event.type === "authorization_recorded")!
          const resultEvent = events.find((event) => event.type === "tool_result_recorded")!

          expect(authorizationEvent.correlationId).toBe(invocationId)
          expect(authorizationEvent.payload).toMatchObject({
            invocationId,
            finalDisposition: "allowed",
            contractDisposition: "allowed",
          })
          expect(resultEvent.correlationId).toBe(invocationId)
          expect(resultEvent.causationId).toBe(authorizationEvent.eventId)
          expect(resultEvent.payload).toMatchObject({ invocationId, status: "completed" })

          expect(eventTypes).toContain("mutation_recorded")
          const mutationEvent = events.find((event) => event.type === "mutation_recorded")!
          expect(mutationEvent.seq).toBeLessThan(resultEvent.seq)
          expect(mutationEvent.payload).toMatchObject({
            basis: "native_snapshot_diff_v1",
            observationWindowInvocationIds: [invocationId],
            receipt: {
              runId: session.id,
              proofType: "workspace_diff",
              changedPaths: [".dax/lab/notes.txt"],
            },
          })
          expectGap("integrity.native-terminal-canonical", () => {
            expect(eventTypes.some((type) => type === "run_completed" || type === "workflow_completed")).toBe(true)
          })
          expect((await getEventAuthorityState(session.id))?.status).toBe("running")

          // SessionPrompt fires session.compaction pruning without awaiting
          // it (prompt.ts's post-loop cleanup). Give it a turn to finish
          // reading this session's messages before afterEach removes
          // testHome out from under it.
          await new Promise((resolve) => setTimeout(resolve, 50))
        } finally {
          summarySpy.mockRestore()
          getModel.mockRestore()
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
