import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { $ } from "bun"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { LLM } from "@/session/llm"
import { SessionSummary } from "@/session/summary"
import { Provider } from "@/provider/provider"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import { ShellTool } from "@/tool/shell"
import { Permission } from "@/governance"
import { enforceRuntimeGuard } from "@/execution/runtime-guard"
import { Snapshot } from "@/snapshot"
import { BatchTool } from "@/tool/batch"
import { Tool } from "@/tool/tool"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""

beforeEach(async () => {
  previousTestHome = process.env.DAX_TEST_HOME
  testHome = path.join(
    os.tmpdir(),
    `dax-native-authority-slice0-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
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

const testModel = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  name: "Characterization model",
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

describe("native execution authority slice 0", () => {
  test("an allowlisted batch call cannot execute a contract-excluded write leaf", async () => {
    await fs.writeFile(path.join(testProject, "dax.json"), JSON.stringify({ experimental: { batch_tool: true } }))

    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Batch leaf authority" })
        const { contract } = compileWithRunId(
          { request: { intent: { input: "Use batch for one permitted operation." } } },
          session.id,
        )
        contract.toolAllowlist = ["batch"]
        await ContractGuardian.create(session.id, contract)

        const summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
        let batchCallSettled = false
        let offeredTools: string[] = []
        let batchResult: Tool.InferResult<typeof BatchTool> | undefined
        const target = path.join(testProject, ".dax", "lab", "written-through-batch.txt")
        await fs.mkdir(path.dirname(target), { recursive: true })

        const originalGetModel = Provider.getModel
        const getModel = spyOn(Provider, "getModel").mockImplementation(async (providerID, modelID) => {
          if (providerID === "openai" && modelID === "gpt-4o") return testModel
          return originalGetModel(providerID, modelID)
        })
        const stream = spyOn(LLM, "stream").mockImplementation(async (input: LLM.StreamInput) => {
          const batch = input.tools.batch
          if (batch?.execute && !batchCallSettled) {
            batchCallSettled = true
            offeredTools = Object.keys(input.tools)
            const output = await batch.execute(
              {
                tool_calls: [
                  {
                    tool: "write",
                    parameters: { filePath: target, content: "written by a contract-excluded leaf\n" },
                  },
                ],
              },
              { toolCallId: "call_batch_outer", abortSignal: new AbortController().signal, messages: [] },
            )
            batchResult = output
            return {
              fullStream: (async function* () {
                yield { type: "start" }
                yield { type: "tool-input-start", id: "call_batch_outer", toolName: "batch" }
                yield {
                  type: "tool-call",
                  toolCallId: "call_batch_outer",
                  toolName: "batch",
                  input: {
                    tool_calls: [
                      { tool: "write", parameters: { filePath: target, content: "written by a contract-excluded leaf\n" } },
                    ],
                  },
                }
                yield { type: "tool-result", toolCallId: "call_batch_outer", output }
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
              yield { type: "error", error: new Error("stop after the characterized batch call") }
              yield { type: "finish" }
            })(),
          } as unknown as Awaited<ReturnType<typeof LLM.stream>>
        })

        try {
          // Persist a real prior user message so the execution prompt enters
          // the native loop without intent classification assigning a mode.
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
            parts: [{ type: "text", text: "Run the permitted batch operation." }],
          })

          expect(offeredTools).toContain("batch")
          expect(offeredTools).not.toContain("write")
          expect(await Bun.file(target).exists()).toBe(false)
          expect(batchResult).toBeDefined()
          expect(batchResult!.metadata).toMatchObject({ totalCalls: 1, successful: 0, failed: 1 })
          expect(batchResult!.output).toContain("1 failed")
        } finally {
          summarySpy.mockRestore()
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })

  test("a failed verification shell command never satisfies verification before or after its result", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Verification before execution" })
        const shell = await ShellTool.init()
        const missingTest = path.join(testProject, "missing-verification.test.ts")
        let verificationBeforeShellResult:
          | {
              required: boolean
              satisfied: boolean
              receipts: string[]
            }
          | undefined

        const result = await shell.execute(
          {
            command: `bun test ${missingTest}`,
            description: "Runs an intentionally missing test file",
          },
          {
            sessionID: session.id,
            messageID: "message_verification_characterization",
            callID: "call_verification_characterization",
            agent: "build",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask(req) {
              await enforceRuntimeGuard({
                sessionID: session.id,
                agent: "build",
                toolID: "shell",
                req,
                callID: "call_verification_characterization",
              })
              const verification = (await Session.get(session.id)).state_v2?.runtime_guard?.verification
              verificationBeforeShellResult = verification
                ? {
                    required: verification.required,
                    satisfied: verification.satisfied,
                    receipts: [...verification.receipts],
                  }
                : undefined
              await Permission.ask({
                ...req,
                sessionID: session.id,
                tool: { messageID: "message_verification_characterization", callID: "call_verification_characterization" },
                ruleset: Permission.fromConfig({ shell: "allow" }),
              })
            },
          },
        )

        expect(result.metadata.exit).not.toBe(0)
        expect(verificationBeforeShellResult).toEqual({
          required: true,
          satisfied: false,
          receipts: [],
        })
        expect((await Session.get(session.id)).state_v2?.runtime_guard?.verification).toEqual({
          required: true,
          satisfied: false,
          receipts: [],
        })
      },
    })
  })

  test("snapshot observation failures are distinct from a successful no-change observation", async () => {
    await $`git init`.quiet().cwd(testProject)
    await fs.writeFile(path.join(testProject, "tracked.txt"), "baseline\n")

    await Instance.provide({
      directory: testProject,
      async fn() {
        const baseline = await Snapshot.track()
        expect(baseline).toBeTruthy()
        const snapshot = baseline!

        const noChange = await Snapshot.patch(snapshot)
        const failedDiff = await Snapshot.patch("not-a-snapshot-hash")
        await fs.rm(path.join(testHome, ".local", "share", "dax", "snapshot", Instance.project.id), {
          recursive: true,
          force: true,
        })
        const failedStage = await Snapshot.patch(snapshot)

        expect(noChange).toEqual({ status: "observed", patch: { hash: snapshot, files: [] } })
        expect(failedDiff).toMatchObject({
          status: "failed",
          hash: "not-a-snapshot-hash",
          failure: { code: "snapshot_diff_failed" },
        })
        expect(failedStage).toMatchObject({
          status: "failed",
          hash: snapshot,
          failure: { code: "snapshot_stage_failed" },
        })
      },
    })
  })
})
