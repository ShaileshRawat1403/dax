import { afterEach, describe, expect, test } from "bun:test"
import net from "node:net"
import { startEgressProxy, type EgressProxyHandle } from "./egress-proxy"

/**
 * These tests exercise the real proxy against loopback TCP endpoints — no
 * external network. CONNECT tunneling is protocol-agnostic after the 200, so a
 * raw echo server stands in for a provider API: if bytes round-trip through the
 * tunnel, the tunnel works.
 */

const cleanups: Array<() => Promise<void> | void> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    await cleanup?.()
  }
})

/** A loopback TCP server that echoes whatever it receives. */
async function startEchoServer(): Promise<{ host: string; port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => {
    socket.on("error", () => socket.destroy())
    socket.pipe(socket)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("echo server did not bind")
  return {
    host: "127.0.0.1",
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/**
 * Perform a CONNECT handshake through the proxy. Resolves with the raw HTTP
 * status line the proxy returned and the connected socket (only meaningful when
 * the tunnel was established).
 */
function connectThroughProxy(
  proxyUrl: string,
  authority: string,
): Promise<{ statusLine: string; socket: net.Socket }> {
  const { hostname, port } = new URL(proxyUrl)
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), hostname, () => {
      socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`)
    })
    let buffer = ""
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("latin1")
      const headerEnd = buffer.indexOf("\r\n\r\n")
      if (headerEnd !== -1) {
        socket.off("data", onData)
        const statusLine = buffer.slice(0, buffer.indexOf("\r\n"))
        resolve({ statusLine, socket })
      }
    }
    socket.on("data", onData)
    socket.on("error", reject)
  })
}

async function startProxy(input: {
  allowHosts: string[]
  onDenied?: (host: string) => void
}): Promise<EgressProxyHandle> {
  const proxy = await startEgressProxy(input)
  cleanups.push(() => proxy.close())
  return proxy
}

describe("startEgressProxy CONNECT", () => {
  test("tunnels bytes to an allowed host and echoes them back", async () => {
    const echo = await startEchoServer()
    cleanups.push(() => echo.close())
    const proxy = await startProxy({ allowHosts: [echo.host] })

    const { statusLine, socket } = await connectThroughProxy(proxy.url, `${echo.host}:${echo.port}`)
    expect(statusLine).toContain("200")

    const roundTrip = await new Promise<string>((resolve, reject) => {
      socket.once("data", (chunk) => resolve(chunk.toString()))
      socket.once("error", reject)
      socket.write("ping")
    })
    socket.destroy()
    expect(roundTrip).toBe("ping")
    expect(proxy.deniedHosts()).toEqual([])
  })

  test("refuses CONNECT to a host outside the allowlist and records it", async () => {
    const echo = await startEchoServer()
    cleanups.push(() => echo.close())
    const denials: string[] = []
    const proxy = await startProxy({ allowHosts: ["api.anthropic.com"], onDenied: (h) => denials.push(h) })

    const { statusLine, socket } = await connectThroughProxy(proxy.url, `${echo.host}:${echo.port}`)
    socket.destroy()

    expect(statusLine).toContain("403")
    expect(proxy.deniedHosts()).toContain("127.0.0.1")
    expect(denials).toContain("127.0.0.1")
  })

  test("exposes proxy env and the active allowlist size", async () => {
    const proxy = await startProxy({ allowHosts: ["api.anthropic.com", "api.anthropic.com"] })
    expect(proxy.proxyEnv.HTTPS_PROXY).toBe(proxy.url)
    expect(proxy.proxyEnv.HTTP_PROXY).toBe(proxy.url)
    // duplicate collapses — the allowlist is a set
    expect(proxy.allowedHostCount()).toBe(1)
  })
})
