import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool as McpTool } from "@modelcontextprotocol/sdk/types.js"
import { asSchema } from "ai"
import { MCP } from "."
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionSummary } from "@/session/summary"
import { Provider } from "@/provider/provider"
import { LLM } from "@/session/llm"
import { Plugin } from "@/plugin"
import { Permission } from "@/governance"
import { Bus } from "@/bus"
import { CapabilityIdentityError, mcpCapability } from "@/capability/dynamic-identity"
import { ContractGuardian } from "@/execution/contract-guardian"
import { compileWithRunId } from "@/execution/compiler"
import { Config } from "@/config/config"
import { readRunEvents } from "@/state/events/run-event-store"

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function definition(name = "probe", description = "original"): McpTool {
  return { name, description, inputSchema: { type: "object", properties: {} } }
}

// Real SDK server, production HTTP transport/client/discovery and callTool.
// Only the external server's result/metadata and the model boundary are controlled.
async function server() {
  let definitions = [definition()]
  let listHandler: ((snapshot: McpTool[]) => Promise<McpTool[]>) | undefined
  let outcome: unknown = { content: [{ type: "text", text: "controlled reply" }] }
  let callHandler: (() => Promise<void>) | undefined
  const calls: { name: string; arguments?: Record<string, unknown> }[] = []
  const sessions = new Map<string, { protocol: Server; transport: WebStandardStreamableHTTPServerTransport }>()
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const id = request.headers.get("mcp-session-id")
      let session = id ? sessions.get(id) : undefined
      if (!session && !id && request.method === "POST") {
        const protocol = new Server(
          { name: "identity control", version: "1.0.0" },
          { capabilities: { tools: { listChanged: true } } },
        )
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          // SSE responses return immediately and close on protocol disposal.
          // The SDK's JSON-response test server does not settle cancelled POST
          // response promises on close, which would hang strict fixture shutdown.
          enableJsonResponse: false,
        })
        protocol.setRequestHandler(ListToolsRequestSchema, async () => {
          const snapshot = structuredClone(definitions)
          return { tools: listHandler ? await listHandler(snapshot) : snapshot }
        })
        protocol.setRequestHandler(CallToolRequestSchema, async (request) => {
          calls.push(request.params)
          await callHandler?.()
          return outcome as { content: { type: "text"; text: string }[] }
        })
        await protocol.connect(transport)
        session = { protocol, transport }
        const response = await transport.handleRequest(request)
        sessions.set(transport.sessionId!, session)
        return response
      }
      return session ? session.transport.handleRequest(request) : new Response("Unknown test session", { status: 404 })
    },
  })
  return {
    config: { type: "remote" as const, url: `http://127.0.0.1:${http.port}/mcp`, oauth: false as const, timeout: 3000 },
    calls,
    set tools(value: McpTool[]) {
      definitions = value
    },
    set result(value: unknown) {
      outcome = value
    },
    set onList(value: typeof listHandler) {
      listHandler = value
    },
    set onCall(value: typeof callHandler) {
      callHandler = value
    },
    async changed() {
      await Promise.all([...sessions.values()].map(({ protocol }) => protocol.sendToolListChanged()))
    },
    async close() {
      await Promise.all([...sessions.values()].map(({ protocol }) => protocol.close()))
      await http.stop(true)
    },
  }
}
type Fixture = Awaited<ReturnType<typeof server>>
let home: string
let directory: string
let previousHome: string | undefined
let fixtures: Fixture[]
beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-mcp-identity-"))
  directory = path.join(home, "project")
  process.env.DAX_TEST_HOME = home
  fixtures = []
  await fs.mkdir(directory, { recursive: true })
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  const git = (...args: string[]) => {
    const proc = Bun.spawnSync(["git", ...args], { cwd: directory })
    if (proc.exitCode) throw new Error(proc.stderr.toString())
  }
  git("init")
  await fs.writeFile(path.join(directory, "seed.txt"), "seed\n")
  git("add", "seed.txt")
  git("-c", "user.name=Identity Control", "-c", "user.email=identity@example.invalid", "commit", "-m", "seed")
  await Instance.disposeAll()
  Config.global.reset()
})
afterEach(async () => {
  await Instance.disposeAll()
  await Promise.all(fixtures.map((fixture) => fixture.close()))
  Config.global.reset()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})
async function fixture() {
  const result = await server()
  fixtures.push(result)
  return result
}
async function configure(entries: Record<string, Fixture>) {
  await fs.writeFile(
    path.join(directory, "dax.json"),
    JSON.stringify({
      mcp: Object.fromEntries(Object.entries(entries).map(([name, fixture]) => [name, fixture.config])),
    }),
  )
}
async function invoke(tool: Awaited<ReturnType<typeof MCP.tools>>[string], args: unknown = {}) {
  return tool.execute!(args, {
    toolCallId: "call_mcp_control",
    messages: [],
    abortSignal: new AbortController().signal,
  })
}
async function rejection(promise: Promise<unknown>) {
  let error: unknown
  try {
    await promise
  } catch (cause) {
    error = cause
  }
  expect(error).toBeInstanceOf(Error) // outside catch: cannot catch its own assertion
  return error
}
async function notified(name: string, fixture: Fixture) {
  const notification = deferred()
  const unsubscribe = Bus.subscribe(MCP.ToolsChanged, (event) => {
    if (event.properties.server === name) notification.resolve()
  })
  try {
    await fixture.changed()
    await notification.promise
  } finally {
    unsubscribe()
  }
}

const modelKey = { modelID: "gpt-4o", providerID: "openai" }
const model = Provider.Model.parse({
  id: modelKey.modelID,
  providerID: modelKey.providerID,
  name: "MCP identity control",
  api: { id: modelKey.modelID, url: "https://example.invalid", npm: "@ai-sdk/openai" },
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
async function session() {
  const result = await Session.create({ title: "MCP identity control" })
  await Session.update(result.id, (draft) => {
    draft.permission = [{ permission: "*", pattern: "*", action: "allow" }]
  })
  return result
}
async function dispatch(sessionID: string, alias: string, before?: () => Promise<void>) {
  let entered = false
  let modelCalls = 0
  let outcome: unknown
  let offered: string[] = []
  const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
  const summary = spyOn(SessionSummary, "summarize").mockResolvedValue(undefined)
  const stream = spyOn(LLM, "stream").mockImplementation(async (input) => {
    modelCalls++
    offered = Object.keys(input.tools)
    if (!entered && input.tools[alias]?.execute) {
      entered = true
      await before?.()
      try {
        outcome = await invoke(input.tools[alias])
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
      model: modelKey,
      parts: [{ type: "text", text: "Exercise the controlled MCP tool." }],
    })
  } finally {
    stream.mockRestore()
    summary.mockRestore()
    getModel.mockRestore()
  }
  return { entered, modelCalls, outcome, offered }
}

describe("MCP identity through production discovery and dispatch", () => {
  test("real local stdio transport retains enrollment and strict process cleanup", async () => {
    const file = path.join(home, "stdio-control.mjs")
    const sdk = (specifier: string) => JSON.stringify(import.meta.resolve(specifier))
    await fs.writeFile(
      file,
      `
      import { Server } from ${sdk("@modelcontextprotocol/sdk/server/index.js")};
      import { StdioServerTransport } from ${sdk("@modelcontextprotocol/sdk/server/stdio.js")};
      import { ListToolsRequestSchema, CallToolRequestSchema } from ${sdk("@modelcontextprotocol/sdk/types.js")};
      const server = new Server({name:"stdio control",version:"1"},{capabilities:{tools:{}}});
      server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:"probe",description:"stdio",inputSchema:{type:"object",properties:{}}}]}));
      server.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:"text",text:"stdio reply"}]}));
      await server.connect(new StdioServerTransport());
    `,
    )
    await fs.writeFile(
      path.join(home, ".config", "dax", "dax.json"),
      JSON.stringify({ mcp: { local: { type: "local", command: [process.execPath, file] } } }),
    )
    await Instance.provide({
      directory,
      async fn() {
        const tool = (await MCP.tools()).local_probe
        expect(MCP.executionIdentity(tool).capability.id).toMatch(/^mcp\.tool/)
        expect(await invoke(tool)).toEqual({ content: [{ type: "text", text: "stdio reply" }] })
        await Instance.dispose()
        expect(await rejection(invoke(tool))).toMatchObject({ code: "stale" })
      },
    })
    // Removal is strict; no fixture retries or mocked production bootstrap.
    await fs.rm(file)
  })

  test("an already-started effect keeps its captured outcome; invalidation does not replay it", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        const tool = (await MCP.tools()).remote_probe
        const entered = deferred()
        const release = deferred()
        remote.onCall = async () => {
          entered.resolve()
          await release.promise
        }
        const effect = invoke(tool)
        await entered.promise
        await notified("remote", remote)
        release.resolve()
        expect(await effect).toEqual({ content: [{ type: "text", text: "controlled reply" }] })
        expect(await rejection(invoke(tool))).toMatchObject({ code: "stale" })
        expect(remote.calls).toHaveLength(1)
      },
    })
  })
  test("family/source encoding stays distinct and rejects malformed fields", () => {
    expect(mcpCapability(["mcp", "a_b", "c"]).descriptor.id).not.toBe(mcpCapability(["mcp", "a", "b_c"]).descriptor.id)
    for (const name of ["", "\ud800", "\udc00"])
      expect(() => mcpCapability(["mcp", "server", name])).toThrow("malformed")
  })
  test("real transport retains raw names and enrolls conservative opaque descriptors", async () => {
    const remote = await fixture()
    remote.tools = [definition("raw.name/é")]
    await configure({ "source.key": remote })
    await Instance.provide({
      directory,
      async fn() {
        const table = await MCP.tools()
        const tool = table.source_key_raw_name__
        const identity = MCP.executionIdentity(tool)
        expect(identity.capability).toMatchObject({
          riskClass: "high",
          scopeSupport: "opaque",
          requiresVerification: true,
        })
        expect(identity.capability.id).toBe(mcpCapability(["mcp", "source.key", "raw.name/é"]).descriptor.id)
        expect(identity.capability.id).toMatch(/^mcp\.tool\.v1\.m[0-9a-f]{64}$/)
        expect(JSON.stringify(identity.capability)).not.toContain("source.key")
        expect(await invoke(tool)).toEqual({ content: [{ type: "text", text: "controlled reply" }] })
        expect(remote.calls).toEqual([{ name: "raw.name/é", arguments: {} }])
        expect(() => MCP.executionIdentity({ ...tool })).toThrow("unbound")
      },
    })
  })

  test("unchanged rediscovery keeps prepared bindings healthy", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        const old = (await MCP.tools()).remote_probe
        const fresh = (await MCP.tools()).remote_probe
        expect(MCP.executionIdentity(old).capability.id).toBe(MCP.executionIdentity(fresh).capability.id)
        await invoke(old)
        await invoke(fresh)
        expect(remote.calls).toHaveLength(2)
      },
    })
  })

  for (const change of ["description", "schema", "removed"] as const)
    test(`changed ${change} invalidates the prior binding`, async () => {
      const remote = await fixture()
      await configure({ remote })
      await Instance.provide({
        directory,
        async fn() {
          const old = (await MCP.tools()).remote_probe
          remote.tools =
            change === "removed"
              ? []
              : [
                  change === "description"
                    ? definition("probe", "changed")
                    : { ...definition(), inputSchema: { type: "object", properties: { value: { type: "string" } } } },
                ]
          await MCP.tools()
          expect(await rejection(invoke(old))).toBeInstanceOf(CapabilityIdentityError)
          expect(remote.calls).toHaveLength(0)
        },
      })
    })

  test("tools-changed invalidates immediately without disturbing an unrelated source", async () => {
    const a = await fixture()
    const b = await fixture()
    await configure({ a, b })
    await Instance.provide({
      directory,
      async fn() {
        const old = await MCP.tools()
        await notified("a", a)
        expect(await rejection(invoke(old.a_probe))).toBeInstanceOf(CapabilityIdentityError)
        await invoke(old.b_probe)
        const fresh = await MCP.tools()
        await invoke(fresh.a_probe)
        expect(a.calls).toHaveLength(1)
        expect(b.calls).toHaveLength(1)
      },
    })
  })

  test("disconnect and replacement invalidate before effects without retargeting", async () => {
    const a = await fixture()
    const replacement = await fixture()
    await configure({ a })
    await Instance.provide({
      directory,
      async fn() {
        const old = (await MCP.tools()).a_probe
        await MCP.add("a", replacement.config)
        expect(await rejection(invoke(old))).toBeInstanceOf(CapabilityIdentityError)
        const current = (await MCP.tools()).a_probe
        await MCP.disconnect("a")
        expect(await rejection(invoke(current))).toBeInstanceOf(CapabilityIdentityError)
        expect(a.calls).toHaveLength(0)
        expect(replacement.calls).toHaveLength(0)
        expect(await MCP.tools()).toEqual({})
      },
    })
  })

  test("unexpected client closure invalidates prepared adapters", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        const old = (await MCP.tools()).remote_probe
        await (await MCP.clients()).remote.close()
        expect(await rejection(invoke(old))).toBeInstanceOf(CapabilityIdentityError)
        expect(remote.calls).toHaveLength(0)
      },
    })
  })

  for (const duplicate of ["raw", "sanitized", "servers"] as const)
    test(`ambiguous ${duplicate} aliases reject the entire table`, async () => {
      const a = await fixture()
      const b = await fixture()
      if (duplicate === "servers") await configure({ "source.a": a, "source/a": b })
      else {
        a.tools = duplicate === "raw" ? [definition(), definition()] : [definition("raw.name"), definition("raw/name")]
        await configure({ a })
      }
      await Instance.provide({
        directory,
        async fn() {
          const error = await rejection(MCP.tools())
          expect(error).toBeInstanceOf(CapabilityIdentityError)
          expect((error as CapabilityIdentityError).code).toBe("ambiguous")
          expect(a.calls).toHaveLength(0)
          expect(b.calls).toHaveLength(0)
        },
      })
    })

  for (const field of ["execute", "description", "schema", "client"] as const)
    test(`changed adapter ${field} fails before transport`, async () => {
      const remote = await fixture()
      await configure({ remote })
      await Instance.provide({
        directory,
        async fn() {
          const tool = (await MCP.tools()).remote_probe
          const bound = MCP.executionIdentity(tool).execute
          if (field === "execute")
            tool.execute = async () => {
              throw new Error("must never run")
            }
          if (field === "description") tool.description = "changed"
          if (field === "schema") Reflect.set(asSchema(tool.inputSchema).jsonSchema, "additionalProperties", true)
          if (field === "client")
            (await MCP.clients()).remote.callTool = async () => {
              throw new Error("must never run")
            }
          const error = await rejection(bound({}, { toolCallId: "call_mutated", messages: [] }))
          expect(error).toBeInstanceOf(CapabilityIdentityError)
          expect(remote.calls).toHaveLength(0)
        },
      })
    })

  test("older overlapping discovery cannot overwrite a newer catalog", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.tools()
        const entered = deferred()
        const release = deferred()
        let held = false
        remote.onList = async (snapshot) => {
          if (!held) {
            held = true
            entered.resolve()
            await release.promise
          }
          return snapshot
        }
        const older = MCP.tools()
        const oldResult = older.catch((error) => error)
        await entered.promise
        remote.tools = [definition("probe", "newest")]
        const newer = (await MCP.tools()).remote_probe
        release.resolve()
        expect(await oldResult).toBeInstanceOf(CapabilityIdentityError)
        expect(MCP.executionIdentity(newer).capability.id).toMatch(/^mcp\.tool/)
        expect(newer.description).toBe("newest")
        await invoke(newer)
        expect(remote.calls).toHaveLength(1)
      },
    })
  })

  test("a replaced client defeats outstanding discovery without invalidating the new client", async () => {
    const remote = await fixture()
    const replacement = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.tools()
        const entered = deferred()
        const release = deferred()
        remote.onList = async (snapshot) => {
          entered.resolve()
          await release.promise
          return snapshot
        }
        const oldResult = MCP.tools().catch((error) => error)
        await entered.promise
        await MCP.add("remote", replacement.config)
        const current = (await MCP.tools()).remote_probe
        release.resolve()
        expect(await oldResult).toBeInstanceOf(CapabilityIdentityError)
        await invoke(current)
        expect(remote.calls).toHaveLength(0)
        expect(replacement.calls).toHaveLength(1)
      },
    })
  })

  test("real SessionPrompt keeps hooks, authorization and result translation", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        let before = 0
        let after = 0
        const hooks = (await Plugin.list())[0]
        hooks["tool.execute.before"] = async (input) => {
          if (input.tool === "remote_probe") before++
        }
        hooks["tool.execute.after"] = async (input) => {
          if (input.tool === "remote_probe") after++
        }
        const result = await dispatch((await session()).id, "remote_probe")
        expect(result.entered).toBe(true)
        expect(result.outcome).toMatchObject({
          output: "controlled reply",
          content: [{ type: "text", text: "controlled reply" }],
        })
        expect(before).toBe(1)
        expect(after).toBe(1)
        expect(remote.calls).toHaveLength(1)
      },
    })
  })

  test("a real MCP dispatch records the tool's source-qualified identity, record only", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        const created = await session()
        const result = await dispatch(created.id, "remote_probe")
        expect(result.entered).toBe(true)
        const events = await readRunEvents(created.id)
        const resolutions = events.filter((event) => event.type === "capability_resolution_recorded")
        expect(resolutions).toHaveLength(1)
        expect(resolutions[0].payload).toMatchObject({
          enforcement: "record_only",
          path: "mcp_tool",
          initiator: "model",
          // The identity minted from the configured server and the server's own
          // tool name, not the alias the model called.
          capabilityId: mcpCapability(["mcp", "remote", "probe"]).descriptor.id,
          enrolled: true,
          basis: "v1_contract",
          decision: "allow",
        })
        // The enforced decision is a separate event, recorded after the shadow.
        const order = events.map((event) => event.type)
        expect(order.indexOf("tool_invocation_recorded")).toBeLessThan(order.indexOf("capability_resolution_recorded"))
        expect(order.indexOf("capability_resolution_recorded")).toBeLessThan(order.indexOf("authorization_recorded"))
        expect(remote.calls).toHaveLength(1)
      },
    })
  })

  test("captured call method preserves its actual receiver", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        const client = (await MCP.clients()).remote
        const original = client.callTool
        const receivers: unknown[] = []
        client.callTool = function (...args) {
          receivers.push(this)
          return original.apply(this, args)
        }
        await invoke((await MCP.tools()).remote_probe)
        expect(receivers).toEqual([client])
        expect(remote.calls).toHaveLength(1)
      },
    })
  })

  test("malformed changed catalog invalidates old bindings, not unrelated sources", async () => {
    const a = await fixture()
    const b = await fixture()
    await configure({ a, b })
    await Instance.provide({
      directory,
      async fn() {
        const old = await MCP.tools()
        a.tools = [definition("\ud800")]
        expect(await rejection(MCP.tools())).toBeInstanceOf(CapabilityIdentityError)
        expect(await rejection(invoke(old.a_probe))).toBeInstanceOf(CapabilityIdentityError)
        await invoke(old.b_probe)
        expect(a.calls).toHaveLength(0)
        expect(b.calls).toHaveLength(1)
      },
    })
  })

  test("ambiguous changed catalog cannot serve an omitted old tool", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        const old = (await MCP.tools()).remote_probe
        remote.tools = [definition("different.name"), definition("different/name")]
        expect(await rejection(MCP.tools())).toMatchObject({ code: "ambiguous" })
        expect(await rejection(invoke(old))).toMatchObject({ code: "stale" })
        expect(remote.calls).toHaveLength(0)
      },
    })
  })

  test("ordinary list failure retains its status semantics and healthy siblings", async () => {
    const a = await fixture()
    const b = await fixture()
    await configure({ a, b })
    await Instance.provide({
      directory,
      async fn() {
        const old = await MCP.tools()
        a.onList = async () => {
          throw new Error("controlled list failure")
        }
        const current = await MCP.tools()
        expect(Object.keys(current)).toEqual(["b_probe"])
        expect((await MCP.status()).a.status).toBe("failed")
        expect(await rejection(invoke(old.a_probe))).toBeInstanceOf(CapabilityIdentityError)
        await invoke(old.b_probe)
        await invoke(current.b_probe)
        expect(b.calls).toHaveLength(2)
      },
    })
  })

  test("an older failed listing cannot disable newer healthy discovery", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.tools()
        const entered = deferred()
        const release = deferred()
        let held = false
        remote.onList = async (snapshot) => {
          if (!held) {
            held = true
            entered.resolve()
            await release.promise
            throw new Error("old list failure")
          }
          return snapshot
        }
        const oldResult = MCP.tools().catch((error) => error)
        await entered.promise
        const current = (await MCP.tools()).remote_probe
        release.resolve()
        expect(await oldResult).toMatchObject({ code: "stale" })
        expect((await MCP.status()).remote.status).toBe("connected")
        await invoke(current)
        expect(remote.calls).toHaveLength(1)
      },
    })
  })

  for (const caller of ["dispatch", "operator catalog"] as const)
    test(`older ${caller} discovery cannot overwrite the SDK's newer output validator`, async () => {
      const remote = await fixture()
      await configure({ remote })
      remote.tools = [
        {
          ...definition(),
          outputSchema: { type: "object", properties: { old: { type: "string" } }, required: ["old"] },
        },
      ]
      await Instance.provide({
        directory,
        async fn() {
          await MCP.tools()
          const entered = deferred()
          const release = deferred()
          let held = false
          remote.onList = async (snapshot) => {
            if (!held) {
              held = true
              entered.resolve()
              await release.promise
            }
            return snapshot
          }
          const oldResult = (caller === "dispatch" ? MCP.tools() : MCP.toolCatalog("remote")).catch((error) => error)
          await entered.promise
          remote.tools = [
            {
              ...definition(),
              outputSchema: { type: "object", properties: { fresh: { type: "string" } }, required: ["fresh"] },
            },
          ]
          const current = (await MCP.tools()).remote_probe
          release.resolve()
          expect(await oldResult).toBeInstanceOf(CapabilityIdentityError)
          remote.result = { content: [{ type: "text", text: "new output" }], structuredContent: { fresh: "value" } }
          expect(await invoke(current)).toMatchObject({ structuredContent: { fresh: "value" } })
          expect(remote.calls).toHaveLength(1)
        },
      })
    })

  test("older connection creation cannot replace a newer client", async () => {
    const original = await fixture()
    const slow = await fixture()
    const latest = await fixture()
    await configure({ remote: original })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.tools()
        const entered = deferred()
        const release = deferred()
        slow.onList = async (snapshot) => {
          entered.resolve()
          await release.promise
          return snapshot
        }
        const oldResult = MCP.add("remote", slow.config).catch((error) => error)
        await entered.promise
        await MCP.add("remote", latest.config)
        const current = (await MCP.tools()).remote_probe
        release.resolve()
        expect(await oldResult).toMatchObject({ code: "stale" })
        await invoke(current)
        expect(slow.calls).toHaveLength(0)
        expect(latest.calls).toHaveLength(1)
      },
    })
  })

  test("disposal waits for owned connection creation and prevents late installation", async () => {
    const remote = await fixture()
    const pending = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.tools()
        const entered = deferred()
        const release = deferred()
        pending.onList = async (snapshot) => {
          entered.resolve()
          await release.promise
          return snapshot
        }
        const creation = MCP.add("remote", pending.config).catch((error) => error)
        await entered.promise
        let completed = false
        const disposal = Instance.dispose().then(() => {
          completed = true
        })
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(completed).toBe(false)
        release.resolve()
        expect(await creation).toMatchObject({ code: "stale" })
        await disposal
        expect(completed).toBe(true)
        expect(pending.calls).toHaveLength(0)
      },
    })
  })

  test("instance ownership and disposal prevent cross-instance identity use", async () => {
    const remote = await fixture()
    await configure({ remote })
    let old!: Awaited<ReturnType<typeof MCP.tools>>[string]
    await Instance.provide({
      directory,
      async fn() {
        old = (await MCP.tools()).remote_probe
      },
    })
    const other = path.join(home, "other")
    await fs.mkdir(other)
    await Instance.provide({
      directory: other,
      async fn() {
        expect(await rejection(invoke(old))).toBeInstanceOf(CapabilityIdentityError)
      },
    })
    await Instance.provide({
      directory,
      async fn() {
        await invoke(old)
        await Instance.dispose()
        expect(await rejection(invoke(old))).toBeInstanceOf(CapabilityIdentityError)
      },
    })
    expect(remote.calls).toHaveLength(1)
  })

  test("invalidation during real permission approval never retargets transport", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        const current = await session()
        await Session.update(current.id, (draft) => {
          draft.permission = [{ permission: "remote_probe", pattern: "*", action: "ask" }]
        })
        let asks = 0
        const unsubscribe = Bus.subscribe(Permission.Event.Asked, async (event) => {
          asks++
          await notified("remote", remote)
          await Permission.reply({ requestID: event.properties.id, reply: "once" })
        })
        try {
          const result = await dispatch(current.id, "remote_probe")
          expect(result.outcome).toBeInstanceOf(CapabilityIdentityError)
          expect(asks).toBe(1)
          expect(remote.calls).toHaveLength(0)
        } finally {
          unsubscribe()
        }
      },
    })
  })

  test("real MCP/plugin alias collision rejects before the model and publishes a stable operator error", async () => {
    const remote = await fixture()
    await configure({ remote })
    const folder = path.join(home, ".config", "dax", "tool")
    await fs.mkdir(folder)
    await fs.writeFile(
      path.join(folder, "remote_probe.js"),
      'export default { description: "collision", args: {}, execute: async () => "must not execute" }',
    )
    await Instance.provide({
      directory,
      async fn() {
        const current = await session()
        const errors: unknown[] = []
        const unsubscribe = Bus.subscribe(Session.Event.Error, (event) => {
          errors.push(event.properties.error)
        })
        let modelCalls = 0
        const stream = spyOn(LLM, "stream").mockImplementation(async () => {
          modelCalls++
          throw new Error("must not call provider")
        })
        const getModel = spyOn(Provider, "getModel").mockResolvedValue(model)
        try {
          const error = await rejection(
            SessionPrompt.prompt({
              sessionID: current.id,
              agent: "build",
              model: modelKey,
              parts: [{ type: "text", text: "Check collision." }],
            }),
          )
          expect(error).toMatchObject({ code: "ambiguous" })
          expect(errors).toContainEqual({
            name: "UnknownError",
            data: { message: "Capability identity rejected: ambiguous" },
          })
          expect(modelCalls).toBe(0)
          expect(remote.calls).toHaveLength(0)
        } finally {
          unsubscribe()
          stream.mockRestore()
          getModel.mockRestore()
        }
      },
    })
  })

  test("SDK protocol result validation and DAX translation stay in force", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        remote.result = {
          content: [
            { type: "image", data: "Zg==", mimeType: "image/png" },
            { type: "text", text: "mixed" },
          ],
        }
        const result = await dispatch((await session()).id, "remote_probe")
        expect(result.outcome).toMatchObject({
          output: "mixed",
          attachments: [{ mime: "image/png", url: "data:image/png;base64,Zg==" }],
        })
        remote.result = { content: [{ type: "text", text: 123 }] }
        expect(await rejection(invoke((await MCP.tools()).remote_probe))).toBeInstanceOf(Error)
        expect(remote.calls).toHaveLength(2)
      },
    })
  })

  test("invalidation before execution prevents hooks and transport", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        let before = 0
        ;(await Plugin.list())[0]["tool.execute.before"] = async () => {
          before++
        }
        const result = await dispatch((await session()).id, "remote_probe", () => notified("remote", remote))
        expect(result.outcome).toBeInstanceOf(CapabilityIdentityError)
        expect(before).toBe(0)
        expect(remote.calls).toHaveLength(0)
      },
    })
  })

  test("invalidation during an awaited before hook is rechecked at the effect", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        let before = 0
        ;(await Plugin.list())[0]["tool.execute.before"] = async (input) => {
          if (input.tool === "remote_probe") {
            before++
            await notified("remote", remote)
          }
        }
        const result = await dispatch((await session()).id, "remote_probe")
        expect(result.outcome).toBeInstanceOf(CapabilityIdentityError)
        expect(before).toBe(1)
        expect(remote.calls).toHaveLength(0)
      },
    })
  })

  test("existing permission denial remains a denial despite descriptive identity", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        const current = await session()
        await Session.update(current.id, (draft) => {
          draft.permission = [{ permission: "remote_probe", pattern: "*", action: "deny" }]
        })
        let before = 0
        ;(await Plugin.list())[0]["tool.execute.before"] = async () => {
          before++
        }
        const result = await dispatch(current.id, "remote_probe")
        expect(result.outcome).toBeInstanceOf(Permission.DeniedError)
        expect(before).toBe(0)
        expect(remote.calls).toHaveLength(0)
      },
    })
  })

  test("parent contract still excludes MCP tools in a derived session", async () => {
    const remote = await fixture()
    await configure({ remote })
    await Instance.provide({
      directory,
      async fn() {
        const parent = await session()
        const { contract } = compileWithRunId({ request: { intent: { input: "Inspect without tools." } } }, parent.id)
        contract.toolAllowlist = ["read"]
        await ContractGuardian.create(parent.id, contract)
        await Session.bindGoverningRun(parent.id, parent.id)
        const child = await Session.fork({ sessionID: parent.id })
        const result = await dispatch(child.id, "remote_probe")
        expect(result.entered).toBe(false)
        expect(result.offered).not.toContain("remote_probe")
        expect(remote.calls).toHaveLength(0)
      },
    })
  })
})
