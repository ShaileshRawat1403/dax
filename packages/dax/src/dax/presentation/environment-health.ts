// DAX UI Interaction Contract v0.1 — environment health producer.
// See docs/dax/ui-interaction-contract.md Section 8.
//
// Pure function. Maps raw provider/MCP/LSP signals to EnvironmentHealth so
// the Footer can be a dumb consumer. This module does NOT read from sync
// or any other store; callers pass the raw arrays/records in.
//
// v0.1 provider health is configuration-level only: any configured provider
// is treated as healthy. Runtime throttling and capacity belong to run
// state and are surfaced through Header (cooling_down, provider_delayed).

import { isMcpStatusAttention, isMcpStatusBlocked, type McpLikeStatus } from "@/dax/status"
import type { EnvironmentHealth, ServiceHealth } from "./ui-state-resolver"

export type LspLikeStatus = { status: "connected" | "error" | string }

export type EnvironmentHealthInput = {
  providers: ReadonlyArray<unknown>
  mcp: Readonly<Record<string, McpLikeStatus>>
  lsp: ReadonlyArray<LspLikeStatus>
}

function deriveProviderHealth(providers: ReadonlyArray<unknown>): ServiceHealth {
  // Configuration-level only. See module header.
  return providers.length > 0 ? "healthy" : "unavailable"
}

function deriveMcpHealth(mcp: Readonly<Record<string, McpLikeStatus>>): ServiceHealth {
  // Empty MCP record is healthy: MCP is optional.
  // Aggregation: any blocked (needs_auth / needs_client_registration) →
  // unavailable; otherwise any attention (failed) → degraded; else healthy.
  // Disabled servers are intentional and do not contribute to either bucket.
  const statuses = Object.values(mcp)
  if (statuses.length === 0) return "healthy"
  if (statuses.some(isMcpStatusBlocked)) return "unavailable"
  if (statuses.some(isMcpStatusAttention)) return "degraded"
  return "healthy"
}

function deriveLspHealth(lsp: ReadonlyArray<LspLikeStatus>): ServiceHealth {
  // Empty LSP list is healthy: LSP is optional.
  // Any error → degraded. LSP errors do not block the workspace.
  if (lsp.length === 0) return "healthy"
  if (lsp.some((entry) => entry.status === "error")) return "degraded"
  return "healthy"
}

export function deriveEnvironmentHealth(input: EnvironmentHealthInput): EnvironmentHealth {
  return {
    provider: deriveProviderHealth(input.providers),
    mcp: deriveMcpHealth(input.mcp),
    lsp: deriveLspHealth(input.lsp),
  }
}
