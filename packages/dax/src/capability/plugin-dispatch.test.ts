import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import z from "zod"
import { Instance } from "@/project/instance"
import { Plugin } from "@/plugin"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionSummary } from "@/session/summary"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Permission } from "@/governance"
import { Bus } from "@/bus"
import { MCP } from "@/mcp"
import { BatchTool } from "@/tool/batch"
import { AgentCommand } from "@/cli/cmd/debug/agent"
import { ContractGuardian } from "@/execution/contract-guardian"
import { compileWithRunId } from "@/execution/compiler"
import { CapabilityIdentityError } from "./dynamic-identity"

let home: string
let directory: string
let previousHome: string | undefined
const toolModel = { modelID: "gpt-4o", providerID: "openai" }
const model = Provider.Model.parse({
  id: toolModel.modelID,
  providerID: toolModel.providerID,
  name: "Plugin identity control",
  api: { id: toolModel.modelID, url: "https://example.invalid", npm: "@ai-sdk/openai" },
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
  limit: { context: 128000, output: 4096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
})

type Probe = {
  description: string
  args: z.ZodRawShape
  calls: number
  execute: (args: unknown, ctx: unknown) => Promise<string>
}
beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-plugin-identity-"))
  process.env.DAX_TEST_HOME = home
  directory = path.join(home, "project")
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: directory })
    if (result.exitCode) throw new Error(result.stderr.toString())
  }
  git("init")
  await fs.writeFile(path.join(directory, "seed.txt"), "seed\n")
  git("add", "seed.txt")
  git("-c", "user.name=Identity Control", "-c", "user.email=identity@example.invalid", "commit", "-m", "seed")
  await Instance.disposeAll()
})
afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

function probeSource(label: string) {
  return `{ description: ${JSON.stringify(label)}, args: {}, calls: 0,
    async execute() { this.calls++; return this.description } }`
}
async function directoryTool(alias = "probe", label = "original") {
  const folder = path.join(home, ".config", "dax", "tool")
  await fs.mkdir(folder, { recursive: true })
  const file = path.join(folder, `${alias}.js`)
  await fs.writeFile(file, `export default ${probeSource(label)}`)
  return { file, def: (await import(pathToFileURL(file).href)).default as Probe }
}
async function configuredPlugin(alias = "configured", label = "configured reply", prefix = "source") {
  const folder = path.join(home, ".config", "dax", "plugin")
  await fs.mkdir(folder, { recursive: true })
  const file = path.join(folder, `${prefix}.js`)
  await fs.writeFile(
    file,
    `const definition = ${probeSource(label)};
    let initialized = 0;
    export async function OriginPlugin() { initialized++; definition.initialized = initialized;
      return { tool: { ${JSON.stringify(alias)}: definition } } }
    export default OriginPlugin;`,
  )
  return file
}
function ctx(sessionID = "ses_plugin_control"): Tool.Context {
  return {
    sessionID,
    messageID: "msg_plugin_control",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    async ask() {},
    async authorize() {},
  }
}
async function item(id = "probe") {
  return (await ToolRegistry.tools(toolModel)).filter((tool) => tool.id === id).at(-1)!
}
async function direct(
  sessionID: string,
  alias: string,
  options: { beforeDispatch?: () => void; onModelCall?: () => void } = {},
) {
  let entered = false
  let calls = 0
  let outcome: unknown
  const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
    calls++
    options.onModelCall?.()
    if (!entered && input.tools[alias]?.execute) {
      entered = true
      options.beforeDispatch?.()
      try {
        outcome = await input.tools[alias].execute!(
          {},
          { toolCallId: "call_plugin_control", messages: [], abortSignal: new AbortController().signal },
        )
      } catch (error) {
        outcome = error
      }
    }
    return {
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "error", error: new Error("controlled provider stop") }
        yield { type: "finish" }
      })(),
    } as unknown as Awaited<ReturnType<typeof LLM.stream>>
  })
  try {
    await SessionPrompt.prompt({
      sessionID,
      agent: "build",
      model: toolModel,
      parts: [{ type: "text", text: "Exercise the loader-backed tool." }],
    })
  } finally {
    stream.mockRestore()
    summary.mockRestore()
    getModel.mockRestore()
  }
  return { entered, calls, outcome }
}
/** The description of the tool real prompt resolution offers under an alias; nothing is dispatched. */
async function offeredDescription(sessionID: string, alias: string) {
  let description: string | undefined
  const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
    description ??= input.tools[alias]?.description
    return {
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "error", error: new Error("controlled provider stop") }
        yield { type: "finish" }
      })(),
    } as unknown as Awaited<ReturnType<typeof LLM.stream>>
  })
  try {
    await SessionPrompt.prompt({
      sessionID,
      agent: "build",
      model: toolModel,
      parts: [{ type: "text", text: "Exercise the loader-backed tool." }],
    })
  } finally {
    stream.mockRestore()
    summary.mockRestore()
    getModel.mockRestore()
  }
  return description
}
async function session() {
  const session = await Session.create({ title: "Plugin identity control" })
  await Session.update(session.id, (draft) => {
    draft.permission = [{ permission: "*", pattern: "*", action: "allow" }]
  })
  return session
}
function legacy(alias = "legacy") {
  return Tool.define(alias, {
    description: "Legacy custom",
    parameters: z.object({}),
    result: Tool.Result,
    async execute() {
      return { title: "legacy", output: "legacy", metadata: {} }
    },
  })
}

async function rejection(promise: Promise<unknown>) {
  let error: unknown
  try {
    await promise
  } catch (cause) {
    error = cause
  }
  // Outside the catch: a successful operation cannot catch this assertion.
  expect(error).toBeInstanceOf(Error)
  return error
}

describe("loader-backed plugin capability identity at real dispatch", () => {
  test("directory loader enrolls an opaque descriptor without exposing its source", async () => {
    const loaded = await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        const tool = await item()
        const identity = ToolRegistry.executionIdentity(tool)
        expect(identity.kind).toBe("plugin")
        expect(identity.capability).toMatchObject({
          riskClass: "high",
          scopeSupport: "opaque",
          requiresVerification: true,
        })
        expect(identity.capability?.id).toMatch(/^plugin\.tool\.v1\.p[0-9a-f]{64}$/)
        expect(JSON.stringify(identity.capability)).not.toContain(home)
        expect(tool.description).toBe("original")
        expect(Tool.parseResult("probe", await tool.execute({}, ctx())).output).toBe("original")
        expect(loaded.def.calls).toBe(1)
        const fresh = await item()
        expect(ToolRegistry.executionIdentity(fresh).capability?.id).toBe(identity.capability?.id)
        expect(() => ToolRegistry.executionIdentity(tool)).not.toThrow()
      },
    })
  })

  test("configured plugin keeps origin while named/default aliases initialize once", async () => {
    await configuredPlugin()
    await Instance.provide({
      directory,
      async fn() {
        const tool = await item("configured")
        const hooks = await Plugin.list()
        const def = hooks.find((hook) => hook.tool?.configured)?.tool?.configured as unknown as Probe & {
          initialized: number
        }
        expect(def.initialized).toBe(1)
        expect(ToolRegistry.executionIdentity(tool).capability?.id).toMatch(/^plugin\.tool\./)
        expect(Tool.parseResult("configured", await tool.execute({}, ctx())).output).toBe("configured reply")
        expect(def.calls).toBe(1)
        expect((await Plugin.list()).filter((hook) => hook.tool?.configured)).toHaveLength(1)
      },
    })
  })

  // Before grant stage 1 the loader plugin replaced native read here. A contract
  // names the built-in by that alias, so a plugin sharing the name is no longer
  // selected under it and the built-in stays offered.
  test("under a contract a loader plugin named read does not replace native read or take its descriptor", async () => {
    const loaded = await directoryTool("read", "loader reply")
    await Instance.provide({
      directory,
      async fn() {
        const reads = (await ToolRegistry.tools(toolModel)).filter((tool) => tool.id === "read")
        expect(ToolRegistry.executionIdentity(reads[0]).capability?.id).toBe("native.tool.read")
        expect(ToolRegistry.executionIdentity(reads[1]).capability?.id).toMatch(/^plugin\.tool\./)
        const description = await offeredDescription((await session()).id, "read")
        expect(description).toBeDefined()
        expect(description).not.toBe("loader reply")
        expect(loaded.def.calls).toBe(0)
      },
    })
  })

  test("batch leaf uses the loader-backed captured receiver", async () => {
    const loaded = await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        const batch = await BatchTool.init()
        const result = await batch.execute(
          { tool_calls: [{ tool: "probe", parameters: {} }] },
          ctx((await session()).id),
        )
        expect(result.metadata).toMatchObject({ successful: 1, failed: 0 })
        expect(loaded.def.calls).toBe(1)
      },
    })
  })

  test("real debug handler executes the loader without mock bootstrap and disposes strictly", async () => {
    const loaded = await directoryTool()
    const previousDirectory = process.cwd()
    const model = spyOn(Provider, "defaultModel").mockResolvedValue(toolModel)
    let output = ""
    const stdout = spyOn(process.stdout, "write").mockImplementation((text) => {
      output += String(text)
      return true
    })
    try {
      process.chdir(directory)
      await AgentCommand.handler!({ name: "build", tool: "probe", params: "{}" } as Parameters<
        NonNullable<typeof AgentCommand.handler>
      >[0])
      expect(JSON.parse(output).result.output).toBe("original")
      expect(loaded.def.calls).toBe(1)
    } finally {
      process.chdir(previousDirectory)
      stdout.mockRestore()
      model.mockRestore()
    }
  })

  for (const phase of ["before_dispatch", "before_hook"] as const) {
    test(`changed execution at ${phase} has zero plugin calls and cannot retarget`, async () => {
      const loaded = await directoryTool()
      await Instance.provide({
        directory,
        async fn() {
          const original = loaded.def.execute
          let replacements = 0
          const change = () => {
            loaded.def.execute = async () => {
              replacements++
              return "replacement"
            }
          }
          const trigger = Plugin.trigger
          let beforeHooks = 0
          const hook = spyOn(Plugin, "trigger").mockImplementation(async (...args) => {
            if (args[0] === "tool.execute.before") {
              beforeHooks++
              if (phase === "before_hook") change()
            }
            return trigger(...args)
          })
          const s = await session()
          try {
            const result = await direct(s.id, "probe", phase === "before_dispatch" ? { beforeDispatch: change } : {})
            expect(result.outcome).toBeInstanceOf(CapabilityIdentityError)
            expect(beforeHooks).toBe(phase === "before_dispatch" ? 0 : 1)
          } finally {
            hook.mockRestore()
          }
          expect(loaded.def.calls).toBe(0)
          expect(replacements).toBe(0)
          loaded.def.execute = original
          // Restoring the old function does not resurrect an invalidated generation.
          const renewed = await item()
          expect(() => ToolRegistry.executionIdentity(renewed)).not.toThrow()
        },
      })
    })
  }

  test("real awaited permission approval cannot retarget a changed plugin", async () => {
    const loaded = await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        const s = await session()
        await Session.update(s.id, (draft) => {
          draft.permission = [
            { permission: "*", pattern: "*", action: "allow" },
            { permission: "probe", pattern: "*", action: "ask" },
          ]
        })
        let approvals = 0
        let replacements = 0
        const unsubscribe = Bus.subscribe(Permission.Event.Asked, async (event) => {
          approvals++
          loaded.def.execute = async () => {
            replacements++
            return "replacement"
          }
          await Permission.reply({ requestID: event.properties.id, reply: "once" })
        })
        try {
          const result = await direct(s.id, "probe")
          expect(result.outcome).toBeInstanceOf(CapabilityIdentityError)
          expect(approvals).toBe(1)
          expect(loaded.def.calls).toBe(0)
          expect(replacements).toBe(0)
        } finally {
          unsubscribe()
        }
      },
    })
  })

  test("real permission denial still prevents an enrolled plugin effect", async () => {
    const loaded = await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        const s = await session()
        await Session.update(s.id, (draft) => {
          draft.permission = [
            { permission: "*", pattern: "*", action: "allow" },
            { permission: "probe", pattern: "*", action: "deny" },
          ]
        })
        const result = await direct(s.id, "probe")
        // Denied tools may be omitted before dispatch; neither omission nor the
        // normal denial path may become execution authority through a descriptor.
        expect(loaded.def.calls).toBe(0)
        if (result.entered) expect(result.outcome).toBeInstanceOf(Error)
      },
    })
  })

  test("changed input schema/description invalidate only their own bindings", async () => {
    const a = await directoryTool("a")
    await directoryTool("b")
    await Instance.provide({
      directory,
      async fn() {
        const oldA = await item("a")
        const oldB = await item("b")
        a.def.args = { value: z.string() }
        expect(() => ToolRegistry.executionIdentity(oldA)).toThrow("changed")
        expect(() => ToolRegistry.executionIdentity(oldB)).not.toThrow()
        const newA = await item("a")
        expect(() => ToolRegistry.executionIdentity(oldA)).toThrow("stale")
        a.def.description = "new description"
        expect(() => ToolRegistry.executionIdentity(newA)).toThrow("changed")
        expect(() => ToolRegistry.executionIdentity(oldB)).not.toThrow()
      },
    })
  })

  test("equal JSON schema does not hide a changed Zod refinement callback", async () => {
    const loaded = await directoryTool()
    const validator = z.string().refine(() => true)
    loaded.def.args = { value: validator }
    await Instance.provide({
      directory,
      async fn() {
        const original = await item()
        const before = z.toJSONSchema(original.parameters)
        Reflect.set(validator.def.checks![0]._zod.def, "fn", () => false)
        expect(z.toJSONSchema(original.parameters)).toEqual(before)
        expect(validator.safeParse("value").success).toBe(false)
        expect(() => ToolRegistry.executionIdentity(original)).toThrow("changed")
        expect(loaded.def.calls).toBe(0)
      },
    })
  })

  test("changed initialized authorization/input/description cannot alter the enrolled adapter", async () => {
    const loaded = await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        for (const field of ["authorization", "parameters", "description"] as const) {
          const originalTools = ToolRegistry.tools
          const modified = spyOn(ToolRegistry, "tools").mockImplementation(async (...args) => {
            const tools = await originalTools(...args)
            const plugin = tools.find((tool) => tool.id === "probe")!
            if (field === "authorization") plugin.authorization = "self"
            if (field === "parameters") plugin.parameters = z.object({})
            if (field === "description") plugin.description = "changed"
            return tools
          })
          try {
            const result = await direct((await session()).id, "probe")
            expect(result.outcome).toBeInstanceOf(CapabilityIdentityError)
            expect(loaded.def.calls).toBe(0)
          } finally {
            modified.mockRestore()
          }
        }
      },
    })
  })

  test("in-place initialized input-schema mutation is rejected before an SDK tool effect", async () => {
    const loaded = await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        const originalTools = ToolRegistry.tools
        let offered: Awaited<ReturnType<typeof ToolRegistry.tools>>[number] | undefined
        const capture = spyOn(ToolRegistry, "tools").mockImplementation(async (...args) => {
          const tools = await originalTools(...args)
          offered = tools.find((tool) => tool.id === "probe")
          return tools
        })
        try {
          const result = await direct((await session()).id, "probe", {
            beforeDispatch() {
              const schema = offered!.parameters as z.ZodObject<z.ZodRawShape>
              Reflect.set(schema.def.shape, "changed", z.string())
            },
          })
          expect(result.outcome).toBeInstanceOf(CapabilityIdentityError)
          expect(loaded.def.calls).toBe(0)
        } finally {
          capture.mockRestore()
        }
      },
    })
  })

  test("forged/copied initialized objects and changed wrappers have no enrolled identity", async () => {
    await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        const original = await item()
        expect(() => ToolRegistry.executionIdentity({ ...original })).toThrow("unbound")
        original.execute = async () => ({ title: "forged", output: "forged", metadata: {} })
        expect(() => ToolRegistry.executionIdentity(original)).toThrow("changed")
      },
    })
  })

  test("actual hook tool replacement invalidates old source without retargeting", async () => {
    await configuredPlugin()
    await Instance.provide({
      directory,
      async fn() {
        const old = await item("configured")
        const hooks = (await Plugin.list()).find((hook) => hook.tool?.configured)!
        const replacement = {
          description: "new",
          args: {},
          async execute() {
            return "new"
          },
        }
        hooks.tool!.configured = replacement
        expect(await rejection(old.execute({}, ctx()))).toMatchObject({ code: "changed" })
        const current = await item("configured")
        expect(ToolRegistry.executionIdentity(current).capability?.id).toBe(
          ToolRegistry.executionIdentity(await item("configured")).capability?.id,
        )
        expect(Tool.parseResult("configured", await current.execute({}, ctx())).output).toBe("new")
        expect(await rejection(old.execute({}, ctx()))).toMatchObject({ code: "stale" })
      },
    })
  })

  test("distinct directory/configured aliases collide before table publication or model calls", async () => {
    const loaded = await directoryTool()
    await configuredPlugin("probe")
    await Instance.provide({
      directory,
      async fn() {
        expect(await rejection(ToolRegistry.tools(toolModel))).toMatchObject({ code: "ambiguous" })
        let modelCalls = 0
        expect(
          await rejection(
            direct((await session()).id, "probe", {
              onModelCall: () => {
                modelCalls++
              },
            }),
          ),
        ).toMatchObject({ code: "ambiguous" })
        expect(modelCalls).toBe(0)
        expect(loaded.def.calls).toBe(0)
      },
    })
  })

  test("legacy custom alias cannot replace a loader entry; unrelated old source remains healthy", async () => {
    await directoryTool("a")
    await directoryTool("b")
    await Instance.provide({
      directory,
      async fn() {
        const a = await item("a")
        const b = await item("b")
        await ToolRegistry.register(legacy("a"))
        expect(await rejection(ToolRegistry.tools(toolModel))).toMatchObject({ code: "ambiguous" })
        expect(() => ToolRegistry.executionIdentity(a)).toThrow("stale")
        expect(() => ToolRegistry.executionIdentity(b)).not.toThrow()
      },
    })
  })

  test("MCP alias cannot overwrite the offered loader or legacy table", async () => {
    const loaded = await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        await ToolRegistry.register(legacy())
        for (const alias of ["probe", "legacy"]) {
          let modelCalls = 0
          let transportCalls = 0
          // Only the foreign table is controlled here; this is collision preflight,
          // not evidence of MCP transport identity enrollment (the next delivery).
          const mcp = spyOn(MCP, "tools").mockResolvedValue({
            [alias]: {
              inputSchema: z.object({}),
              execute: async () => {
                transportCalls++
                return { content: [] }
              },
            },
          } as Awaited<ReturnType<typeof MCP.tools>>)
          try {
            expect(
              await rejection(
                direct((await session()).id, "probe", {
                  onModelCall: () => {
                    modelCalls++
                  },
                }),
              ),
            ).toMatchObject({ code: "ambiguous" })
            expect(modelCalls).toBe(0)
            expect(transportCalls).toBe(0)
            expect(loaded.def.calls).toBe(0)
          } finally {
            mcp.mockRestore()
          }
        }
      },
    })
  })

  test("ambiguous discovery surfaces a stable operator notification before model dispatch", async () => {
    await directoryTool("collision")
    await configuredPlugin("collision")
    await Instance.provide({
      directory,
      async fn() {
        const s = await session()
        const notifications: unknown[] = []
        let modelCalls = 0
        const unsubscribe = Bus.subscribe(Session.Event.Error, (event) => {
          notifications.push(event.properties)
        })
        try {
          expect(
            await rejection(
              direct(s.id, "collision", {
                onModelCall() {
                  modelCalls++
                },
              }),
            ),
          ).toMatchObject({ code: "ambiguous" })
          expect(modelCalls).toBe(0)
          expect(notifications).toEqual([
            {
              sessionID: s.id,
              error: { name: "UnknownError", data: { message: "Capability identity rejected: ambiguous" } },
            },
          ])
          expect(JSON.stringify(notifications)).not.toContain(home)
        } finally {
          unsubscribe()
        }
      },
    })
  })

  test("changed adapter during an awaited hook is rechecked before effects", async () => {
    const loaded = await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        let selected: Awaited<ReturnType<typeof item>> | undefined
        const originalTools = ToolRegistry.tools
        const table = spyOn(ToolRegistry, "tools").mockImplementation(async (...args) => {
          const tools = await originalTools(...args)
          selected = tools.find((tool) => tool.id === "probe")
          return tools
        })
        const originalTrigger = Plugin.trigger
        const hook = spyOn(Plugin, "trigger").mockImplementation(async (...args) => {
          if (args[0] === "tool.execute.before") {
            await Promise.resolve()
            selected!.authorization = "self"
          }
          return originalTrigger(...args)
        })
        try {
          const result = await direct((await session()).id, "probe")
          expect(result.outcome).toBeInstanceOf(CapabilityIdentityError)
          expect(loaded.def.calls).toBe(0)
        } finally {
          hook.mockRestore()
          table.mockRestore()
        }
      },
    })
  })

  test("legacy replacement and native override remain compatible and unenrolled", async () => {
    await Instance.provide({
      directory,
      async fn() {
        await ToolRegistry.register(legacy("read"))
        const original = await item("read")
        expect(ToolRegistry.executionIdentity(original).capability).toBeUndefined()
        await ToolRegistry.register(legacy("read"))
        const current = await item("read")
        expect(ToolRegistry.executionIdentity(current).kind).toBe("plugin")
        expect(ToolRegistry.executionIdentity(current).capability).toBeUndefined()
        expect(() => ToolRegistry.executionIdentity(original)).toThrow("stale")
        expect(Tool.parseResult("read", await current.execute({}, ctx())).output).toBe("legacy")
      },
    })
  })

  test("unchanged overlapping discovery preserves healthy bindings; stale changed result cannot overwrite", async () => {
    const loaded = await directoryTool()
    await directoryTool("unrelated")
    await Instance.provide({
      directory,
      async fn() {
        const old = await item()
        const unrelated = await item("unrelated")
        for (const changed of [false, true]) {
          const original = Plugin.toolsFromSources
          let release!: () => void
          let paused!: () => void
          const ready = new Promise<void>((resolve) => {
            paused = resolve
          })
          const gate = new Promise<void>((resolve) => {
            release = resolve
          })
          let first = true
          const hook = spyOn(Plugin, "toolsFromSources").mockImplementation(async () => {
            const sources = await original()
            if (first) {
              first = false
              paused()
              await gate
            }
            return sources
          })
          try {
            const older = ToolRegistry.tools(toolModel)
            await ready
            if (changed) loaded.def.description = "newer metadata"
            const newer = await ToolRegistry.tools(toolModel)
            release()
            if (changed) expect(await rejection(older)).toMatchObject({ code: "stale" })
            else expect(await older).toHaveLength(newer.length)
            expect(() => ToolRegistry.executionIdentity(unrelated)).not.toThrow()
            expect(() => ToolRegistry.executionIdentity(newer.find((tool) => tool.id === "probe")!)).not.toThrow()
          } finally {
            release()
            hook.mockRestore()
          }
        }
        expect(() => ToolRegistry.executionIdentity(old)).toThrow("stale")
      },
    })
  })

  test("instance disposal and different-instance use invalidate only owned bindings", async () => {
    await directoryTool()
    let old: Awaited<ReturnType<typeof item>>
    await Instance.provide({
      directory,
      async fn() {
        old = await item()
      },
    })
    const other = path.join(home, "other")
    await fs.mkdir(other)
    await Instance.provide({
      directory: other,
      async fn() {
        const healthy = await item()
        expect(() => ToolRegistry.executionIdentity(old)).toThrow("stale")
        expect(Tool.parseResult("probe", await healthy.execute({}, ctx())).output).toBe("original")
      },
    })
    await Instance.provide({
      directory,
      async fn() {
        await Instance.dispose()
        expect(() => ToolRegistry.executionIdentity(old)).toThrow("stale")
      },
    })
  })

  test("contract-blocked loader plugin remains denied despite its descriptor", async () => {
    const loaded = await directoryTool()
    await Instance.provide({
      directory,
      async fn() {
        const s = await session()
        const { contract } = compileWithRunId({ request: { intent: { input: "Do not run the plugin" } } }, s.id)
        contract.toolAllowlist = ["probe"]
        contract.toolBlocklist = ["probe"]
        await ContractGuardian.create(s.id, contract)
        const result = await direct(s.id, "probe")
        expect(result.entered).toBe(false)
        expect(loaded.def.calls).toBe(0)
      },
    })
  })
})
