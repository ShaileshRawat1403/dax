import { compileWithRunId } from "@/execution/compiler"
import { ContractGuardian } from "@/execution/contract-guardian"
import { createEventAuthorityRun } from "@/state/events/event-transitions"
import { readRunEvents } from "@/state/events/run-event-store"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { CapabilityCatalog } from "@/capability/catalog"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { MCP } from "."
import {
  bindMcpPromptRead,
  bindMcpResourceRead,
  MCP_PROMPT_NAMESPACE,
  mcpReadDescriptor,
  requireMcpPromptRead,
} from "./resource-identity"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function observe<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  )
}

async function requireEntry(entered: Promise<void>, outcome: ReturnType<typeof observe>) {
  const phase = await Promise.race([entered.then(() => ({ status: "entered" as const })), outcome])
  if (phase.status !== "entered") {
    throw new Error("Prompt settled before entering the controlled server handler", {
      cause: phase.status === "rejected" ? phase.error : undefined,
    })
  }
}

async function server() {
  const requests: string[] = []
  let onGet: (() => Promise<void>) | undefined
  let fail = false
  const sessions = new Map<string, { protocol: Server; transport: WebStandardStreamableHTTPServerTransport }>()
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const id = request.headers.get("mcp-session-id")
      let session = id ? sessions.get(id) : undefined
      if (!session && !id && request.method === "POST") {
        const protocol = new Server(
          { name: "prompt identity control", version: "1.0.0" },
          { capabilities: { prompts: { listChanged: true }, tools: {} } },
        )
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: false,
        })
        protocol.setRequestHandler(ListPromptsRequestSchema, async () => ({
          prompts: [{ name: "probe", description: "controlled prompt" }],
        }))
        protocol.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))
        protocol.setRequestHandler(GetPromptRequestSchema, async ({ params }) => {
          requests.push(params.name)
          await onGet?.()
          if (fail) throw new Error("controlled server failure")
          return { messages: [{ role: "user", content: { type: "text", text: "controlled prompt text" } }] }
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
    config: { type: "remote" as const, url: `http://127.0.0.1:${http.port}/mcp`, oauth: false as const },
    requests,
    set onGet(handler: (() => Promise<void>) | undefined) {
      onGet = handler
    },
    set fail(value: boolean) {
      fail = value
    },
    async close() {
      await Promise.all([...sessions.values()].map(({ protocol }) => protocol.close()))
      await http.stop(true)
    },
  }
}

type Fixture = Awaited<ReturnType<typeof server>>
let home = ""
let directory = ""
let previousHome: string | undefined
let fixtures: Fixture[] = []

beforeEach(async () => {
  previousHome = process.env.DAX_TEST_HOME
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-mcp-prompt-identity-"))
  directory = path.join(home, "project")
  process.env.DAX_TEST_HOME = home
  fixtures = []
  await fs.mkdir(directory, { recursive: true })
  await Instance.disposeAll()
  Config.global.reset()
  // Project/storage initialization is fixture setup, not the in-flight identity
  // scenario. Windows CI has observed >5s here before any prompt dispatch.
  await Instance.provide({ directory, fn() {} })
}, 20_000)

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
    JSON.stringify({ mcp: Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, value.config])) }),
  )
}

async function rejection(promise: Promise<unknown>) {
  let rejected = false
  let reason: unknown
  try {
    await promise
  } catch (error) {
    rejected = true
    reason = error
  }
  if (!rejected) throw new Error("Expected MCP prompt rejection")
  return reason
}

/** A session with a stored contract and a canonical run journal. */
async function bornSession() {
  const session = await Session.create({ title: "MCP read record" })
  const { contract } = compileWithRunId({ request: { intent: { input: "Read a source." } } }, session.id)
  contract.toolAllowlist = []
  contract.toolBlocklist = []
  await ContractGuardian.create(session.id, contract)
  await createEventAuthorityRun(session.id, contract.contractId)
  return session
}

async function shadowsOf(runId: string) {
  return (await readRunEvents(runId))
    .filter((event) => event.type === "capability_resolution_recorded")
    .map((event) => event.payload as Record<string, unknown>)
}

describe("MCP prompt identity through real transport and command dispatch", () => {
  test("running an MCP prompt command records the prompt read before the fetch", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        const session = await bornSession()
        let recordedBeforeFetch = false
        alpha.onGet = async () => {
          // The server handler runs outside the instance context; enter it to read the journal.
          const recorded = await Instance.provide({ directory, fn: () => shadowsOf(session.id) })
          recordedBeforeFetch = recorded.some((item) => item.path === "mcp_prompt")
        }
        const command = Object.values(await Command.list()).find((item) => item.source === "mcp")!
        expect(command.mcp).toEqual({ server: "alpha", name: "probe" })
        await SessionPrompt.command({
          sessionID: session.id,
          command: command.name,
          arguments: "",
          model: "openai/does-not-exist",
        }).catch(() => undefined)
        expect(alpha.requests).toEqual(["probe"])
        expect(recordedBeforeFetch).toBe(true)
        expect((await shadowsOf(session.id)).filter((item) => item.path === "mcp_prompt")).toMatchObject([
          {
            enforcement: "record_only",
            initiator: "operator",
            capabilityId: mcpReadDescriptor("prompt", "alpha", "probe").id,
            enrolled: true,
            decision: "allow",
            reasonCode: "v1_contract_has_no_selector",
          },
        ])
      },
    })
  })

  test("the real command loader fetches a prompt through the bound client", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        const command = Object.values(await Command.list()).find((item) => item.source === "mcp")
        expect(command).toBeDefined()
        expect(await command!.template).toBe("controlled prompt text")
        expect(alpha.requests).toEqual(["probe"])
      },
    })
  })

  test("the descriptor is source-qualified, on-demand, and distinct from a resource read", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        const client = (await MCP.clients()).alpha
        const selected = { clientName: "alpha", name: "probe", client }
        const binding = bindMcpPromptRead({ ...selected, checkOwner() {} })
        const descriptor = requireMcpPromptRead({ binding, ...selected })
        expect(descriptor.id).toMatch(/^mcp\.prompt\.v1\.m[0-9a-f]{64}$/)
        expect(descriptor).toMatchObject({ riskClass: "low", scopeSupport: "opaque", requiresVerification: false })
        const other = bindMcpPromptRead({ ...selected, clientName: "beta", checkOwner() {} })
        expect(requireMcpPromptRead({ binding: other, ...selected, clientName: "beta" }).id).not.toBe(descriptor.id)

        const vocabulary = await CapabilityCatalog.snapshot()
        expect(vocabulary.familyOf(descriptor.id)).toBe("mcp_prompt")
        expect(vocabulary.covers(descriptor.id)).toBe(true)
        expect(vocabulary.families().find((family) => family.namespace === MCP_PROMPT_NAMESPACE)?.enumeration).toBe(
          "on_demand",
        )

        // A resource binding is not a prompt binding, and a forged object is neither.
        const resource = bindMcpResourceRead({ clientName: "alpha", uri: "probe", client, checkOwner() {} })
        expect(() => requireMcpPromptRead({ binding: resource, ...selected })).toThrow(CapabilityIdentityError)
        expect(() => requireMcpPromptRead({ binding: {}, ...selected })).toThrow(CapabilityIdentityError)
        expect(() => requireMcpPromptRead({ binding, ...selected, name: "other" })).toThrow(CapabilityIdentityError)
        expect(alpha.requests).toEqual([])
      },
    })
  })

  test("malformed source is rejected before the transport call", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        expect(await rejection(MCP.getPrompt("alpha", ""))).toBeInstanceOf(CapabilityIdentityError)
        expect(alpha.requests).toEqual([])
      },
    })
  })

  test("source disconnect invalidates an in-flight prompt without automatic retry", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.status()
        const entered = deferred()
        const release = deferred()
        alpha.onGet = async () => {
          entered.resolve()
          await release.promise
        }
        const outcome = observe(MCP.getPrompt("alpha", "probe"))
        let disconnect: ReturnType<typeof observe> | undefined
        try {
          await requireEntry(entered.promise, outcome)
          disconnect = observe(MCP.disconnect("alpha"))
          release.resolve()
          expect((await disconnect).status).toBe("fulfilled")
          const result = await outcome
          expect(result.status).toBe("rejected")
          if (result.status === "rejected") expect(result.error).toMatchObject({ code: "stale" })
          expect(alpha.requests).toEqual(["probe"])
        } finally {
          release.resolve()
          await outcome
          await disconnect
        }
      },
    })
  })

  test("replacing the selected SDK prompt method mid-flight rejects the old result", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        const client = (await MCP.clients()).alpha
        const entered = deferred()
        const release = deferred()
        alpha.onGet = async () => {
          entered.resolve()
          await release.promise
        }
        // Observe both outcomes immediately; even an early transport failure
        // must not become an unhandled rejection while awaiting the server gate.
        const outcome = observe(MCP.getPrompt("alpha", "probe"))
        const original = client.getPrompt
        try {
          await requireEntry(entered.promise, outcome)
          client.getPrompt = (async () => ({ messages: [] })) as typeof client.getPrompt
          release.resolve()
          const result = await outcome
          expect(result.status).toBe("rejected")
          if (result.status === "rejected") expect(result.error).toMatchObject({ code: "changed" })
          expect(alpha.requests).toEqual(["probe"])
        } finally {
          release.resolve()
          await outcome
          client.getPrompt = original
        }
      },
    })
  })

  test("disconnecting an unrelated source leaves the selected prompt healthy", async () => {
    const alpha = await fixture()
    const beta = await fixture()
    await configure({ alpha, beta })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.status()
        const entered = deferred()
        const release = deferred()
        alpha.onGet = async () => {
          entered.resolve()
          await release.promise
        }
        const outcome = observe(MCP.getPrompt("alpha", "probe"))
        let disconnect: ReturnType<typeof observe> | undefined
        try {
          await requireEntry(entered.promise, outcome)
          disconnect = observe(MCP.disconnect("beta"))
          expect((await disconnect).status).toBe("fulfilled")
          release.resolve()
          const result = await outcome
          expect(result.status).toBe("fulfilled")
          if (result.status === "rejected") throw result.error
          expect(result.value?.messages).toHaveLength(1)
          expect(beta.requests).toEqual([])
        } finally {
          release.resolve()
          await outcome
          await disconnect
        }
      },
    })
  })

  test("an ordinary server failure and an unknown client keep their existing undefined result", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        alpha.fail = true
        expect(await MCP.getPrompt("alpha", "probe")).toBeUndefined()
        expect(await MCP.getPrompt("missing", "probe")).toBeUndefined()
        expect(alpha.requests).toEqual(["probe"])
      },
    })
  })
})
