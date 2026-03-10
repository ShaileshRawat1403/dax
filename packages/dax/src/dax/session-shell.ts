import type { KeybindsConfig } from "@dax-ai/sdk/v2"

export const SESSION_SHELL_ROLES = {
  actionStrip: "Alerts",
  navigator: "Move through this session",
  reviewBar: "Operator controls",
  sidebar: "Operator overview",
} as const

export const SESSION_COMMAND_LABELS = {
  reviewApprovals: "Open approvals",
  reviewDiff: "Inspect evidence",
  inspectMcp: "Inspect MCP",
  reviewDocs: "Open audit",
  jumpTimeline: "Jump to transcript",
  jumpLastRequest: "Jump to request",
  jumpLive: "Jump live",
  previous: "Previous",
  next: "Next",
} as const

export const SESSION_COMMAND_BINDINGS: Record<
  "reviewApprovals" | "reviewDiff" | "inspectMcp" | "jumpTimeline" | "jumpLastRequest" | "previous" | "next",
  keyof KeybindsConfig
> = {
  reviewApprovals: "session_approvals",
  reviewDiff: "session_diff",
  inspectMcp: "session_mcp",
  jumpTimeline: "session_timeline",
  jumpLastRequest: "messages_last_user",
  previous: "messages_previous",
  next: "messages_next",
}
