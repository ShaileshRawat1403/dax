import http from "node:http"
import net from "node:net"
import { isEgressHostAllowed, normalizeEgressHost } from "./egress-allowlist"

/**
 * Forward proxy that confines a governed worker's egress to an allowlist
 * (C1 network confinement). It speaks two proxy protocols:
 *
 *   - CONNECT tunneling for HTTPS (the provider path). The worker asks to open
 *     a tunnel to host:port; the proxy opens it only if the host is allowed,
 *     then pipes bytes without inspecting the TLS stream.
 *   - Plain-HTTP forwarding, enforcing the same allowlist. Rare for provider
 *     traffic but HTTP_PROXY is injected too, so the hole is closed for
 *     cooperative clients rather than left open.
 *
 * It binds loopback on an ephemeral port and hands back the URL plus the proxy
 * env to inject. Enforcement is only as strong as the worker's willingness to
 * honor the proxy env: this is a cooperative control, not a kernel packet
 * filter. The worker_run receipt states that boundary; denied targets are
 * surfaced via deniedHosts() so a blocked exfiltration attempt becomes evidence
 * rather than a silent failure.
 */

export type EgressProxyHandle = {
  /** Loopback proxy URL, e.g. http://127.0.0.1:54321 */
  url: string
  /** Proxy env vars to merge into the worker's environment. */
  proxyEnv: Record<string, string>
  /** Distinct hosts whose egress was refused, sorted. Evidence for the run. */
  deniedHosts: () => string[]
  /** Number of hosts on the active allowlist (for the receipt). */
  allowedHostCount: () => number
  close: () => Promise<void>
}

const CONNECT_ESTABLISHED = "HTTP/1.1 200 Connection Established\r\n\r\n"
const CONNECT_FORBIDDEN =
  "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nX-DAX-Egress: denied\r\nConnection: close\r\n\r\n"

/** Split a CONNECT authority ("host:port", IPv6 bracketed) into host and port. */
function splitHostPort(target: string): { host: string; port: number } {
  if (target.startsWith("[")) {
    const end = target.indexOf("]")
    const host = end === -1 ? target.slice(1) : target.slice(1, end)
    const rest = end === -1 ? "" : target.slice(end + 1)
    const port = rest.startsWith(":") ? Number(rest.slice(1)) : NaN
    return { host, port: Number.isFinite(port) ? port : 443 }
  }
  const colon = target.lastIndexOf(":")
  if (colon === -1) return { host: target, port: 443 }
  const port = Number(target.slice(colon + 1))
  return { host: target.slice(0, colon), port: Number.isFinite(port) ? port : 443 }
}

export async function startEgressProxy(input: {
  allowHosts: readonly string[]
  onDenied?: (host: string) => void
}): Promise<EgressProxyHandle> {
  const allowlist = new Set<string>()
  for (const host of input.allowHosts) {
    const normalized = normalizeEgressHost(host)
    if (normalized) allowlist.add(normalized)
  }

  const denied = new Set<string>()
  const recordDenied = (target: string) => {
    const host = normalizeEgressHost(target) || target.trim()
    if (!host) return
    denied.add(host)
    input.onDenied?.(host)
  }

  const server = http.createServer((req, res) => {
    // Plain-HTTP forward path. Determine the target host from the absolute URL
    // (proxy request-target) and fall back to the Host header.
    const requestTarget = req.url ?? ""
    let upstream: URL | null = null
    try {
      upstream = new URL(requestTarget)
    } catch {
      // Not a valid absolute URL; upstream stays null and the request is refused below.
    }
    const hostForCheck = upstream?.host ?? req.headers.host ?? ""

    if (!isEgressHostAllowed(hostForCheck, allowlist)) {
      recordDenied(hostForCheck || requestTarget)
      res.writeHead(403, { "X-DAX-Egress": "denied", Connection: "close" })
      res.end()
      return
    }
    if (!upstream) {
      res.writeHead(400, { Connection: "close" })
      res.end()
      return
    }

    const proxyReq = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port || 80,
        path: `${upstream.pathname}${upstream.search}`,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
        proxyRes.pipe(res)
      },
    )
    proxyReq.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { Connection: "close" })
      res.end()
    })
    req.pipe(proxyReq)
  })

  server.on("connect", (req, clientSocket, head) => {
    const target = req.url ?? ""
    clientSocket.on("error", () => clientSocket.destroy())

    if (!isEgressHostAllowed(target, allowlist)) {
      recordDenied(target)
      clientSocket.end(CONNECT_FORBIDDEN)
      return
    }

    const { host, port } = splitHostPort(target)
    const upstream = net.connect(port, host, () => {
      clientSocket.write(CONNECT_ESTABLISHED)
      if (head && head.length > 0) upstream.write(head)
      upstream.pipe(clientSocket)
      clientSocket.pipe(upstream)
    })
    upstream.on("error", () => {
      clientSocket.destroy()
      upstream.destroy()
    })
  })

  // A malformed client must never crash the proxy and take the run with it.
  server.on("clientError", (_err, socket) => {
    socket.destroy()
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error("egress proxy failed to bind a loopback port")
  }
  const url = `http://127.0.0.1:${address.port}`

  return {
    url,
    proxyEnv: {
      HTTP_PROXY: url,
      HTTPS_PROXY: url,
      http_proxy: url,
      https_proxy: url,
      ALL_PROXY: url,
      all_proxy: url,
    },
    deniedHosts: () => [...denied].sort(),
    allowedHostCount: () => allowlist.size,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        // Drop idle keep-alive sockets so close() resolves promptly instead of
        // waiting on the OS timeout. Guarded: older runtimes lack it.
        server.closeAllConnections?.()
      }),
  }
}
