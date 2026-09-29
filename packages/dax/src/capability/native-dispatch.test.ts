import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import z from "zod"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionSummary } from "@/session/summary"
import { LLM } from "@/session/llm"
import { Provider } from "@/provider/provider"
import { Plugin } from "@/plugin"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { ReadTool } from "@/tool/read"
import { WriteTool } from "@/tool/write"
import { BatchTool } from "@/tool/batch"
import { nativeCapabilities } from "./registry"
import { CapabilityIdentityError } from "./dynamic-identity"
import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import { MessageV2 } from "@/session/message-v2"
import { AgentCommand } from "@/cli/cmd/debug/agent"

let home: string
let directory: string
let previousHome: string | undefined
const model = Provider.Model.parse({
  id: "gpt-4o",
  providerID: "openai",
  name: "Capability test",
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
  limit: { context: 128000, output: 4096 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
})

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-native-capability-"))
  directory = path.join(home, "project")
  process.env.DAX_TEST_HOME = home
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd: directory })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  }
  git("init")
  await fs.writeFile(path.join(directory, "seed.txt"), "seed\n")
  git("add", "seed.txt")
  git("-c", "user.name=Capability Test", "-c", "user.email=capability@example.invalid", "commit", "-m", "seed")
  await Instance.disposeAll()
})
afterEach(async () => {
  await Instance.disposeAll()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

function context(sessionID: string): Tool.Context {
  return {
    sessionID,
    messageID: "msg_capability_probe",
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {},
    async ask() {},
    async authorize() {},
  }
}

// Real SessionPrompt tool resolution/dispatch; only the provider response is controlled.
async function direct(sessionID: string, id: string, args: Record<string, unknown>) {
  let outcome: unknown
  let entered = false
  const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
    if (!entered && input.tools[id]?.execute) {
      entered = true
      try {
        outcome = await input.tools[id].execute!(args, {
          toolCallId: "call_capability_probe",
          abortSignal: new AbortController().signal,
          messages: [],
        })
      } catch (error) {
        outcome = error
      }
    }
    return {
      fullStream: (async function* () {
        yield { type: "start" }
        yield { type: "error", error: new Error("controlled stop after invocation") }
        yield { type: "finish" }
      })(),
    } as unknown as Awaited<ReturnType<typeof LLM.stream>>
  })
  try {
    await SessionPrompt.prompt({
      sessionID,
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-4o" },
      parts: [{ type: "text", text: "Exercise capability identity." }],
    })
  } finally {
    stream.mockRestore()
    summary.mockRestore()
    getModel.mockRestore()
  }
  return { entered, outcome }
}

describe("native capability enrollment at production dispatch", () => {
  test("opt-in registration is source-qualified and still uses existing dispatch permission", async () => {
    await Instance.provide({
      directory,
      async fn() {
        let effects = 0
        const tool = {
          id: "custom_probe",
          source: ["test-extension", "probe"],
          description: "Static custom probe",
          parameters: z.object({}),
          result: Tool.result(z.object({})),
          async execute() {
            effects++
            return { title: "probe", output: "custom output", metadata: {} }
          },
        }
        await ToolRegistry.registerEnrolled(tool)
        const selected = (await ToolRegistry.tools({ modelID: "", providerID: "" })).find(
          (item) => item.id === tool.id,
        )!
        const identity = ToolRegistry.executionIdentity(selected)
        expect(identity.kind).toBe("plugin")
        expect(identity.capability).toMatchObject({
          riskClass: "high",
          scopeSupport: "opaque",
          requiresVerification: true,
        })
        expect(identity.capability?.id).toStartWith("plugin.tool.v1.p")
        expect(JSON.stringify(identity.capability)).not.toContain("test-extension")
        const again = (await ToolRegistry.tools({ modelID: "", providerID: "" })).find((item) => item.id === tool.id)!
        expect(ToolRegistry.executionIdentity(selected).capability?.id).toBe(
          ToolRegistry.executionIdentity(again).capability?.id,
        )
        const session = await Session.create({ title: "Opt-in custom identity" })
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: "*", pattern: "*", action: "allow" }]
        })
        const directResult = await direct(session.id, tool.id, {})
        expect(directResult.entered).toBe(true)
        expect(directResult.outcome).not.toBeInstanceOf(Error)
        // A fresh legacy session has no canonical invocation to settle; the
        // batch control exercises the existing no-contract path separately.
        const batchSession = await Session.create({ title: "Opt-in custom batch" })
        const batch = await BatchTool.init()
        const batchResult = await batch.execute(
          { tool_calls: [{ tool: tool.id, parameters: {} }] },
          context(batchSession.id),
        )
        expect(batchResult.metadata).toMatchObject({ successful: 1, failed: 0 })
        expect(effects).toBe(2)
      },
    })
  })

  test("same-name custom enrollment never acquires native identity", async () => {
    await Instance.provide({
      directory,
      async fn() {
        await ToolRegistry.registerEnrolled({
          id: "read",
          source: ["test-extension", "read-override"],
          description: "Custom read override",
          parameters: z.object({}),
          result: Tool.result(z.object({})),
          async execute() {
            return { title: "custom", output: "custom", metadata: {} }
          },
        })
        const reads = (await ToolRegistry.tools({ modelID: "", providerID: "" })).filter((item) => item.id === "read")
        expect(reads).toHaveLength(2)
        expect(ToolRegistry.executionIdentity(reads[0]).capability?.id).toBe("native.tool.read")
        expect(ToolRegistry.executionIdentity(reads[1]).capability?.id).toStartWith("plugin.tool.v1.p")
      },
    })
  })

  test("duplicate custom aliases and sources reject before publication", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const make = (id: string, source: string) => ({
          id,
          source: [source],
          description: "Custom",
          parameters: z.object({}),
          result: Tool.result(z.object({})),
          async execute() {
            return { title: "custom", output: "custom", metadata: {} }
          },
        })
        const legacy = (id: string) =>
          Tool.define(id, {
            description: "Legacy custom",
            parameters: z.object({}),
            result: Tool.result(z.object({})),
            async execute() {
              return { title: "legacy", output: "legacy", metadata: {} }
            },
          })
        await ToolRegistry.register(legacy("one"))
        expect(await ToolRegistry.registerEnrolled(make("one", "different")).catch((error) => error)).toBeInstanceOf(
          CapabilityIdentityError,
        )
        await ToolRegistry.registerEnrolled(make("two", "same"))
        expect(await ToolRegistry.registerEnrolled(make("three", "same")).catch((error) => error)).toMatchObject({
          code: "ambiguous",
        })
        expect(await ToolRegistry.register(legacy("two")).catch((error) => error)).toMatchObject({
          code: "ambiguous",
        })
        expect((await ToolRegistry.tools({ modelID: "", providerID: "" })).some((item) => item.id === "three")).toBe(
          false,
        )
      },
    })
  })

  test("loader alias collision rejects the offered table before effects", async () => {
    const folder = path.join(home, ".config", "dax", "tool")
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(
      path.join(folder, "collision.js"),
      'export default { description: "loader", args: {}, async execute() { return "loader" } }',
    )
    await Instance.provide({
      directory,
      async fn() {
        let effects = 0
        await ToolRegistry.registerEnrolled({
          id: "collision",
          source: ["test-extension", "collision"],
          description: "Colliding registration",
          parameters: z.object({}),
          result: Tool.result(z.object({})),
          async execute() {
            effects++
            return { title: "custom", output: "custom", metadata: {} }
          },
        })
        const error = await ToolRegistry.tools({ modelID: "", providerID: "" }).catch((value) => value)
        expect(error).toMatchObject({ code: "ambiguous" })
        expect(effects).toBe(0)
      },
    })
  })

  test("malformed declared source and schema are rejected without registration", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const base = {
          id: "malformed_probe",
          source: ["declared"],
          description: "Static",
          parameters: z.object({}),
          result: Tool.result(z.object({})),
          async execute() {
            return { title: "custom", output: "custom", metadata: {} }
          },
        }
        for (const change of [{ source: [] }, { parameters: {} }, { authorization: "invalid" }]) {
          expect(
            await ToolRegistry.registerEnrolled({
              ...base,
              ...change,
            } as unknown as ToolRegistry.EnrolledCustomTool).catch((error) => error),
          ).toMatchObject({
            code: "malformed",
          })
        }
        expect((await ToolRegistry.tools({ modelID: "", providerID: "" })).some((item) => item.id === base.id)).toBe(
          false,
        )
      },
    })
  })

  test("denied custom invocation cannot be authorized by its descriptor", async () => {
    await Instance.provide({
      directory,
      async fn() {
        let effects = 0
        await ToolRegistry.registerEnrolled({
          id: "denied_probe",
          source: ["test-extension", "denied"],
          description: "No authority from identity",
          parameters: z.object({}),
          result: Tool.result(z.object({})),
          async execute() {
            effects++
            return { title: "custom", output: "custom", metadata: {} }
          },
        })
        const session = await Session.create({ title: "Denied custom" })
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: "*", pattern: "*", action: "deny" }]
        })
        const outcome = await direct(session.id, "denied_probe", {})
        expect(outcome.entered).toBe(true)
        expect(outcome.outcome).toBeInstanceOf(Error)
        expect(effects).toBe(0)
      },
    })
  })

  test("mutation during awaited execution hook is rejected at the custom effect boundary", async () => {
    await Instance.provide({
      directory,
      async fn() {
        let effects = 0
        const tool = {
          id: "late_mutation_probe",
          source: ["test-extension", "late"],
          description: "Before hook",
          parameters: z.object({}),
          result: Tool.result(z.object({})),
          async execute() {
            effects++
            return { title: "custom", output: "custom", metadata: {} }
          },
        }
        await ToolRegistry.registerEnrolled(tool)
        const session = await Session.create({ title: "Late custom mutation" })
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: "*", pattern: "*", action: "allow" }]
        })
        const trigger = Plugin.trigger
        const hook = spyOn(Plugin, "trigger").mockImplementation(async (...args) => {
          if (args[0] === "tool.execute.before") tool.description = "After hook"
          return trigger(...args)
        })
        try {
          const outcome = await direct(session.id, tool.id, {})
          expect(outcome.entered).toBe(true)
          expect(String(outcome.outcome)).toContain("Capability identity rejected")
          expect(effects).toBe(0)
        } finally {
          hook.mockRestore()
        }
      },
    })
  })

  test("changed enrolled definition fails before hooks or effects while another source stays healthy", async () => {
    await Instance.provide({
      directory,
      async fn() {
        let effects = 0
        let hooksSeen = 0
        const make = (id: string) => ({
          id,
          source: ["test-extension", id],
          description: "Static custom",
          parameters: z.object({}),
          result: Tool.result(z.object({})),
          async execute() {
            effects++
            return { title: "custom", output: "custom", metadata: {} }
          },
        })
        const changed = make("changed_probe")
        await ToolRegistry.registerEnrolled(changed)
        await ToolRegistry.registerEnrolled(make("healthy_probe"))
        const items = await ToolRegistry.tools({ modelID: "", providerID: "" })
        expect(
          ToolRegistry.executionIdentity(items.find((item) => item.id === "healthy_probe")!).capability,
        ).toBeDefined()
        const session = await Session.create({ title: "Changed custom binding" })
        const realTools = ToolRegistry.tools
        const tools = spyOn(ToolRegistry, "tools").mockImplementation(async (...args) => {
          const offered = await realTools(...args)
          changed.description = "changed after offer"
          return offered
        })
        const trigger = Plugin.trigger
        const hook = spyOn(Plugin, "trigger").mockImplementation(async (...args) => {
          if (args[0] === "tool.execute.before") hooksSeen++
          return trigger(...args)
        })
        try {
          const outcome = await direct(session.id, changed.id, {})
          expect(outcome.entered).toBe(true)
          expect(String(outcome.outcome)).toContain("Capability identity rejected")
          expect(effects).toBe(0)
          expect(hooksSeen).toBe(0)
        } finally {
          hook.mockRestore()
          tools.mockRestore()
        }
      },
    })
  })

  test("production built-ins are enrolled; same-name plugin stays unenrolled and executes", async () => {
    await Instance.provide({
      directory,
      async fn() {
        let executed = 0
        await ToolRegistry.register(
          Tool.define("read", {
            description: "Plugin with native name",
            parameters: z.object({}),
            result: Tool.result(z.object({})),
            async execute() {
              executed++
              return { title: "plugin", output: "plugin output", metadata: {} }
            },
          }),
        )
        const items = await ToolRegistry.tools({ modelID: "", providerID: "" })
        for (const item of items) {
          const identity = ToolRegistry.executionIdentity(item)
          if (identity.kind === "builtin") {
            expect(identity.capability?.id).toBe(`native.tool.${item.id}`)
            expect(identity.execute).toBe(item.execute)
          }
        }
        const reads = items.filter((item) => item.id === "read")
        expect(reads).toHaveLength(2)
        expect(ToolRegistry.executionIdentity(reads[0]).capability?.id).toBe("native.tool.read")
        expect(ToolRegistry.executionIdentity(reads[1]).kind).toBe("plugin")
        expect(ToolRegistry.executionIdentity(reads[1]).capability).toBeUndefined()
        const session = await Session.create({ title: "Plugin collision" })
        await Session.update(session.id, (draft) => {
          draft.permission = [{ permission: "*", pattern: "*", action: "allow" }]
        })
        const result = await direct(session.id, "read", {})
        expect(result.entered).toBe(true)
        expect(result.outcome).not.toBeInstanceOf(Error)
        expect(executed).toBe(1)
        // Even a registered reference to a real native definition remains plugin-origin.
        await ToolRegistry.register(ReadTool)
        const registered = (await ToolRegistry.tools({ modelID: "", providerID: "" })).filter(
          (item) => item.id === "read",
        )
        expect(ToolRegistry.executionIdentity(registered[1]).kind).toBe("plugin")
      },
    })
  })

  test("a same-name imitation cannot enroll as a native executor", async () => {
    const imitation = Tool.define("write", {
      description: "Not the native definition",
      parameters: z.object({}),
      result: Tool.result(z.object({})),
      async execute() {
        throw new Error("must not execute")
      },
    })
    const error = await ToolRegistry.initializeNative(imitation).catch((error) => error)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain("Unknown or changed native executor definition")
  })

  test("unenrolled custom initializer retains its original receiver", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const custom: Tool.Info = {
          id: "receiver-probe",
          async init() {
            return {
              description: this.id,
              parameters: z.object({}),
              result: Tool.Result,
              async execute() {
                return { title: "receiver", output: "unchanged", metadata: {} }
              },
            }
          },
        }
        await ToolRegistry.register(custom)
        const item = (await ToolRegistry.tools({ modelID: "", providerID: "" })).find((item) => item.id === custom.id)!
        expect(item.description).toBe(custom.id)
        expect(ToolRegistry.executionIdentity(item).kind).toBe("plugin")
        expect(ToolRegistry.executionIdentity(item).capability).toBeUndefined()
      },
    })
  })

  for (const route of ["direct", "batch"] as const) {
    test(`${route}: unenrolled custom executor retains its initialized receiver`, async () => {
      await Instance.provide({
        directory,
        async fn() {
          let received = ""
          await ToolRegistry.register({
            id: "execute-receiver-probe",
            async init() {
              return {
                description: "original initialized receiver",
                parameters: z.object({}),
                result: Tool.Result,
                async execute(this: { description: string }, _args: unknown, ctx: Tool.Context) {
                  received = this.description
                  const result = Tool.parseResult("execute-receiver-probe", {
                    title: "receiver",
                    output: received,
                    metadata: {},
                  })
                  ctx.captureValidatedResult?.(result)
                  return result
                },
              }
            },
          })
          const session = await Session.create({ title: "Custom receiver" })
          await Session.update(session.id, (draft) => {
            draft.permission = [{ permission: "*", pattern: "*", action: "allow" }]
          })
          if (route === "direct") {
            const result = await direct(session.id, "execute-receiver-probe", {})
            expect(result.entered).toBe(true)
            expect(result.outcome).not.toBeInstanceOf(Error)
          } else {
            const batch = await BatchTool.init()
            const result = await batch.execute(
              { tool_calls: [{ tool: "execute-receiver-probe", parameters: {} }] },
              context(session.id),
            )
            expect(result.metadata).toMatchObject({ successful: 1, failed: 0 })
          }
          expect(received).toBe("original initialized receiver")
        },
      })
    })
  }

  test("genuine native definition cannot acquire another ID or a replacement initializer", async () => {
    const id = WriteTool.id
    const init = WriteTool.init
    let initialized = 0
    try {
      WriteTool.id = "read"
      const renamed = await ToolRegistry.initializeNative(WriteTool).catch((error) => error)
      expect(renamed).toBeInstanceOf(Error)
      expect(renamed.message).toContain("changed native executor definition")
      WriteTool.id = id
      WriteTool.init = async () => {
        initialized++
        return init()
      }
      const replaced = await ToolRegistry.initializeNative(WriteTool).catch((error) => error)
      expect(replaced).toBeInstanceOf(Error)
      expect(replaced.message).toContain("changed native executor definition")
      expect(initialized).toBe(0)
    } finally {
      WriteTool.id = id
      WriteTool.init = init
    }
  })

  for (const route of ["direct", "batch"] as const) {
    test(`${route}: changed executor is rejected before hooks or body`, async () => {
      await Instance.provide({
        directory,
        async fn() {
          const session = await Session.create({ title: "Changed executor" })
          let executed = 0
          let beforeHooks = 0
          const originalTools = ToolRegistry.tools
          const tools = spyOn(ToolRegistry, "tools").mockImplementation(async (...args) => {
            const items = await originalTools(...args)
            const read = items.find((item) => item.id === "read")!
            read.execute = async () => {
              executed++
              return { title: "tampered", output: "tampered", metadata: {} }
            }
            return items
          })
          const originalTrigger = Plugin.trigger
          const hooks = spyOn(Plugin, "trigger").mockImplementation(async (...args) => {
            if (args[0] === "tool.execute.before") beforeHooks++
            return originalTrigger(...args)
          })
          try {
            if (route === "direct") {
              const result = await direct(session.id, "read", { filePath: path.join(directory, "unused") })
              expect(result.entered).toBe(true)
              expect(String(result.outcome)).toContain("Unbound or changed tool executor")
            } else {
              const batch = await BatchTool.init()
              const result = await batch.execute(
                { tool_calls: [{ tool: "read", parameters: { filePath: "unused" } }] },
                context(session.id),
              )
              expect(result.metadata).toMatchObject({ successful: 0, failed: 1 })
              const parts = await MessageV2.parts("msg_capability_probe")
              expect(
                parts.some(
                  (part) =>
                    part.type === "tool" &&
                    part.state.status === "error" &&
                    part.state.error.includes("Unbound or changed tool executor"),
                ),
              ).toBe(true)
            }
            expect(executed).toBe(0)
            expect(beforeHooks).toBe(0)
          } finally {
            hooks.mockRestore()
            tools.mockRestore()
          }
        },
      })
    })
  }

  test("registered native descriptor does not grant a contract-blocked batch write", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await Session.create({ title: "Preserve blocklist" })
        const { contract } = compileWithRunId({ request: { intent: { input: "Inspect only" } } }, session.id)
        contract.toolAllowlist = []
        contract.toolBlocklist = ["write"]
        await ContractGuardian.create(session.id, contract)
        const descriptor = nativeCapabilities.require("native.tool.write")
        expect(descriptor.id).toBe("native.tool.write")
        expect(Reflect.set(descriptor, "riskClass", "low")).toBe(false)
        expect(Reflect.set(descriptor, "requiresVerification", false)).toBe(false)
        expect(nativeCapabilities.require("native.tool.write").riskClass).toBe("high")
        const target = path.join(directory, "denied.txt")
        const batch = await BatchTool.init()
        const result = await batch.execute(
          { tool_calls: [{ tool: "write", parameters: { filePath: target, content: "denied" } }] },
          context(session.id),
        )
        expect(result.metadata).toMatchObject({ successful: 0, failed: 1 })
        expect(await Bun.file(target).exists()).toBe(false)
      },
    })
  })

  for (const route of ["direct", "batch"] as const) {
    test(`${route}: mutation after identity lookup cannot replace the captured executor`, async () => {
      await Instance.provide({
        directory,
        async fn() {
          const session = await Session.create({ title: "Captured executor" })
          await Session.update(session.id, (draft) => {
            draft.permission = [{ permission: "*", pattern: "*", action: "allow" }]
          })
          let selected: Awaited<ReturnType<typeof ToolRegistry.tools>>[number] | undefined
          let replacements = 0
          let changed = false
          const originalTools = ToolRegistry.tools
          const tools = spyOn(ToolRegistry, "tools").mockImplementation(async (...args) => {
            const items = await originalTools(...args)
            selected = items.find((item) => item.id === "read")
            return items
          })
          const replace = () => {
            if (!selected) throw new Error("No selected native executor")
            changed = true
            selected.execute = async () => {
              replacements++
              return { title: "replacement", output: "replacement", metadata: {} }
            }
          }
          const originalTrigger = Plugin.trigger
          const hooks = spyOn(Plugin, "trigger").mockImplementation(async (...args) => {
            if (route === "direct" && args[0] === "tool.execute.before") replace()
            return originalTrigger(...args)
          })
          try {
            if (route === "direct") {
              const result = await direct(session.id, "read", { filePath: path.join(directory, "seed.txt") })
              expect(result.entered).toBe(true)
              expect(result.outcome).not.toBeInstanceOf(Error)
              expect((result.outcome as Tool.Result).output).toContain("seed")
            } else {
              const ctx = context(session.id)
              ctx.ask = async () => {
                replace()
              }
              const batch = await BatchTool.init()
              const result = await batch.execute(
                { tool_calls: [{ tool: "read", parameters: { filePath: path.join(directory, "seed.txt") } }] },
                ctx,
              )
              expect(result.metadata).toMatchObject({ successful: 1, failed: 0 })
            }
            expect(changed).toBe(true)
            expect(replacements).toBe(0)
          } finally {
            hooks.mockRestore()
            tools.mockRestore()
          }
        },
      })
    })
  }

  test("no-contract native batch write retains existing permission flow", async () => {
    await Instance.provide({
      directory,
      async fn() {
        const session = await Session.create({ title: "Legacy native write" })
        let asked = 0
        let authorized = 0
        const ctx = context(session.id)
        ctx.ask = async () => {
          asked++
        }
        ctx.authorize = async () => {
          authorized++
        }
        const target = path.join(directory, "legacy.txt")
        const batch = await BatchTool.init()
        const result = await batch.execute(
          { tool_calls: [{ tool: "write", parameters: { filePath: target, content: "legacy" } }] },
          ctx,
        )
        expect(result.metadata).toMatchObject({ successful: 1, failed: 0 })
        expect(await Bun.file(target).text()).toBe("legacy")
        expect(asked).toBeGreaterThan(0)
        expect(authorized).toBeGreaterThan(0)
      },
    })
  })

  for (const changedBefore of [true, false]) {
    test(`real debug handler: ${changedBefore ? "rejects changed executor before context" : "captures executor across context await"}`, async () => {
      const previousDirectory = process.cwd()
      let selected: Awaited<ReturnType<typeof ToolRegistry.tools>>[number] | undefined
      let replacements = 0
      let contexts = 0
      let output = ""
      const replace = () => {
        if (!selected) throw new Error("No selected native executor")
        selected.execute = async () => {
          replacements++
          return { title: "replacement", output: "replacement", metadata: {} }
        }
      }
      const originalTools = ToolRegistry.tools
      const tools = spyOn(ToolRegistry, "tools").mockImplementation(async (...args) => {
        const items = await originalTools(...args)
        selected = items.find((item) => item.id === "read")
        if (changedBefore) replace()
        return items
      })
      const originalCreate = Session.create
      const sessionTarget = Session as {
        create(input: Parameters<typeof Session.create>[0]): ReturnType<typeof Session.create>
      }
      const create = spyOn(sessionTarget, "create").mockImplementation(async (input) => {
        contexts++
        const session = await originalCreate(input)
        if (!changedBefore) replace()
        return session
      })
      const defaultModel = spyOn(Provider, "defaultModel").mockResolvedValue({
        providerID: "openai",
        modelID: "gpt-4o",
      })
      const stdout = spyOn(process.stdout, "write").mockImplementation((text) => {
        output += String(text)
        return true
      })
      try {
        process.chdir(directory)
        const handler = AgentCommand.handler
        if (typeof handler !== "function") throw new Error("Debug handler unavailable")
        let error: unknown
        try {
          await handler({
            name: "build",
            tool: "read",
            params: JSON.stringify({ filePath: path.join(directory, "seed.txt") }),
            _: [],
            $0: "dax",
          })
        } catch (caught) {
          error = caught
        }
        if (changedBefore) {
          expect(String(error)).toContain("Unbound or changed tool executor")
          expect(contexts).toBe(0)
        } else {
          expect(error).toBeUndefined()
          expect(contexts).toBe(1)
          expect(output).toContain("seed")
        }
        expect(replacements).toBe(0)
      } finally {
        stdout.mockRestore()
        defaultModel.mockRestore()
        create.mockRestore()
        tools.mockRestore()
        process.chdir(previousDirectory)
      }
    })
  }
})
