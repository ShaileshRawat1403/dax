import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { ToolRegistry } from "@/tool/registry"
import type { Tool } from "@/tool/tool"
import * as ProjectTrust from "./trust"

/**
 * Approval binds content, and the runtime caches modules for the life of the
 * process. These tests observe which version actually executes: every module
 * reports the version string written into its own source.
 */

let home = ""
let directory = ""
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-content-cache-"))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(path.join(directory, ".dax"), { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  const result = Bun.spawnSync(["git", "init"], { cwd: directory })
  if (result.exitCode) throw new Error(result.stderr.toString())
  await Instance.disposeAll()
  Config.global.reset()
})

afterEach(async () => {
  await Instance.disposeAll()
  Config.global.reset()
  ProjectTrust.setWithheld(ProjectTrust.empty)
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

const effects = () => path.join(home, "effects.log")
async function effectLog() {
  return (await fs.readFile(effects(), "utf8").catch(() => "")).split("\n").filter(Boolean)
}

const toolFolder = () => path.join(directory, ".dax", "tool")
const pluginFolder = () => path.join(directory, ".dax", "plugin")

/** A tool whose load and whose execution both report the version in its source. */
async function writeTool(version: string, options: { helper?: string; name?: string } = {}) {
  const name = options.name ?? "control"
  await fs.mkdir(path.join(toolFolder(), "lib"), { recursive: true })
  if (options.helper !== undefined) {
    await fs.writeFile(path.join(toolFolder(), "lib", "helper.js"), `export const helper = ${JSON.stringify(options.helper)}\n`)
  }
  await fs.writeFile(
    path.join(toolFolder(), `${name}.js`),
    `${options.helper !== undefined ? `import { helper } from "./lib/helper.js"` : `const helper = "none"`}
require("node:fs").appendFileSync(${JSON.stringify(effects())}, "load ${name} ${version} " + helper + "\\n")
export default { description: "control", args: {}, async execute() { return "${version} " + helper } }
`,
  )
}

/** A plugin whose load and whose initialization both report its version. */
async function writePlugin(version: string, options: { helper?: string } = {}) {
  await fs.mkdir(path.join(pluginFolder(), "lib"), { recursive: true })
  if (options.helper !== undefined) {
    await fs.writeFile(path.join(pluginFolder(), "lib", "helper.js"), `export const helper = ${JSON.stringify(options.helper)}\n`)
  }
  await fs.writeFile(
    path.join(pluginFolder(), "control.js"),
    `${options.helper !== undefined ? `import { helper } from "./lib/helper.js"` : `const helper = "none"`}
require("node:fs").appendFileSync(${JSON.stringify(effects())}, "load plugin ${version} " + helper + "\\n")
export const ControlPlugin = async () => {
  require("node:fs").appendFileSync(${JSON.stringify(effects())}, "init plugin ${version} " + helper + "\\n")
  return {}
}
`,
  )
}

async function session<T>(fn: () => Promise<T>): Promise<T> {
  await Instance.disposeAll()
  return Instance.provide({ directory, fn })
}

async function approve() {
  await session(async () => {
    await Config.get()
    await ProjectTrust.trust(ProjectTrust.root(Instance.worktree, Instance.directory), ProjectTrust.getWithheld())
  })
}

const ctx = {
  sessionID: "ses_content_cache",
  messageID: "msg_content_cache",
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata() {},
  async ask() {},
  async authorize() {},
} as unknown as Tool.Context

/** Discover and execute the tool in a fresh instance; what it returned, or the rejection. */
async function runTool(name = "control") {
  return session(async () => {
    try {
      const tools = await ToolRegistry.tools({ providerID: "openai", modelID: "gpt-4o" })
      const tool = tools.find((item) => item.id === name)
      if (!tool) return { offered: false as const }
      const identity = ToolRegistry.executionIdentity(tool)
      const output = await identity.execute.call(identity.receiver, {} as never, ctx)
      return { offered: true as const, output: (output as { output: string }).output }
    } catch (error) {
      return { error }
    }
  })
}

async function loadPlugins() {
  return session(async () => {
    try {
      await Plugin.list()
      return { loaded: true as const }
    } catch (error) {
      return { error }
    }
  })
}

/** The same load in a process of its own: what a full restart executes. */
function freshProcess(kind: "tool" | "plugin", toolId = "control") {
  const result = Bun.spawnSync(
    [process.execPath, "run", "test/fixture/project-trust-process.ts", directory, kind, toolId],
    { cwd: path.join(import.meta.dir, "..", ".."), env: { ...process.env, DAX_TEST_HOME: home } },
  )
  const line = result.stdout
    .toString()
    .split("\n")
    .find((item) => item.startsWith("TRUST_PROCESS_RESULT "))
  if (!line) throw new Error(`fresh process produced no result: ${result.stderr.toString().slice(-2000)}`)
  return JSON.parse(line.slice("TRUST_PROCESS_RESULT ".length))
}

function expectRestartRequired(result: { error?: unknown }) {
  expect(result.error).toBeInstanceOf(ProjectTrust.ProjectRestartRequiredError)
  expect(result.error).toMatchObject({
    code: "restart_required",
    message: "Project executable files changed after this process loaded them. Restart DAX to run the approved version.",
  })
  // Stable and path-free: nothing about this machine is in the message.
  expect((result.error as Error).message).not.toContain(home)
}

describe("approved content is what executes: project tools", () => {
  test("re-approving an edited tool does not run the cached version, and a fresh process runs the approved one", async () => {
    await writeTool("A")
    await approve()
    expect(await runTool()).toEqual({ offered: true, output: "A none" })
    expect(await effectLog()).toEqual(["load control A none"])

    await writeTool("B")
    await approve()
    const stale = await runTool()
    expectRestartRequired(stale)
    expect((stale.error as ProjectTrust.ProjectRestartRequiredError).files).toEqual([
      path.join(toolFolder(), "control.js"),
    ])
    // Rejected before any effect: neither version was loaded or executed again.
    expect(await effectLog()).toEqual(["load control A none"])
    // It stays rejected for the life of this process.
    expectRestartRequired(await runTool())

    expect(freshProcess("tool")).toEqual({ offered: true, output: "B none" })
    expect(await effectLog()).toEqual(["load control A none", "load control B none"])
  }, 60_000)

  test("a changed helper is rejected even though the entry module is unchanged", async () => {
    await writeTool("A", { helper: "h1" })
    await approve()
    expect(await runTool()).toEqual({ offered: true, output: "A h1" })

    await fs.writeFile(path.join(toolFolder(), "lib", "helper.js"), `export const helper = "h2"\n`)
    await approve()
    const stale = await runTool()
    expectRestartRequired(stale)
    expect((stale.error as ProjectTrust.ProjectRestartRequiredError).files).toEqual([
      path.join(toolFolder(), "lib", "helper.js"),
    ])
    expect(await effectLog()).toEqual(["load control A h1"])

    expect(freshProcess("tool")).toEqual({ offered: true, output: "A h2" })
  }, 60_000)

  test("an unchanged tool reloads across instances, and content restored to what was loaded runs again", async () => {
    await writeTool("A")
    await approve()
    expect(await runTool()).toEqual({ offered: true, output: "A none" })
    expect(await runTool()).toEqual({ offered: true, output: "A none" })

    await writeTool("B")
    await approve()
    expectRestartRequired(await runTool())

    // Back to the exact content this process loaded: the cached module is that content.
    await writeTool("A")
    await approve()
    expect(await runTool()).toEqual({ offered: true, output: "A none" })
    expect(await effectLog()).toEqual(["load control A none"])
  })

  test("a file added beside loaded tools imports fresh; a removed loaded file requires a restart", async () => {
    await writeTool("A", { helper: "h1" })
    await approve()
    expect(await runTool()).toEqual({ offered: true, output: "A h1" })

    await writeTool("N", { name: "added" })
    await approve()
    expect(await runTool("added")).toEqual({ offered: true, output: "N none" })
    expect(await runTool()).toEqual({ offered: true, output: "A h1" })

    await fs.rm(path.join(toolFolder(), "added.js"))
    await approve()
    expectRestartRequired(await runTool())
  })

  test("the real prompt path rejects with the stable error and notifies the operator", async () => {
    await writeTool("A")
    await approve()
    expect(await runTool()).toEqual({ offered: true, output: "A none" })
    await writeTool("B")
    await approve()
    await session(async () => {
      const created = await Session.create({ title: "Content cache" })
      const notifications: unknown[] = []
      const unsubscribe = Bus.subscribe(Session.Event.Error, (event) => {
        notifications.push(event.properties)
      })
      let reason: unknown
      try {
        await SessionPrompt.prompt({
          sessionID: created.id,
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-4o" },
          parts: [{ type: "text", text: "Use the tool." }],
        })
      } catch (error) {
        reason = error
      } finally {
        unsubscribe()
      }
      expectRestartRequired({ error: reason })
      expect(JSON.stringify(notifications)).toContain("Restart DAX to run the approved version.")
      expect(JSON.stringify(notifications)).not.toContain(home)
    })
    expect(await effectLog()).toEqual(["load control A none"])
  })
})

describe("approved content is what executes: project plugins", () => {
  test("re-approving an edited plugin does not initialize the cached version, and a fresh process runs the approved one", async () => {
    await writePlugin("A")
    await approve()
    expect(await loadPlugins()).toEqual({ loaded: true })
    expect(await effectLog()).toEqual(["load plugin A none", "init plugin A none"])

    await writePlugin("B")
    await approve()
    const stale = await loadPlugins()
    expectRestartRequired(stale)
    expect((stale.error as ProjectTrust.ProjectRestartRequiredError).files).toEqual([
      path.join(pluginFolder(), "control.js"),
    ])
    // Rejected before any effect: the cached plugin was not initialized again.
    expect(await effectLog()).toEqual(["load plugin A none", "init plugin A none"])
    expectRestartRequired(await loadPlugins())

    expect(freshProcess("plugin")).toEqual({ loaded: true })
    expect(await effectLog()).toEqual([
      "load plugin A none",
      "init plugin A none",
      "load plugin B none",
      "init plugin B none",
    ])
  }, 60_000)

  test("a changed plugin helper is rejected even though the entry module is unchanged", async () => {
    await writePlugin("A", { helper: "h1" })
    await approve()
    expect(await loadPlugins()).toEqual({ loaded: true })

    await fs.writeFile(path.join(pluginFolder(), "lib", "helper.js"), `export const helper = "h2"\n`)
    await approve()
    const stale = await loadPlugins()
    expectRestartRequired(stale)
    expect((stale.error as ProjectTrust.ProjectRestartRequiredError).files).toEqual([
      path.join(pluginFolder(), "lib", "helper.js"),
    ])
    expect(await effectLog()).toEqual(["load plugin A h1", "init plugin A h1"])

    expect(freshProcess("plugin")).toEqual({ loaded: true })
    expect((await effectLog()).slice(-2)).toEqual(["load plugin A h2", "init plugin A h2"])
  }, 60_000)

  test("an unchanged plugin initializes again in a new instance", async () => {
    await writePlugin("A")
    await approve()
    expect(await loadPlugins()).toEqual({ loaded: true })
    expect(await loadPlugins()).toEqual({ loaded: true })
    // Loaded once by the runtime, initialized once per instance.
    expect(await effectLog()).toEqual(["load plugin A none", "init plugin A none", "init plugin A none"])
  })
})
