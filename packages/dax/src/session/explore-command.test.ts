import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { bootstrap } from "../cli/bootstrap"

describe("session /explore command", () => {
  test(
    "streams milestone parts into a single assistant message before the final report",
    async () => {
      const root = await mkdtemp()

      try {
        await bootstrap(root, async () => {
          const { Session } = await import("@/session")
          const { SessionPrompt } = await import("@/session/prompt")
          const { Command } = await import("@/command")

          const session = await Session.create({})
          const result = await SessionPrompt.command({
            sessionID: session.id,
            command: Command.Default.EXPLORE,
            arguments: ".",
            model: "openai/gpt-5.2",
          })

          const messages = await Session.messages({ sessionID: session.id })
          const assistant = messages.find((msg) => msg.info.id === result.info.id)

          expect(assistant).toBeDefined()
          expect(messages.filter((msg) => msg.info.role === "assistant")).toHaveLength(1)

          const textParts = assistant!.parts.filter((part) => part.type === "text")
          const milestoneTexts = textParts.slice(0, 7).map((part) => part.text)

          expect(milestoneTexts).toEqual([
            "Intent interpreted",
            "Plan created",
            "Boundary pass completed",
            "Entry-point pass completed",
            "Execution-flow pass completed",
            "Integrations pass completed",
            "Report prepared",
          ])

          expect(textParts.slice(0, 7).every((part) => part.synthetic === true)).toBe(true)
          expect(textParts[7]?.text).toContain("Repository shape")
          expect("completed" in assistant!.info.time && assistant!.info.time.completed).toBeDefined()
        })
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
    40000,
  )
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
  await Bun.write(path.join(dir, "src", "session.ts"), `while (true) { SessionStatus.set("s", { type: "busy" }); const stream = await LLM.stream({}); }\n`)
  await Bun.write(path.join(dir, "src", "integrations.ts"), `await fetch("https://api.example.com/status")\n`)
  await Bun.write(path.join(dir, "bin", "repo"), "#!/usr/bin/env bun\n")
  return dir
}
