import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Config } from "@/config/config"
import { MCP } from "@/mcp"
import { Instance } from "@/project/instance"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import z from "zod"
import { CapabilityCatalog } from "./catalog"
import { CapabilityDescriptor } from "./capability-types"

const toolModel = { modelID: "gpt-4o", providerID: "openai" }
let home = ""
let previousHome: string | undefined
let closers: (() => Promise<void>)[] = []

// Real SDK server and production HTTP transport; only the listed tools are controlled.
async function mcpServer() {
  const sessions = new Map<string, { protocol: Server; transport: WebStandardStreamableHTTPServerTransport }>()
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const id = request.headers.get("mcp-session-id")
      let session = id ? sessions.get(id) : undefined
      if (!session && !id && request.method === "POST") {
        const protocol = new Server({ name: "catalog control", version: "1.0.0" }, { capabilities: { tools: {} } })
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: false,
        })
        protocol.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [{ name: "probe", description: "controlled", inputSchema: { type: "object", properties: {} } }],
        }))
        await protocol.connect(transport)
        session = { protocol, transport }
        const response = await transport.handleRequest(request)
        sessions.set(transport.sessionId!, session)
        return response
      }
      return session ? session.transport.handleRequest(request) : new Response("Unknown test session", { status: 404 })
    },
  })
  closers.push(async () => {
    await Promise.all([...sessions.values()].map(({ protocol }) => protocol.close()))
    await http.stop(true)
  })
  return { type: "remote" as const, url: `http://127.0.0.1:${http.port}/mcp`, oauth: false as const }
}

async function project(name: string, config: Record<string, unknown> = {}) {
  const directory = path.join(home, name)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, "dax.json"), JSON.stringify(config))
  return directory
}

async function globalTool(alias: string) {
  const folder = path.join(home, ".config", "dax", "tool")
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(
    path.join(folder, `${alias}.js`),
    `export default { description: "catalog probe", args: {}, async execute() { return "reply" } }`,
  )
}

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-capability-catalog-"))
  process.env.DAX_TEST_HOME = home
  closers = []
  await fs.mkdir(path.join(home, ".config", "dax"), { recursive: true })
  await Instance.disposeAll()
  Config.global.reset()
})

afterEach(async () => {
  await Instance.disposeAll()
  await Promise.all(closers.map((close) => close()))
  Config.global.reset()
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
})

const ids = (vocabulary: { list(): readonly CapabilityDescriptor[] }, prefix: string) =>
  vocabulary
    .list()
    .map((item) => item.id)
    .filter((id) => id.startsWith(prefix))

describe("composed capability catalog", () => {
  test("the static vocabulary is exactly the declared DAX-dispatched population", () => {
    const vocabulary = CapabilityCatalog.staticVocabulary()
    expect(vocabulary.families()).toEqual([
      { name: "native_tool", namespace: "native.tool.", enumeration: "listed" },
      { name: "operator", namespace: "operator.", enumeration: "listed" },
      { name: "workflow", namespace: "workflow.", enumeration: "listed" },
      { name: "worker", namespace: "worker.profile.", enumeration: "listed" },
      { name: "command_shell", namespace: "session.command.", enumeration: "listed" },
      { name: "operator_shell", namespace: "session.shell.", enumeration: "listed" },
      { name: "context_attachment", namespace: "session.context.attachment.", enumeration: "listed" },
      { name: "template_context", namespace: "session.context.template.", enumeration: "listed" },
      { name: "verification_command", namespace: "verification.command.", enumeration: "listed" },
      { name: "mcp_resource", namespace: "mcp.resource.v1.", enumeration: "on_demand" },
      { name: "mcp_prompt", namespace: "mcp.prompt.v1.", enumeration: "on_demand" },
      { name: "plugin_tool", namespace: "plugin.tool.v1.", enumeration: "listed" },
      { name: "mcp_tool", namespace: "mcp.tool.v1.", enumeration: "listed" },
    ])
    const counts = Object.fromEntries(
      vocabulary.families().map((family) => [family.name, ids(vocabulary, family.namespace).length]),
    )
    expect(counts).toEqual({
      native_tool: 22,
      operator: 9,
      workflow: 6,
      worker: 4,
      command_shell: 1,
      operator_shell: 1,
      context_attachment: 4,
      template_context: 1,
      verification_command: 2,
      mcp_resource: 0,
      mcp_prompt: 0,
      plugin_tool: 0,
      mcp_tool: 0,
    })
    expect(vocabulary.list()).toHaveLength(50)
    expect(new Set(vocabulary.list().map((item) => item.id)).size).toBe(50)
    for (const descriptor of vocabulary.list()) {
      expect(CapabilityDescriptor.safeParse(descriptor).success).toBe(true)
      expect(vocabulary.familyOf(descriptor.id)).toBeDefined()
    }
    // The vocabulary offers lookup only: nothing on it answers whether a run may act.
    expect(Object.keys(vocabulary).sort()).toEqual(["covers", "families", "familyOf", "list", "require"])
  })

  test("an instance snapshot lists real loader and MCP tools and never the legacy registration", async () => {
    await globalTool("probe")
    const directory = await project("alpha", { mcp: { remote: await mcpServer() } })
    await Instance.provide({
      directory,
      async fn() {
        // No discovery has run for this instance yet, and a snapshot performs none.
        expect((await CapabilityCatalog.snapshot()).list()).toHaveLength(50)

        await ToolRegistry.register(
          Tool.define("legacy", {
            description: "Legacy custom",
            parameters: z.object({}),
            result: Tool.Result,
            async execute() {
              return { title: "legacy", output: "legacy", metadata: {} }
            },
          }),
        )
        const tools = await ToolRegistry.tools(toolModel)
        const mcpTools = await MCP.tools()
        const vocabulary = await CapabilityCatalog.snapshot()

        const loader = ToolRegistry.executionIdentity(tools.find((tool) => tool.id === "probe")!).capability!
        expect(ids(vocabulary, "plugin.tool.v1.")).toEqual([loader.id])
        expect(vocabulary.require(loader.id)).toEqual(loader)
        const remote = MCP.executionIdentity(mcpTools["remote_probe"]).capability
        expect(ids(vocabulary, "mcp.tool.v1.")).toEqual([remote.id])
        expect(vocabulary.familyOf(remote.id)).toBe("mcp_tool")
        expect(vocabulary.list()).toHaveLength(52)

        // Every offered native executor resolves inside the same vocabulary.
        for (const tool of tools) {
          const identity = ToolRegistry.executionIdentity(tool)
          if (identity.kind === "builtin") expect(vocabulary.require(identity.capability!.id)).toBeDefined()
        }
        // Legacy registration stays dispatchable and stays outside the vocabulary.
        const legacy = ToolRegistry.executionIdentity(tools.find((tool) => tool.id === "legacy")!)
        expect(legacy.capability).toBeUndefined()
      },
    })
  })

  test("invalidation leaves the next snapshot, and healthy rediscovery restores the same identity", async () => {
    await globalTool("probe")
    const directory = await project("alpha", { mcp: { remote: await mcpServer() } })
    await Instance.provide({
      directory,
      async fn() {
        await ToolRegistry.tools(toolModel)
        await MCP.tools()
        const before = await CapabilityCatalog.snapshot()
        const [loader] = ids(before, "plugin.tool.v1.")
        const [remote] = ids(before, "mcp.tool.v1.")

        await MCP.disconnect("remote")
        ToolRegistry.state().catalog.changed("probe")
        const invalidated = await CapabilityCatalog.snapshot()
        expect(ids(invalidated, "plugin.tool.v1.")).toEqual([])
        expect(ids(invalidated, "mcp.tool.v1.")).toEqual([])
        expect(invalidated.list()).toHaveLength(50)
        // An earlier snapshot is a value: it is not rewritten by later invalidation.
        expect(before.covers(loader)).toBe(true)

        await MCP.connect("remote")
        await ToolRegistry.tools(toolModel)
        await MCP.tools()
        const restored = await CapabilityCatalog.snapshot()
        expect(ids(restored, "plugin.tool.v1.")).toEqual([loader])
        expect(ids(restored, "mcp.tool.v1.")).toEqual([remote])
      },
    })
  })

  test("snapshots are instance-scoped, and disposal removes an instance's dynamic entries", async () => {
    const alpha = await project("alpha", { mcp: { remote: await mcpServer() } })
    const beta = await project("beta")
    let remote = ""
    await Instance.provide({
      directory: alpha,
      async fn() {
        await MCP.tools()
        ;[remote] = ids(await CapabilityCatalog.snapshot(), "mcp.tool.v1.")
        expect(remote).toMatch(/^mcp\.tool\.v1\.m[0-9a-f]{64}$/)
      },
    })
    await Instance.provide({
      directory: beta,
      async fn() {
        await MCP.tools()
        const vocabulary = await CapabilityCatalog.snapshot()
        expect(vocabulary.covers(remote)).toBe(false)
        expect(ids(vocabulary, "mcp.tool.v1.")).toEqual([])
      },
    })
    await Instance.provide({
      directory: alpha,
      async fn() {
        expect(ids(await CapabilityCatalog.snapshot(), "mcp.tool.v1.")).toEqual([remote])
      },
    })
    await Instance.disposeAll()
    await Instance.provide({
      directory: alpha,
      async fn() {
        // A fresh instance owns a fresh catalog; nothing is inherited from the disposed one.
        expect(ToolRegistry.capabilities()).toEqual([])
        expect(ids(await CapabilityCatalog.snapshot(), "mcp.tool.v1.")).toEqual([])
      },
    })
  })
})
