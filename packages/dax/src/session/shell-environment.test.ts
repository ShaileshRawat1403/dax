import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import "@/server/server"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Instance } from "@/project/instance"
import { Plugin } from "@/plugin"
import { Permission } from "@/governance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Shell } from "@/shell/shell"
import { Sandbox } from "@/shell/sandbox"
import { ShellTool } from "@/tool/shell"
import type { Tool } from "@/tool/tool"

const protectedKeys = [
  "DAX_SERVER_PASSWORD",
  "dax_server_password",
  "DAX_SERVER_USERNAME",
  "DAX_SUBSTRATE_TOKEN",
  "DAX_NATS_CREDS",
  "DAX_NATS_CREDS_PATH",
  "DAX_API",
  "DAX_CONFIG_CONTENT",
  "INFISICAL_TOKEN",
  "INFISICAL_CLIENT_SECRET",
]
let root = ""
let previous: Record<string, string | undefined> = {}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "dax-shell-environment-"))
  for (const name of [...protectedKeys, "DAX_TEST_HOME", "DAX_PROJECT_PROBE"]) previous[name] = process.env[name]
  // Controlled sentinels only. Never read or print operator credential values.
  for (const name of protectedKeys) process.env[name] = "controlled-operator-sentinel"
  process.env.DAX_TEST_HOME = root
  process.env.DAX_PROJECT_PROBE = "project-env-preserved"
})

afterEach(async () => {
  await Instance.disposeAll()
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  previous = {}
  await fs.rm(root, { recursive: true, force: true })
})

for (const producer of ["model tool", "operator shell", "wrapped command", "plain command"] as const) {
  test(`${producer} does not inherit operator credentials`, async () => {
    const marker = path.join(root, "child-env.json")
    const probe = path.join(root, "probe.cjs")
    await fs.writeFile(
      probe,
      `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
      protected: Object.keys(process.env).filter(k => ${JSON.stringify(protectedKeys.map((k) => k.toUpperCase()))}.includes(k.toUpperCase())),
      project: process.env.DAX_PROJECT_PROBE, path: Boolean(process.env.PATH || process.env.Path)
    }));`,
    )
    // A quoted executable as cmd.exe /c's first token has different stripping
    // rules. Use the pinned Bun on PATH, while keeping the script path quoted.
    const command = `bun "${probe.replaceAll("\\", "/")}"`
    // Config overrides the ambient inline sentinel so this is a controlled project.
    process.env.DAX_CONFIG_CONTENT = "{}"
    await fs.writeFile(
      path.join(root, "dax.json"),
      JSON.stringify({ command: { probe: { template: `!\`${command}\`` } } }),
    )
    await Instance.provide({
      directory: root,
      async fn() {
        const session = await Session.create({ title: "Controlled environment probe" })
        const trigger = Plugin.trigger
        const hook = spyOn(Plugin, "trigger").mockImplementation((async (name: string, ...args: unknown[]) => {
          if (name === "shell.env")
            return { env: { DAX_SERVER_PASSWORD: "controlled-hook-sentinel", DAX_PROJECT_PROBE: "hook-env-preserved" } }
          return (trigger as (...args: unknown[]) => unknown)(name, ...args)
        }) as typeof Plugin.trigger)
        const preferred = spyOn(Shell, "preferred").mockReturnValue(
          process.platform === "win32" ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh",
        )
        const wrap = spyOn(Sandbox, "wrap").mockResolvedValue(
          producer === "wrapped command" ? [process.execPath, probe] : null,
        )
        const ask = spyOn(Permission, "ask").mockResolvedValue(undefined as never)
        const model = spyOn(Provider, "getModel").mockRejectedValue(new Error("controlled model boundary"))
        try {
          if (producer === "model tool") {
            const tool = await ShellTool.init()
            const ctx: Tool.Context = {
              sessionID: session.id,
              messageID: "msg_env_probe",
              agent: "build",
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              async ask() {},
              async authorize() {},
            }
            const result = await tool.execute({ command, description: "Probe controlled child environment" }, ctx)
            expect(result.metadata.exit).toBe(0)
          } else if (producer === "operator shell") {
            const result = await SessionPrompt.shell({
              sessionID: session.id,
              agent: "build",
              model: { providerID: "openai", modelID: "gpt-4o" },
              command,
            })
            expect(result.parts[0]).toMatchObject({ type: "tool", state: { status: "completed", output: "" } })
          } else {
            let failure: unknown
            try {
              await SessionPrompt.command({
                sessionID: session.id,
                command: "probe",
                arguments: "",
                model: "openai/gpt-4o",
              })
            } catch (error) {
              failure = error
            }
            expect(failure).toBeInstanceOf(Error)
            expect(failure).toHaveProperty("message", "controlled model boundary")
          }
          expect(JSON.parse(await fs.readFile(marker, "utf8"))).toEqual({
            protected: [],
            project: producer.endsWith("command") ? "project-env-preserved" : "hook-env-preserved",
            path: true,
          })
          expect(process.env.DAX_SERVER_PASSWORD).toBe("controlled-operator-sentinel")
        } finally {
          model.mockRestore()
          ask.mockRestore()
          wrap.mockRestore()
          preferred.mockRestore()
          hook.mockRestore()
        }
      },
    })
  })
}
