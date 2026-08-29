import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { MCP } from "@/mcp"
import { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { BatchTool } from "@/tool/batch"
import { TaskTool } from "@/tool/task"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import type { ExecutionContract } from "@/execution/execution-contract"
import { enforceRuntimeGuard, RuntimeGuardViolationError } from "@/execution/runtime-guard"
import { ApprovalStore } from "@/approval/approval-store"
import { createEventAuthorityRun } from "@/state/events/event-transitions"
import { RunLifecycle } from "@/state/run-lifecycle"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

const testModel = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  name: "Authority test model",
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
  testHome = path.join(os.tmpdir(), `dax-governing-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  testProject = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  await fs.mkdir(testProject, { recursive: true })
  await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
  await fs.writeFile(path.join(testProject, "dax.json"), JSON.stringify({ experimental: { batch_tool: true } }))
  await Instance.disposeAll()
})

afterEach(async () => {
  await Instance.disposeAll()
  if (previousTestHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousTestHome
  await fs.rm(testHome, { recursive: true, force: true })
})

async function governedRoot(allowlist: string[], configure?: (contract: ExecutionContract) => void) {
  const parent = await Session.create({ title: "Governed parent" })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Delegate a governed task without widening authority." } } },
    parent.id,
  )
  contract.toolAllowlist = allowlist
  configure?.(contract)
  await ContractGuardian.create(parent.id, contract)
  await Session.bindGoverningRun(parent.id, parent.id)
  return parent
}

async function captureChildTools(sessionID: string): Promise<string[]> {
  let tools: string[] = []
  const originalGetModel = Provider.getModel
  const getModel = spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
    if (providerID === "openai" && modelID === "gpt-4o") return testModel
    return originalGetModel(providerID, modelID)
  })
  const stream = spyOn(LLM, "stream").mockImplementation(async (input: LLM.StreamInput) => {
    tools = Object.keys(input.tools)
    return {
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "error", error: new Error("stop after tool visibility capture") }
        yield { type: "finish" }
      })(),
    } as unknown as Awaited<ReturnType<typeof LLM.stream>>
  })

  try {
    await SessionPrompt.prompt({
      sessionID,
      model: { providerID: "openai", modelID: "gpt-4o" },
      parts: [{ type: "text", text: "Inspect the governed child tool set." }],
    })
  } finally {
    getModel.mockRestore()
    stream.mockRestore()
  }
  return tools
}

describe("governing run authority in child sessions", () => {
  test("filters built-in, registered plugin, and MCP tools against the parent contract", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const registeredPlugin = Tool.define("child-plugin-probe", {
          description: "Registered plugin-shaped probe",
          parameters: z.object({}).strict(),
          result: Tool.result(z.object({}).strict()),
          async execute() {
            return { title: "probe", output: "probe", metadata: {} }
          },
        })
        await ToolRegistry.register(registeredPlugin)
        const mcpTools = spyOn(MCP, "tools").mockResolvedValue({
          child_mcp_probe: { execute: async () => "unexpected" } as unknown as Awaited<
            ReturnType<typeof MCP.tools>
          >[string],
        })
        try {
          const parent = await governedRoot(["task", "batch"])
          const child = await Session.fork({ sessionID: parent.id })
          const tools = await captureChildTools(child.id)

          expect(tools).toContain("batch")
          expect(tools).not.toContain("write")
          expect(tools).not.toContain("child-plugin-probe")
          expect(tools).not.toContain("child_mcp_probe")
        } finally {
          mcpTools.mockRestore()
        }
      },
    })
  })

  test("fails closed rather than exposing child tools when its governing contract is missing", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const child = await Session.create({ title: "Broken governed child" })
        await Session.bindGoverningRun(child.id, "ses_missing_governing_contract")
        await expect(captureChildTools(child.id)).rejects.toThrow(/Governing ExecutionContract not found/i)
      },
    })
  })

  test("a governed child direct tool uses the parent immutable scope in RuntimeGuard", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const parent = await governedRoot(["task", "write"], (contract) => {
          contract.runtimePolicy!.scope = {
            targetFiles: ["allowed.ts"],
            targetSubsystems: [],
            avoidAreas: [],
          }
        })
        const child = await Session.fork({ sessionID: parent.id })
        await Session.update(child.id, (draft) => {
          draft.permission = [{ permission: "edit", pattern: "*", action: "allow" }]
        })

        const target = path.join(testProject, "outside.ts")
        const originalTimeout = process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
        process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "0"
        let invocationError: unknown
        let attempted = false

        const originalGetModel = Provider.getModel
        const getModel = spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
          if (providerID === "openai" && modelID === "gpt-4o") return testModel
          return originalGetModel(providerID, modelID)
        })
        const stream = spyOn(LLM, "stream").mockImplementation(async (input: LLM.StreamInput) => {
          if (!attempted && input.tools.write?.execute) {
            attempted = true
            try {
              await input.tools.write.execute(
                { filePath: target, content: "must remain blocked\n" },
                { toolCallId: "call_child_scope", abortSignal: new AbortController().signal, messages: [] },
              )
            } catch (error) {
              invocationError = error
            }
          }
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "error", error: new Error("stop after governed child write attempt") }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })

        try {
          await SessionPrompt.prompt({
            sessionID: child.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Write outside.ts during this concrete delegated task." }],
          })

          expect(attempted).toBe(true)
          expect(invocationError).toBeInstanceOf(RuntimeGuardViolationError)
          expect((invocationError as RuntimeGuardViolationError).code).toBe("scope_drift")
          expect(await Bun.file(target).exists()).toBe(false)
          expect((await ApprovalStore.terminal(parent.id)).length).toBe(1)
          expect(await ApprovalStore.ids(child.id)).toEqual([])
          expect(Object.keys((await Session.get(parent.id)).state_v2?.runtime_guard?.failureCounts ?? {})).toHaveLength(1)
          expect((await Session.get(child.id)).state_v2?.runtime_guard).toBeUndefined()
        } finally {
          getModel.mockRestore()
          stream.mockRestore()
          if (originalTimeout === undefined) delete process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
          else process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = originalTimeout
        }
      },
    })
  })

  test("a governed child intent may narrow but never widen the parent immutable scope", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const parent = await governedRoot(["task", "write"], (contract) => {
          contract.runtimePolicy!.scope = {
            targetFiles: ["a.ts", "b.ts"],
            targetSubsystems: [],
            avoidAreas: [],
          }
        })
        const child = await Session.fork({ sessionID: parent.id })
        await Session.update(child.id, (draft) => {
          draft.state_v2 = {
            activity_timeline: [],
            approvals: [],
            artifacts: [],
            audit_findings: [],
            intent: {
              prompt: "Limit this delegated task to a.ts.",
              intentType: "code_change",
              confidence: 1,
              activeMode: "build",
              suggestedOperator: "build",
              requiredSkills: [],
              requestedOutput: "diff",
              riskLevel: "medium",
              scope: "a.ts",
              constraints: [],
              contract: {
                goal: "Change only a.ts",
                successCriteria: [],
                explicitConstraints: ["Do not change b.ts"],
                targetFiles: ["a.ts"],
              },
            },
          }
        })

        const originalTimeout = process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
        process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "0"
        try {
          let error: unknown
          try {
            await enforceRuntimeGuard({
              sessionID: child.id,
              agent: "build",
              toolID: "write",
              callID: "call_child_narrowed_scope",
              req: {
                permission: "edit",
                patterns: ["b.ts"],
                always: ["*"],
                metadata: { filepath: path.join(testProject, "b.ts") },
              },
            })
          } catch (caught) {
            error = caught
          }

          expect(error).toBeInstanceOf(RuntimeGuardViolationError)
          expect((error as RuntimeGuardViolationError).code).toBe("scope_drift")
          expect((await ApprovalStore.terminal(parent.id)).length).toBe(1)
          expect(await ApprovalStore.ids(child.id)).toEqual([])
        } finally {
          if (originalTimeout === undefined) delete process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
          else process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = originalTimeout
        }
      },
    })
  })

  test("a governed child RuntimeGuard uses the parent canonical lifecycle", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const parent = await governedRoot(["task", "write"], (contract) => {
          contract.runtimePolicy!.scope = { targetFiles: ["allowed.ts"], targetSubsystems: [], avoidAreas: [] }
        })
        const contract = await ContractGuardian.get(parent.id)
        await createEventAuthorityRun(parent.id, contract!.contractId, false, "enforce")
        await RunLifecycle.transition(parent.id, "queued", "execution_queued")
        await RunLifecycle.transition(parent.id, "running", "execution_started")
        await RunLifecycle.addApproval(parent.id, "apr_existing_gate", {
          approvalType: "workflow_gate",
          risk: "high",
          title: "Existing governing approval",
          reason: "Hold mutation until the operator resolves the governing run gate.",
        })
        const child = await Session.fork({ sessionID: parent.id })

        const originalTimeout = process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
        process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = "0"
        try {
          let error: unknown
          try {
            await enforceRuntimeGuard({
              sessionID: child.id,
              agent: "build",
              toolID: "write",
              callID: "call_child_lifecycle",
              req: {
                permission: "edit",
                patterns: ["allowed.ts"],
                always: ["*"],
                metadata: { filepath: path.join(testProject, "allowed.ts") },
              },
            })
          } catch (caught) {
            error = caught
          }

          expect(error).toBeInstanceOf(RuntimeGuardViolationError)
          expect((error as RuntimeGuardViolationError).code).toBe("illegal_transition")
          expect((await ApprovalStore.terminal(parent.id)).length).toBe(1)
          expect(await ApprovalStore.ids(child.id)).toEqual([])
        } finally {
          if (originalTimeout === undefined) delete process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS
          else process.env.DAX_RUNTIME_GUARD_APPROVAL_TIMEOUT_MS = originalTimeout
        }
      },
    })
  })

  test("a governed child batch cannot execute a leaf excluded by its parent contract", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        let executeEntered = false
        await ToolRegistry.register(
          Tool.define("child-batch-denied-probe", {
            description: "Child batch leaf denial probe",
            parameters: z.object({}).strict(),
            result: Tool.result(z.object({}).strict()),
            async execute() {
              executeEntered = true
              return { title: "probe", output: "entered", metadata: {} }
            },
          }),
        )
        const parent = await governedRoot(["task", "batch"])
        const child = await Session.fork({ sessionID: parent.id })
        const target = path.join(testProject, "child-denied-write.txt")
        const batch = await BatchTool.init()

        const result = await batch.execute(
          {
            tool_calls: [
              { tool: "write", parameters: { filePath: target, content: "must not write\n" } },
              { tool: "child-batch-denied-probe", parameters: {} },
            ],
          },
          {
            sessionID: child.id,
            messageID: "msg_child_batch",
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            async authorize() {},
          },
        )

        expect(result.metadata).toMatchObject({ successful: 0, failed: 2 })
        expect(executeEntered).toBe(false)
        expect(await Bun.file(target).exists()).toBe(false)
      },
    })
  })

  test("a governed child batch executes a leaf included by its parent contract", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const parent = await governedRoot(["task", "batch", "write"])
        const child = await Session.fork({ sessionID: parent.id })
        const target = path.join(testProject, "child-allowed-write.txt")
        const batch = await BatchTool.init()

        const result = await batch.execute(
          { tool_calls: [{ tool: "write", parameters: { filePath: target, content: "allowed\n" } }] },
          {
            sessionID: child.id,
            messageID: "msg_child_allowed_batch",
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            async authorize() {},
          },
        )

        expect(result.metadata).toMatchObject({ successful: 1, failed: 0 })
        expect(await Bun.file(target).text()).toBe("allowed\n")
      },
    })
  })

  test("TaskTool binds a fresh child to the parent authority before prompting it", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const parent = await governedRoot(["task", "batch"])
        const promptTarget = SessionPrompt as {
          prompt(input: SessionPrompt.PromptInput): ReturnType<typeof SessionPrompt.prompt>
        }
        const prompt = spyOn(promptTarget, "prompt").mockImplementation(async (input) => {
          expect((await Session.get(input.sessionID)).governingRunId).toBe(parent.id)
          throw new Error("stop after fresh-child authority assertion")
        })
        try {
          const task = await TaskTool.init()
          await expect(
            task.execute(
              { description: "delegate task", prompt: "inspect", subagent_type: "general" },
              {
                sessionID: parent.id,
                messageID: "msg_parent_task_fresh",
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata() {},
                async ask() {},
                async authorize() {},
              },
            ),
          ).rejects.toThrow(/stop after fresh-child authority assertion/i)
        } finally {
          prompt.mockRestore()
        }
      },
    })
  })

  test("TaskTool rejects a governed parent resuming an ambiguous or different-authority child", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const parent = await governedRoot(["task", "batch"])
        const otherRun = await governedRoot(["task"])
        const ambiguous = await Session.create({ title: "Ambiguous legacy child" })
        const different = await Session.create({ title: "Different governed child" })
        await Session.bindGoverningRun(different.id, otherRun.id)
        const task = await TaskTool.init()
        const context = {
          sessionID: parent.id,
          messageID: "msg_parent_task",
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata() {},
          async ask() {},
          async authorize() {},
        }

        await expect(
          task.execute(
            { description: "resume task", prompt: "resume", subagent_type: "general", task_id: ambiguous.id },
            context,
          ),
        ).rejects.toThrow(/not governed by parent run/i)
        await expect(
          task.execute(
            { description: "resume task", prompt: "resume", subagent_type: "general", task_id: different.id },
            context,
          ),
        ).rejects.toThrow(/not governed by parent run/i)
      },
    })
  })

  test("TaskTool permits a governed parent to resume a child with the same authority", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const parent = await governedRoot(["task", "batch"])
        const child = await Session.fork({ sessionID: parent.id })
        const promptTarget = SessionPrompt as {
          prompt(input: SessionPrompt.PromptInput): ReturnType<typeof SessionPrompt.prompt>
        }
        const prompt = spyOn(promptTarget, "prompt").mockImplementation(async (input) => {
          expect(input.sessionID).toBe(child.id)
          expect((await Session.get(input.sessionID)).governingRunId).toBe(parent.id)
          throw new Error("stop after same-authority resume assertion")
        })
        try {
          const task = await TaskTool.init()
          await expect(
            task.execute(
              { description: "resume task", prompt: "resume", subagent_type: "general", task_id: child.id },
              {
                sessionID: parent.id,
                messageID: "msg_parent_task_resume",
                agent: "build",
                abort: new AbortController().signal,
                messages: [],
                metadata() {},
                async ask() {},
                async authorize() {},
              },
            ),
          ).rejects.toThrow(/stop after same-authority resume assertion/i)
        } finally {
          prompt.mockRestore()
        }
      },
    })
  })
})
