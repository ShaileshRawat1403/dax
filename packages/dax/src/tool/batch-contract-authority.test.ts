import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import { BatchTool } from "./batch"
import { Tool } from "./tool"
import { ToolRegistry } from "./registry"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(
    os.tmpdir(),
    `dax-batch-contract-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  )
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

async function createBatchRun(allowlist: string[]) {
  const session = await Session.create({ title: "Batch contract authority" })
  const { contract } = compileWithRunId(
    { request: { intent: { input: "Exercise one governed batch operation." } } },
    session.id,
  )
  contract.toolAllowlist = allowlist
  contract.toolBlocklist = []
  await ContractGuardian.create(session.id, contract)
  return session
}

function context(sessionID: string): Tool.Context {
  return {
    sessionID,
    messageID: "msg_batch_contract_authority",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    async ask() {},
  }
}

async function executeBatch(sessionID: string, tool_calls: Array<{ tool: string; parameters: Record<string, unknown> }>) {
  const batch = await BatchTool.init()
  return batch.execute({ tool_calls }, context(sessionID))
}

describe("BatchTool contract leaf authority", () => {
  test("an allowlisted nested write executes normally", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await createBatchRun(["batch", "write"])
        const target = path.join(testProject, "allowed-write.txt")

        const result = await executeBatch(session.id, [
          { tool: "write", parameters: { filePath: target, content: "allowed\n" } },
        ])

        expect(await Bun.file(target).text()).toBe("allowed\n")
        expect(result.metadata).toMatchObject({ totalCalls: 1, successful: 1, failed: 0 })
      },
    })
  })

  test("a contract-denied nested leaf never enters its execute body", async () => {
    let executeEntered = false
    const probe = Tool.define("batch-contract-probe", {
      description: "Test-only nested leaf",
      parameters: z.object({}).strict(),
      result: Tool.result(z.object({}).strict()),
      async execute() {
        executeEntered = true
        return { title: "probe", output: "entered", metadata: {} }
      },
    })

    await Instance.provide({
      directory: testProject,
      async fn() {
        await ToolRegistry.register(probe)
        const session = await createBatchRun(["batch"])

        const result = await executeBatch(session.id, [{ tool: "batch-contract-probe", parameters: {} }])

        expect(executeEntered).toBe(false)
        expect(result.metadata).toMatchObject({ totalCalls: 1, successful: 0, failed: 1 })
        expect(result.output).toContain("1 failed")
      },
    })
  })

  test("an unknown nested tool retains its registry-not-found failure", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await createBatchRun(["batch"])

        const result = await executeBatch(session.id, [{ tool: "missing_nested_tool", parameters: {} }])
        const parts = await MessageV2.parts("msg_batch_contract_authority")
        const failure = parts.find(
          (part): part is MessageV2.ToolPart => part.type === "tool" && part.tool === "missing_nested_tool",
        )

        expect(result.metadata).toMatchObject({ totalCalls: 1, successful: 0, failed: 1 })
        expect(failure?.state).toMatchObject({ status: "error", error: expect.stringMatching(/not in registry/) })
      },
    })
  })

  test("mixed authorized and denied leaves retain partial batch completion", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const source = path.join(testProject, "allowed-read.txt")
        const deniedTarget = path.join(testProject, "denied-write.txt")
        await fs.writeFile(source, "readable\n")
        const session = await createBatchRun(["batch", "read"])

        const result = await executeBatch(session.id, [
          { tool: "read", parameters: { filePath: source } },
          { tool: "write", parameters: { filePath: deniedTarget, content: "must not write\n" } },
        ])

        expect(result.metadata).toMatchObject({ totalCalls: 2, successful: 1, failed: 1 })
        expect(result.metadata.details).toEqual([
          { tool: "read", success: true },
          { tool: "write", success: false },
        ])
        expect(await Bun.file(deniedTarget).exists()).toBe(false)
      },
    })
  })
})
