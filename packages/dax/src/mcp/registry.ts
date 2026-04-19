import { z } from "zod"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/timeout"

const log = Log.create({ service: "mcp-registry" })

export const MCPServerInfo = z.object({
  name: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  homepage: z.string().optional(),
  repository: z.string().optional(),
  packages: z
    .array(
      z.object({
        registryType: z.string(),
        identifier: z.string(),
        version: z.string().optional(),
      }),
    )
    .optional(),
  remotes: z
    .array(
      z.object({
        type: z.string(),
        url: z.string(),
      }),
    )
    .optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["active", "deprecated", "deleted"]).optional(),
})
export type MCPServerInfo = z.infer<typeof MCPServerInfo>

export const MCPServerListResponse = z.object({
  servers: z.array(MCPServerInfo),
  nextCursor: z.string().optional(),
  total: z.number().optional(),
})
export type MCPServerListResponse = z.infer<typeof MCPServerListResponse>

export namespace MCPRegistry {
  const BASE_URL = "https://registry.modelcontextprotocol.io"
  const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

  const cache = {
    servers: null as { data: MCPServerListResponse; timestamp: number } | null,
    searchResults: new Map<string, { data: MCPServerListResponse; timestamp: number }>(),
  }

  function isCacheValid<T>(entry: { data: T; timestamp: number } | null): boolean {
    if (!entry) return false
    return Date.now() - entry.timestamp < CACHE_TTL_MS
  }

  export async function listServers(options?: {
    limit?: number
    cursor?: string
    search?: string
    updatedSince?: string
    includeDeleted?: boolean
  }): Promise<MCPServerListResponse> {
    const cacheKey = JSON.stringify(options)

    if (!options?.search && cache.servers && isCacheValid(cache.servers)) {
      log.debug("Using cached server list")
      return cache.servers.data
    }

    if (options?.search) {
      const cached = cache.searchResults.get(cacheKey)
      if (cached && isCacheValid(cached)) {
        log.debug("Using cached search results", { query: options.search })
        return cached.data
      }
    }

    const params = new URLSearchParams()
    if (options?.limit) params.set("limit", String(options.limit))
    if (options?.cursor) params.set("cursor", options.cursor)
    if (options?.search) params.set("search", options.search)
    if (options?.updatedSince) params.set("updated_since", options.updatedSince)
    if (options?.includeDeleted) params.set("include_deleted", "true")

    const url = `${BASE_URL}/v0.1/servers?${params.toString()}`

    try {
      const response = await withTimeout(
        fetch(url, {
          headers: {
            Accept: "application/json",
          },
        }),
        15000,
      )

      if (!response.ok) {
        throw new Error(`MCP Registry error: ${response.status}`)
      }

      const data = await response.json()
      const parsed = MCPServerListResponse.parse(data)

      const result = { data: parsed, timestamp: Date.now() }

      if (!options?.search) {
        cache.servers = result
      } else {
        cache.searchResults.set(cacheKey, result)
      }

      return parsed
    } catch (error) {
      log.error("Failed to fetch MCP servers", { error })
      throw error
    }
  }

  export async function getServer(name: string): Promise<MCPServerInfo | null> {
    const encodedName = encodeURIComponent(name)
    const url = `${BASE_URL}/v0.1/servers/${encodedName}/versions/latest`

    try {
      const response = await withTimeout(fetch(url, { headers: { Accept: "application/json" } }), 10000)

      if (response.status === 404) {
        return null
      }

      if (!response.ok) {
        throw new Error(`MCP Registry error: ${response.status}`)
      }

      const data = await response.json()
      return MCPServerInfo.parse(data)
    } catch (error) {
      log.error("Failed to fetch MCP server", { name, error })
      return null
    }
  }

  export async function searchServers(query: string, limit: number = 20): Promise<MCPServerListResponse> {
    return listServers({ search: query, limit })
  }

  export async function getPopularServers(limit: number = 10): Promise<MCPServerListResponse> {
    return listServers({ limit })
  }

  export function clearCache(): void {
    cache.servers = null
    cache.searchResults.clear()
    log.info("MCP Registry cache cleared")
  }

  export async function getInstallCommand(server: MCPServerInfo): Promise<string | null> {
    const pkg = server.packages?.[0]

    if (!pkg) {
      if (server.remotes?.[0]) {
        const remote = server.remotes[0]
        return `Add to dax.json:\n\nmcp:\n  remotes:\n    ${server.name}:\n      url: "${remote.url}"`
      }
      return null
    }

    switch (pkg.registryType) {
      case "npm":
        return `npx -y ${pkg.identifier}`
      case "pip":
        return `pip install ${pkg.identifier}`
      case "go":
        return `go install ${pkg.identifier}`
      default:
        return `Install from: ${pkg.identifier}`
    }
  }
}
