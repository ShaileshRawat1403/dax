import { Installation } from "@/installation"
import { Server } from "@/server/server"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { createDaxClient, type Event } from "@dax-ai/sdk/v2"
import type { BunWebSocketData } from "hono/bun"
import { Flag } from "@/flag/flag"

await Log.init({
  print: process.argv.includes("--print-logs"),
  dev: Installation.isLocal(),
  level: (() => {
    if (Installation.isLocal()) return "DEBUG"
    return "INFO"
  })(),
})

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: e instanceof Error ? e.message : e,
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: e instanceof Error ? e.message : e,
  })
})

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Bun.Server<BunWebSocketData> | undefined

const eventStream = {
  abort: undefined as AbortController | undefined,
}

const startEventStream = (directory: string) => {
  if (eventStream.abort) eventStream.abort.abort()
  const abort = new AbortController()
  eventStream.abort = abort
  const signal = abort.signal

  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const auth = getAuthorizationHeader()
    if (auth) request.headers.set("Authorization", auth)
    return Server.App().fetch(request)
  }) as typeof globalThis.fetch

  const sdk = createDaxClient({
    baseUrl: "http://dax.internal",
    directory,
    fetch: fetchFn,
    signal,
  })

  ;(async () => {
    while (!signal.aborted) {
      const events = await Promise.resolve(
        sdk.event.subscribe(
          {},
          {
            signal,
          },
        ),
      ).catch(() => undefined)

      if (!events) {
        await Bun.sleep(250)
        continue
      }

      for await (const event of events.stream) {
        Rpc.emit("event", event as Event)
      }

      if (!signal.aborted) {
        await Bun.sleep(250)
      }
    }
  })().catch((error) => {
    Log.Default.error("event stream error", {
      error: error instanceof Error ? error.message : error,
    })
  })
}

startEventStream(process.cwd())

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    const headers = { ...input.headers }
    const auth = getAuthorizationHeader()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.App().fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[]; allowUnauthenticated?: boolean }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await Instance.provide({
      directory: input.directory,
      init: InstanceBootstrap,
      fn: async () => {
        await upgrade().catch(() => {})
      },
    })
  },
  async reload() {
    Config.global.reset()
    await Instance.disposeAll()
  },
  async summary(input: { sessionID: string }) {
    return await Instance.provide({
      directory: process.cwd(),
      init: InstanceBootstrap,
      fn: async () => {
        const { Session } = await import("@/session")
        const session = await Session.get(input.sessionID)
        if (!session) return undefined

        const messages = await Session.messages({ sessionID: input.sessionID })
        const messageInfos = messages.map((m) => m.info)
        const { sessionTokenTotal, sessionCostTotal, formatUsd } = await import("@/dax/session-metrics")

        const tokens = sessionTokenTotal(messageInfos)
        const generatedTokens = messageInfos
          .filter((m) => m.role === "assistant")
          .reduce((sum, m) => sum + (m.tokens?.output ?? 0), 0)
        const cost = sessionCostTotal(messageInfos)
        const turnCount = messageInfos.filter((m) => m.role === "user").length

        // Collect files written/edited during the session from tool parts
        const FILE_WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"])
        const seenPaths = new Set<string>()
        const files_changed: string[] = []
        for (const msg of messages) {
          if (msg.info.role !== "assistant") continue
          for (const part of msg.parts) {
            if (part.type !== "tool") continue
            if (!FILE_WRITE_TOOLS.has(part.tool)) continue
            const filePath = (part.state as any).input?.file_path as string | undefined
            if (!filePath || seenPaths.has(filePath)) continue
            seenPaths.add(filePath)
            // Show relative path when possible
            const cwd = Instance.directory
            const rel = filePath.startsWith(cwd + "/") ? filePath.slice(cwd.length + 1) : filePath
            files_changed.push(rel)
          }
        }

        return {
          title: session.title,
          turnCount,
          tokenCount: tokens,
          generatedTokenCount: generatedTokens,
          costLabel: cost > 0 ? formatUsd(cost) : undefined,
          files_changed,
        }
      },
    })
  },
  async shutdown() {
    Log.Default.info("worker shutting down")
    if (eventStream.abort) eventStream.abort.abort()
    await Instance.disposeAll()
    if (server) server.stop(true)
  },
}

Rpc.listen(rpc)

function getAuthorizationHeader(): string | undefined {
  const password = Flag.DAX_SERVER_PASSWORD
  if (!password) return undefined
  const username = Flag.DAX_SERVER_USERNAME ?? "dax"
  return `Basic ${btoa(`${username}:${password}`)}`
}
