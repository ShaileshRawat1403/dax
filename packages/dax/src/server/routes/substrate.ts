import { Hono, type Context } from "hono"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import {
  createSubstrateServer,
  extractAuth,
  validateAuth,
  setActorContext,
  clearActorContext,
} from "../fastmcp-substrate"
import type { SubstrateSession } from "../fastmcp-substrate"
import { Flag } from "@/flag/flag"
import { getSecrets } from "@/secrets/secrets-loader"

const sessions = new Map<string, SubstrateSession>()
let substrateServer: ReturnType<typeof createSubstrateServer> | null = null

function getSubstrateServer() {
  if (!substrateServer) {
    substrateServer = createSubstrateServer()
  }
  return substrateServer
}

async function mcpRequestHandler(c: Context): Promise<Response> {
  if (!Flag.DAX_SUBSTRATE_ENABLED) {
    return c.json({ error: "DAX substrate is not enabled" }, 503)
  }

  const secrets = await getSecrets()
  const auth = await extractAuth(c.req.raw)
  if (!validateAuth(auth, secrets.substrateToken)) {
    return c.json({ error: "unauthorized" }, 401)
  }

  setActorContext(auth?.actor)
  try {
    const sessionId = c.req.header("mcp-session-id") ?? c.req.query("sessionId")
    const server = getSubstrateServer()

    if (sessionId && sessions.has(sessionId)) {
      const { transport } = sessions.get(sessionId)!
      const body = await c.req.json()
      const response = await transport.handleRequest(c.req.raw, { parsedBody: body })
      return new Response(response.body, { status: response.status, headers: response.headers })
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    })

    const newSessionId = transport.sessionId
    if (newSessionId) {
      sessions.set(newSessionId, { transport, serverId: "dax-substrate", actor: auth?.actor })
    }

    await server.connect(transport)

    const body = await c.req.json()
    const response = await transport.handleRequest(c.req.raw, { parsedBody: body })
    return new Response(response.body, { status: response.status, headers: response.headers })
  } finally {
    clearActorContext()
  }
}

export const SubstrateRoutes = new Hono()
  .get("/", async (c) => {
    if (!Flag.DAX_SUBSTRATE_ENABLED) {
      return c.json({ error: "DAX substrate is not enabled" }, 503)
    }

    const secrets = await getSecrets()
    const auth = await extractAuth(c.req.raw)
    if (!validateAuth(auth, secrets.substrateToken)) {
      return c.json({ error: "unauthorized" }, 401)
    }

    setActorContext(auth?.actor)
    try {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      })

      const sessionId = transport.sessionId
      if (sessionId) {
        sessions.set(sessionId, { transport, serverId: "dax-substrate", actor: auth?.actor })
      }

      const server = getSubstrateServer()
      await server.connect(transport)

      const response = await transport.handleRequest(c.req.raw)
      return new Response(response.body, { status: response.status, headers: response.headers })
    } finally {
      clearActorContext()
    }
  })
  .post("/", async (c) => {
    return mcpRequestHandler(c)
  })
  .delete("/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId")
    sessions.delete(sessionId)
    return c.json({ ok: true })
  })
  .get("/sessions", async (c) => {
    const secrets = await getSecrets()
    return c.json({
      sessions: [...sessions.keys()],
      count: sessions.size,
      enabled: Flag.DAX_SUBSTRATE_ENABLED,
      secretsSource: secrets.source,
    })
  })
