export type ProductState = "connected" | "waiting" | "blocked" | "needs_approval" | "failed"

export function labelProductState(state: ProductState): string {
  switch (state) {
    case "connected":
      return "Connected"
    case "waiting":
      return "Waiting"
    case "blocked":
      return "Blocked"
    case "needs_approval":
      return "Needs Approval"
    case "failed":
      return "Failed"
  }
}

export function productStateIcon(state: ProductState): string {
  switch (state) {
    case "connected":
      return "●"
    case "waiting":
      return "○"
    case "blocked":
      return "◐"
    case "needs_approval":
      return "◑"
    case "failed":
      return "✕"
  }
}

export function aggregateProductState(states: ProductState[]): ProductState {
  if (states.includes("failed")) return "failed"
  if (states.includes("blocked")) return "blocked"
  if (states.includes("needs_approval")) return "needs_approval"
  if (states.includes("waiting")) return "waiting"
  return "connected"
}

export function nextActionForMcpStatus(
  name: string,
  status: { status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"; error?: string },
) {
  switch (status.status) {
    case "connected":
      return `Run \`dax mcp ping ${name}\` or inspect MCP in DAX to verify live capability.`
    case "disabled":
      return "Enable the server in config or open MCP setup before retrying."
    case "needs_auth":
      return `Run \`dax mcp auth ${name}\` and retry the connection.`
    case "needs_client_registration":
      return status.error || "Add the required MCP client registration details, then reconnect."
    case "failed":
      return status.error || "Retry the MCP server and inspect its startup logs."
  }
}

export function nextActionForErrorMessage(message?: string) {
  const text = (message ?? "").toLowerCase()
  if (!text) return "Retry once. If it fails again, adjust the request or inspect the failing tool."
  if (
    text.includes("rejected permission") ||
    text.includes("waiting for approval") ||
    text.includes("user dismissed") ||
    text.includes("specified a rule")
  ) {
    return "Open approvals and answer the blocked request."
  }
  if (
    text.includes("oauth") ||
    text.includes("auth") ||
    text.includes("api key") ||
    text.includes("token") ||
    text.includes("credential") ||
    text.includes("provider")
  ) {
    return "Reconnect the provider or run `dax doctor auth`."
  }
  if (text.includes("mcp") || text.includes("model context protocol")) {
    return "Inspect MCP status and reconnect the failing server."
  }
  if (text.includes("no model") || text.includes("not connected")) {
    return "Connect a provider first, then retry the task."
  }
  return "Retry once. If it fails again, adjust the request or inspect the failing tool."
}
