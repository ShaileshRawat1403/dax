import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { bootstrap } from "../cli/bootstrap"

describe("session /explore command", () => {
  test("streams milestone parts into a single assistant message before the final report", async () => {
    const root = await mkdtemp()

    try {
      await bootstrap(root, async () => {
        const { Session } = await import("@/session")
        const { SessionPrompt } = await import("@/session/prompt")
        const { Command } = await import("@/command")
        const { Provider } = await import("@/provider/provider")

        // BEST PRACTICE: Mock the Provider layer to ensure deterministic results 
        // without hitting live LLM APIs. This validates the orchestration logic.
        const originalGetModel = Provider.getModel
        const originalGetSmallModel = Provider.getSmallModel
        const mockModel = {
          id: "gpt-4o",
          providerID: "openai",
          name: "GPT-4o Mock",
          family: "gpt",
          modalities: { input: ["text"], output: ["text"] },
          cost: { input: 0, output: 0 },
          limit: { context: 128000, output: 4096 },
        } as any

        Provider.getModel = async (providerID, modelID) => {
          if (providerID === "openai" && modelID === "gpt-4o") return mockModel
          return originalGetModel(providerID, modelID)
        }
        Provider.getSmallModel = async (providerID) => {
          if (providerID === "openai") return mockModel
          return originalGetSmallModel(providerID)
        }

        try {
          const session = await Session.create({})
          const result = await SessionPrompt.command({
            sessionID: session.id,
            command: Command.Default.EXPLORE,
            arguments: ".",
            model: "openai/gpt-4o",
          })

          const messages = await Session.messages({ sessionID: session.id })
          const assistant = messages.find((msg) => msg.info.id === result.info.id)

          expect(assistant).toBeDefined()
          expect(messages.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)

          const textParts = assistant!.parts.filter((part) => part.type === "text")
          const milestoneTexts = textParts.map((part) => part.text)

          expect(milestoneTexts.slice(0, 7)).toEqual([
            "Intent interpreted",
            "Plan created",
            "Boundary pass completed",
            "Entry-point pass completed",
            "Execution-flow pass completed",
            "Integrations pass completed",
            "Explore execution failed. Failed tasks: task_generate_report",
          ])

          expect(textParts.slice(0, 6).every((part) => part.synthetic === true)).toBe(true)
          expect("completed" in assistant!.info.time && assistant!.info.time.completed).toBeDefined()
        } finally {
          Provider.getModel = originalGetModel
          Provider.getSmallModel = originalGetSmallModel
        }
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 40000)
})

async function mkdtemp() {
  const root = await Bun.$`mktemp -d ${path.join(os.tmpdir(), "dax-explore-session-XXXXXX")}`.text()
  const dir = root.trim()
  await Bun.$`mkdir -p ${path.join(dir, "src")}`.quiet()
  await Bun.$`mkdir -p ${path.join(dir, "bin")}`.quiet()

  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "repo",
      bin: { repo: "./bin/repo" },
      dependencies: {
        "@ai-sdk/openai": "1.0.0",
        "@modelcontextprotocol/sdk": "1.0.0",
      },
    }),
  )
  await Bun.write(path.join(dir, "src", "index.ts"), `import yargs from "yargs"\nyargs([]).scriptName("repo")\n`)
  await Bun.write(
    path.join(dir, "src", "session.ts"),
    `while (true) { SessionStatus.set("s", { type: "busy" }); const stream = await LLM.stream({}); }\n`,
  )
  await Bun.write(path.join(dir, "src", "integrations.ts"), `await fetch("https://api.example.com/status")\n`)
  await Bun.write(path.join(dir, "bin", "repo"), "#!/usr/bin/env bun\n")
  return dir
}
