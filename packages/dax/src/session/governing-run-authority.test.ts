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

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

const testModel = {
  id: "gpt-4o",
  providerID: "openai",
  name: "Authority test model",
  api: { id: "gpt-4o", npm: "@ai-sdk/openai" },
  modalities: { input: ["text"], output: ["text"] },
  cost: { input: 0, output: 0 },
  limit: { context: 128_000, output: 4_096 },
} as any

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

async function governedRoot(allowlist: string[]) {
  const parent = await Session.create({ title: "Governed parent" })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Delegate a governed task without widening authority." } } },
    parent.id,
  )
  contract.toolAllowlist = allowlist
  await ContractGuardian.create(parent.id, contract)
  await Session.bindGoverningRun(parent.id, parent.id)
  return parent
}

async function captureChildTools(sessionID: string): Promise<string[]> {
  const originalGetModel = Provider.getModel
  const originalStream = LLM.stream
  let tools: string[] = []
  ;(Provider as any).getModel = async (providerID: string, modelID: string) => {
    if (providerID === "openai" && modelID === "gpt-4o") return testModel
    return originalGetModel(providerID, modelID)
  }
  ;(LLM as any).stream = async (input: any) => {
    tools = Object.keys(input.tools)
    return {
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "error", error: new Error("stop after tool visibility capture") }
        yield { type: "finish" }
      })(),
    }
  }

  try {
    await SessionPrompt.prompt({
      sessionID,
      model: { providerID: "openai", modelID: "gpt-4o" },
      parts: [{ type: "text", text: "Inspect the governed child tool set." }],
    })
  } finally {
    ;(Provider as any).getModel = originalGetModel
    ;(LLM as any).stream = originalStream
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
          child_mcp_probe: { execute: async () => "unexpected" } as any,
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
        const prompt = spyOn(SessionPrompt as any, "prompt").mockImplementation(async (input: any) => {
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
        const prompt = spyOn(SessionPrompt as any, "prompt").mockImplementation(async (input: any) => {
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
