import type { ProductState } from "./status"

export type McpToolLike = {
  name: string
  description?: string
}

export type McpInspectLike = {
  name: string
  tools: McpToolLike[]
}

export type McpCapability = {
  server: string
  tool: string
  label: string
}

const MCP_TOOL_PRIORITY = ["repo_search", "read_file", "workspace_info", "self_check", "kernel_version"]

export function chooseMcpCapability(inspect?: McpInspectLike): McpCapability | undefined {
  if (!inspect || inspect.tools.length === 0) return undefined
  const selected =
    MCP_TOOL_PRIORITY.map((name) => inspect.tools.find((tool) => tool.name === name)).find(Boolean) ?? inspect.tools[0]
  if (!selected) return undefined
  const label =
    selected.name === "repo_search"
      ? "Best available first use: safe repo search."
      : selected.name === "read_file"
        ? "Best available first use: safe file reading."
        : selected.name === "workspace_info"
          ? "Best available first use: workspace overview."
          : selected.name === "self_check"
            ? "Best available first use: kernel health check."
            : selected.name === "kernel_version"
              ? "Best available first use: kernel version check."
              : selected.description || `Best available first use: ${selected.name}.`
  return {
    server: inspect.name,
    tool: selected.name,
    label,
  }
}

export function summarizeMcpReadiness(input: {
  configured: number
  failed: number
  blocked: number
  connected: number
  capability?: McpCapability
}): { state: ProductState; summary: string } {
  if (input.configured === 0) {
    return {
      state: "waiting",
      summary: "No MCP server configured. Optional, but useful for richer read-only workspace tooling.",
    }
  }
  if (input.failed > 0) {
    return {
      state: "failed",
      summary: `${input.failed} MCP server${input.failed === 1 ? "" : "s"} failed to start.`,
    }
  }
  if (input.blocked > 0) {
    return {
      state: "blocked",
      summary: `${input.blocked} MCP server${input.blocked === 1 ? "" : "s"} needs setup attention.`,
    }
  }
  if (input.connected > 0) {
    return {
      state: "connected",
      summary: input.capability
        ? `${input.connected} MCP server${input.connected === 1 ? "" : "s"} connected. ${input.capability.label}`
        : `${input.connected} MCP server${input.connected === 1 ? "" : "s"} connected and ready.`,
    }
  }
  return {
    state: "waiting",
    summary: "MCP is configured but not active yet.",
  }
}
