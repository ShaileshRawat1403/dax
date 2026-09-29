import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { MCP } from "."

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function server() {
  const requests: string[] = []
  let onRead: (() => Promise<void>) | undefined
  const sessions = new Map<string, { protocol: Server; transport: WebStandardStreamableHTTPServerTransport }>()
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const id = request.headers.get("mcp-session-id")
      let session = id ? sessions.get(id) : undefined
      if (!session && !id && request.method === "POST") {
        const protocol = new Server(
          { name: "resource identity control", version: "1.0.0" },
          { capabilities: { resources: { listChanged: true, subscribe: true }, tools: {} } },
        )
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: false,
        })
        protocol.setRequestHandler(ListResourcesRequestSchema, async () => ({
          resources: [{ name: "probe", uri: "control://resource/probe" }],
        }))
        protocol.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))
        protocol.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
          requests.push(params.uri)
          await onRead?.()
          return { contents: [{ uri: params.uri, mimeType: "text/plain", text: "controlled resource text" }] }
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
    set onRead(handler: (() => Promise<void>) | undefined) {
      onRead = handler
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
  home = await fs.mkdtemp(path.join(os.tmpdir(), "dax-mcp-resource-identity-"))
  directory = path.join(home, "project")
  process.env.DAX_TEST_HOME = home
  fixtures = []
  await fs.mkdir(directory, { recursive: true })
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
  if (!rejected) throw new Error("Expected MCP resource rejection")
  return reason
}

describe("MCP resource identity through real transport and prompt dispatch", () => {
  test("a user-selected resource reaches the real client and becomes prompt context", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        const session = await Session.create({ title: "MCP resource context" })
        const uri = "control://resource/probe"
        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          model: { providerID: "openai", modelID: "gpt-4o" },
          noReply: true,
          parts: [
            {
              type: "file",
              filename: "probe",
              mime: "text/plain",
              url: uri,
              source: { type: "resource", clientName: "alpha", uri, text: { value: "@probe", start: 0, end: 6 } },
            },
          ],
        })
        expect(alpha.requests).toEqual([uri])
        expect(message.parts.some((part) => part.type === "text" && part.text === "controlled resource text")).toBe(
          true,
        )
        expect((await Session.messages({ sessionID: session.id })).length).toBe(1)
      },
    })
  })

  test("malformed source is rejected before the transport call", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        expect(await rejection(MCP.readResource("alpha", ""))).toBeInstanceOf(CapabilityIdentityError)
        expect(alpha.requests).toEqual([])
      },
    })
  })

  test("source disconnect invalidates an in-flight result without automatic retry", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.status()
        const entered = deferred()
        const release = deferred()
        alpha.onRead = async () => {
          entered.resolve()
          await release.promise
        }
        const pending = MCP.readResource("alpha", "control://resource/probe")
        await entered.promise
        const disconnect = MCP.disconnect("alpha")
        expect((await MCP.status()).alpha?.status).toBe("disabled")
        release.resolve()
        await disconnect
        expect(await rejection(pending)).toBeInstanceOf(CapabilityIdentityError)
        expect(alpha.requests).toEqual(["control://resource/probe"])
      },
    })
  })

  test("prompt dispatch rejects stale resource content instead of persisting a failure-text substitute", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.status()
        const session = await Session.create({ title: "Stale MCP resource" })
        const entered = deferred()
        const release = deferred()
        alpha.onRead = async () => {
          entered.resolve()
          await release.promise
        }
        const uri = "control://resource/probe"
        const pending = SessionPrompt.prompt({
          sessionID: session.id,
          model: { providerID: "openai", modelID: "gpt-4o" },
          noReply: true,
          parts: [
            {
              type: "file",
              filename: "probe",
              mime: "text/plain",
              url: uri,
              source: { type: "resource", clientName: "alpha", uri, text: { value: "@probe", start: 0, end: 6 } },
            },
          ],
        })
        await entered.promise
        const disconnect = MCP.disconnect("alpha")
        expect((await MCP.status()).alpha?.status).toBe("disabled")
        release.resolve()
        await disconnect
        expect(await rejection(pending)).toBeInstanceOf(CapabilityIdentityError)
        expect(await Session.messages({ sessionID: session.id })).toEqual([])
        expect(alpha.requests).toEqual([uri])
      },
    })
  })

  test("disconnecting an unrelated source leaves the selected binding healthy", async () => {
    const alpha = await fixture()
    const beta = await fixture()
    await configure({ alpha, beta })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.status()
        const entered = deferred()
        const release = deferred()
        alpha.onRead = async () => {
          entered.resolve()
          await release.promise
        }
        const pending = MCP.readResource("alpha", "control://resource/probe")
        await entered.promise
        await MCP.disconnect("beta")
        release.resolve()
        const result = await pending
        expect(result?.contents[0]).toHaveProperty("text", "controlled resource text")
        expect(alpha.requests).toEqual(["control://resource/probe"])
        expect(beta.requests).toEqual([])
      },
    })
  })

  test("replacing the selected SDK read method mid-flight rejects the old result", async () => {
    const alpha = await fixture()
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        await MCP.status()
        const client = (await MCP.clients()).alpha
        const original = client.readResource
        const entered = deferred()
        const release = deferred()
        alpha.onRead = async () => {
          entered.resolve()
          await release.promise
        }
        const pending = MCP.readResource("alpha", "control://resource/probe")
        await entered.promise
        try {
          client.readResource = original.bind(client)
          release.resolve()
          expect(await rejection(pending)).toBeInstanceOf(CapabilityIdentityError)
          expect(alpha.requests).toEqual(["control://resource/probe"])
        } finally {
          client.readResource = original
          release.resolve()
        }
      },
    })
  })

  test("an ordinary server read failure retains the existing synthetic failure behavior", async () => {
    const alpha = await fixture()
    alpha.onRead = async () => {
      throw new Error("controlled server failure")
    }
    await configure({ alpha })
    await Instance.provide({
      directory,
      async fn() {
        const session = await Session.create({ title: "Failed MCP resource" })
        const uri = "control://resource/probe"
        const message = await SessionPrompt.prompt({
          sessionID: session.id,
          model: { providerID: "openai", modelID: "gpt-4o" },
          noReply: true,
          parts: [
            {
              type: "file",
              filename: "probe",
              mime: "text/plain",
              url: uri,
              source: { type: "resource", clientName: "alpha", uri, text: { value: "@probe", start: 0, end: 6 } },
            },
          ],
        })
        expect(alpha.requests).toEqual([uri])
        expect(
          message.parts.some((part) => part.type === "text" && part.text.includes("Failed to read MCP resource")),
        ).toBe(true)
      },
    })
  })
})
