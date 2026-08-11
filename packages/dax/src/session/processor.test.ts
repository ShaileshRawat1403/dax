import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { Bus } from "@/bus"
import { SessionStatus } from "./status"

describe("session processor deny handling", () => {
  test(
    "promotes denied permissions to assistant-level failure before stopping",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-session-processor-${Date.now().toString(36)}`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { Session } = await import("./index")
        const { SessionProcessor } = await import("./processor")
        const { Identifier } = await import("@/id/id")
        const { LLM } = await import("./llm")
        const { Permission } = await import("@/governance")
        const repoRoot = path.resolve(import.meta.dir, "../../..")

        await bootstrap(repoRoot, async () => {
          const session = await Session.create({
            title: "Denied permission test",
          })

          const assistant = (await Session.updateMessage({
            id: Identifier.ascending("message"),
            parentID: Identifier.ascending("message"),
            role: "assistant",
            mode: "test-agent",
            agent: "test-agent",
            path: {
              cwd: repoRoot,
              root: repoRoot,
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: "test-model",
            providerID: "openai",
            time: {
              created: Date.now(),
            },
            sessionID: session.id,
          })) as any

          const originalStream = LLM.stream
          ;(LLM as any).stream = async () => ({
            fullStream: (async function* () {
              yield { type: "start" }
              yield { type: "tool-input-start", id: "tool_1", toolName: "apply_patch" }
              yield { type: "tool-call", toolCallId: "tool_1", toolName: "apply_patch", input: { path: "x.txt" } }
              yield {
                type: "tool-error",
                toolCallId: "tool_1",
                input: { path: "x.txt" },
                error: new Permission.RejectedError(),
              }
            })(),
          })

          try {
            const processor = SessionProcessor.create({
              assistantMessage: assistant,
              sessionID: session.id,
              model: {
                id: "test-model",
                providerID: "openai",
              } as any,
              abort: new AbortController().signal,
            })

            const result = await processor.process({
              user: {} as any,
              agent: { name: "test-agent", mode: "test" } as any,
              abort: new AbortController().signal,
              sessionID: session.id,
              system: [],
              messages: [],
              tools: {},
              model: {
                id: "test-model",
                providerID: "openai",
              } as any,
            })

            const messages = await Session.messages({ sessionID: session.id })
            const updatedAssistant = messages.find((message) => message.info.id === assistant.id)?.info as any

            expect(result).toBe("stop")
            expect(updatedAssistant?.role).toBe("assistant")
            expect(updatedAssistant?.error).toBeDefined()
            expect(JSON.stringify(updatedAssistant?.error)).toContain("The user rejected permission")
            expect(updatedAssistant?.time.completed).toBeDefined()
          } finally {
            ;(LLM as any).stream = originalStream
          }
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )

  test(
    "does not report the provider as slow when it fails immediately",
    async () => {
      const testHome = path.join(os.tmpdir(), `dax-session-processor-${Date.now().toString(36)}`)
      const previousHome = process.env.DAX_TEST_HOME
      process.env.DAX_TEST_HOME = testHome

      try {
        const { bootstrap } = await import("@/cli/bootstrap")
        const { Session } = await import("./index")
        const { SessionProcessor } = await import("./processor")
        const { Identifier } = await import("@/id/id")
        const { LLM } = await import("./llm")
        const repoRoot = path.resolve(import.meta.dir, "../../..")

        await bootstrap(repoRoot, async () => {
          const session = await Session.create({
            title: "Immediate provider failure test",
          })

          const assistant = (await Session.updateMessage({
            id: Identifier.ascending("message"),
            parentID: Identifier.ascending("message"),
            role: "assistant",
            mode: "test-agent",
            agent: "test-agent",
            path: {
              cwd: repoRoot,
              root: repoRoot,
            },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            modelID: "test-model",
            providerID: "google",
            time: {
              created: Date.now(),
            },
            sessionID: session.id,
          })) as any

          const statuses: SessionStatus.Info[] = []
          Bus.subscribe(SessionStatus.Event.Status, (event) => {
            if (event.properties.sessionID === session.id) statuses.push(event.properties.status)
          })

          const originalStream = LLM.stream
          ;(LLM as any).stream = async () => {
            throw new Error("Google Generative AI API key is missing.")
          }

          try {
            await SessionProcessor.create({
              assistantMessage: assistant,
              sessionID: session.id,
              model: {
                id: "test-model",
                providerID: "google",
              } as any,
              abort: new AbortController().signal,
            }).process({
              user: {} as any,
              agent: { name: "test-agent", mode: "test" } as any,
              abort: new AbortController().signal,
              sessionID: session.id,
              system: [],
              messages: [],
              tools: {},
              model: {
                id: "test-model",
                providerID: "google",
              } as any,
            })

            const falseSlowMessage = statuses.find(
              (status) => status.type === "delayed" && status.message.includes("Gemini is slow right now"),
            )
            expect(falseSlowMessage).toBeUndefined()
          } finally {
            ;(LLM as any).stream = originalStream
          }
        })
      } finally {
        if (previousHome === undefined) delete process.env.DAX_TEST_HOME
        else process.env.DAX_TEST_HOME = previousHome
        rmSync(testHome, { recursive: true, force: true })
      }
    },
    40000,
  )
})
