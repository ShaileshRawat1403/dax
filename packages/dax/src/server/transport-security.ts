import type { MiddlewareHandler } from "hono"

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

export const transportSecurity: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("host")
  // The in-process TUI RPC client uses this URL and does not send a Host header.
  const internal = header === undefined && new URL(c.req.url).hostname === "dax.internal"
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
