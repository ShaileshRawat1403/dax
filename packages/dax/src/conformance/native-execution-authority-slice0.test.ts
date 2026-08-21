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
import { expectGap } from "./known-gaps"

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

const testModel = {
  id: "gpt-4o",
  providerID: "openai",
  name: "Characterization model",
  api: { id: "gpt-4o", npm: "@ai-sdk/openai" },
  modalities: { input: ["text"], output: ["text"] },
  cost: { input: 0, output: 0 },
  limit: { context: 128_000, output: 4_096 },
} as any

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

        const originalGetModel = Provider.getModel
        const originalStream = LLM.stream
        const summarySpy = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined as any)
        let batchCallSettled = false
        let offeredTools: string[] = []
        let batchResult: any
        const target = path.join(testProject, ".dax", "lab", "written-through-batch.txt")
        await fs.mkdir(path.dirname(target), { recursive: true })

        ;(Provider as any).getModel = async (providerID: string, modelID: string) => {
          if (providerID === "openai" && modelID === "gpt-4o") return testModel
          return originalGetModel(providerID, modelID)
        }
        ;(LLM as any).stream = async (input: any) => {
          if (input.tools.batch && !batchCallSettled) {
            batchCallSettled = true
            offeredTools = Object.keys(input.tools)
            const output = await input.tools.batch.execute(
              {
                tool_calls: [
                  {
                    tool: "write",
                    parameters: { filePath: target, content: "written by a contract-excluded leaf\n" },
                  },
                ],
              },
              { toolCallId: "call_batch_outer", abortSignal: new AbortController().signal },
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
            }
          }
          return {
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "error", error: new Error("stop after the characterized batch call") }
              yield { type: "finish" }
            })(),
          }
        }

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
          expect(batchResult.metadata).toMatchObject({ totalCalls: 1, successful: 0, failed: 1 })
          expect(batchResult.output).toContain("1 failed")
        } finally {
          summarySpy.mockRestore()
          ;(Provider as any).getModel = originalGetModel
          ;(LLM as any).stream = originalStream
        }
      },
    })
  })

  test("a failed verification shell command is marked satisfied before its result exists", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Verification before execution" })
        const shell = await ShellTool.init()
        const missingTest = path.join(testProject, "missing-verification.test.ts")
        let verificationSatisfiedBeforeShellResult: boolean | undefined

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
              verificationSatisfiedBeforeShellResult = (await Session.get(session.id)).state_v2?.runtime_guard?.verification
                .satisfied
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
        expectGap("integrity.native-verification-preexecution", () => {
          expect(verificationSatisfiedBeforeShellResult).toBe(false)
        })
      },
    })
  })

  test("a failed snapshot diff is returned as the same empty observation shape as no change", async () => {
    await $`git init`.quiet().cwd(testProject)
    await fs.writeFile(path.join(testProject, "tracked.txt"), "baseline\n")

    await Instance.provide({
      directory: testProject,
      async fn() {
        const baseline = await Snapshot.track()
        expect(baseline).toBeTruthy()
        const snapshot = baseline!

        const noChange = await Snapshot.patch(snapshot)
        await fs.rm(path.join(testHome, ".local", "share", "dax", "snapshot", Instance.project.id), {
          recursive: true,
          force: true,
        })
        const failedObservation = await Snapshot.patch(snapshot)

        expect(noChange).toEqual({ hash: snapshot, files: [] })
        expect(failedObservation).toEqual(noChange)
        expectGap("integrity.native-mutation-observation-ambiguity", () => {
          expect(failedObservation).not.toEqual(noChange)
        })
      },
    })
  })
})
