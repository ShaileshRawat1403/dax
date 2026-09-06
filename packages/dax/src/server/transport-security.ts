import type { Context, MiddlewareHandler } from "hono"
import { getSecrets } from "@/secrets/secrets-loader"

const loopbackHosts = ["localhost", "127.0.0.1", "[::1]"]
let hosts = new Set(loopbackHosts)
let origins = new Set<string>()

export function configureTransport(options: { hostname: string; ports: number[]; cors?: string[] }) {
  const hostname =
    options.hostname.includes(":") && !options.hostname.startsWith("[")
      ? `[${options.hostname}]`
      : options.hostname.toLowerCase()
  hosts = new Set([...loopbackHosts, hostname])
  origins = new Set(["tauri://localhost", "http://tauri.localhost", ...(options.cors ?? [])])
  origins.delete("null")
  for (const host of hosts) {
    for (const port of options.ports) origins.add(new URL(`http://${host}:${port}`).origin)
  }
}

configureTransport({ hostname: "127.0.0.1", ports: [4096] })

export function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === undefined || origins.has(origin)
}

/** The in-process TUI RPC client uses this URL and does not send a Host header. */
export function isInternalRequest(c: Context): boolean {
  return c.req.header("host") === undefined && new URL(c.req.url).hostname === "dax.internal"
}

/**
 * Some routes do not just return data - they write configuration that DAX later
 * executes. PATCH /global/config can install an MCP server whose `command` is
 * spawned on every subsequent start, and a project's `commands.start` runs on
 * the next worktree creation. Host and origin checks keep a web page out, but
 * any other process on the machine can still reach the loopback port, so these
 * routes additionally require that the caller be the operator: either the
 * in-process TUI, or an HTTP client that authenticated. When no server
 * credential is configured there is nothing to authenticate against, so the
 * write is refused rather than accepted from anyone.
 */
export const privilegedMutation: MiddlewareHandler = async (c, next) => {
  if (isInternalRequest(c)) return next()
  const secrets = await getSecrets()
  if (!secrets.serverPassword) {
    return c.json(
      {
        error:
          "Refusing a configuration write on an unauthenticated server. Set DAX_SERVER_PASSWORD, or make this change from the DAX interface.",
      },
      403,
    )
  }
  return next()
}

export const transportSecurity: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("host")
  const internal = isInternalRequest(c)
  if (!internal) {
    const authority = header ?? new URL(c.req.url).host
    try {
      const url = new URL(`http://${authority}`)
      if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || !hosts.has(url.hostname)) {
        return c.json({ error: "Forbidden host" }, 403)
      }
    } catch {
      return c.json({ error: "Forbidden host" }, 403)
    }
  }
  if (!isAllowedOrigin(c.req.header("origin"))) return c.json({ error: "Forbidden origin" }, 403)
  return next()
}
