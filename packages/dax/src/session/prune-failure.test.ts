import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionCompaction } from "@/session/compaction"
import { SessionSummary } from "@/session/summary"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"

let testHome = ""
let previousTestHome: string | undefined
let testProject = ""
let restoreSummary: (() => void) | undefined

const testModel = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  name: "Prune failure test model",
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
  testHome = path.join(os.tmpdir(), `dax-prune-failure-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  testProject = path.join(testHome, "project")
  process.env.DAX_TEST_HOME = testHome
  await fs.mkdir(testProject, { recursive: true })
  await fs.mkdir(path.join(testHome, ".config", "dax"), { recursive: true })
  await Instance.disposeAll()
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  restoreSummary = () => summary.mockRestore()
})

afterEach(async () => {
  restoreSummary?.()
  restoreSummary = undefined
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
        usage: { inputTokens: 1, outputTokens: 1 },
        providerMetadata: {},
      }
      yield { type: "finish" }
    })(),
  } as unknown as Awaited<ReturnType<typeof LLM.stream>>
}

/**
 * Background pruning is fire-and-forget and was the only one of the three such
 * calls in the prompt loop without a rejection handler. A live process reaches
 * this whenever storage refuses mid-prune — a session archived or deleted while
 * the just-finished turn is still walking its messages raises ENOENT — and an
 * unhandled rejection over work that is purely an optimisation can take the
 * process down.
 */
describe("background prune failure", () => {
  test("a rejecting prune neither fails the turn nor escapes as an unhandled rejection", async () => {
    await Instance.provide({
      directory: testProject,
      async fn() {
        const session = await Session.create({ title: "Prune failure" })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(testModel)
        const stream = spyOn(LLM, "stream").mockImplementation(async () => mockStreamingResponse("Turn output."))
        const prune = spyOn(SessionCompaction, "prune").mockRejectedValue(
          new Error("Resource not found: storage/message/ses_gone/msg_gone.json"),
        )

        const escaped: unknown[] = []
        const onUnhandled = (reason: unknown) => escaped.push(reason)
        process.on("unhandledRejection", onUnhandled)

        try {
          const message = await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-4o" },
            parts: [{ type: "text", text: "Run one ordinary turn." }],
          })

          // The turn itself is unaffected by a failed optimisation.
          expect(message.info.role).toBe("assistant")
          expect(prune).toHaveBeenCalled()

          // Let any unhandled rejection reach the process handler before asserting.
          await Promise.resolve()
          await Promise.resolve()
          expect(escaped).toEqual([])
        } finally {
          process.off("unhandledRejection", onUnhandled)
          prune.mockRestore()
          getModel.mockRestore()
          stream.mockRestore()
        }
      },
    })
  })
})
