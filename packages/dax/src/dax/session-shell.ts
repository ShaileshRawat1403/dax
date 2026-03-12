export const SESSION_COMMAND_LABELS = {
  reviewApprovals: "Open approvals",
  reviewDiff: "Inspect diff",
  reviewDocs: "Open audit",
  inspectMcp: "Inspect MCP",
  openPm: "Open PM",
  jumpTimeline: "Jump timeline",
  jumpLastRequest: "Jump request",
  jumpLive: "Jump live",
} as const

export const SESSION_SHELL_ROLES = {
  actionStrip: "Alerts",
  navigator: "Move through this session",
  reviewBar: "Operator controls",
  sidebar: "Operator overview",
} as const

export const SESSION_COMMAND_BINDINGS = {
  reviewApprovals: "<leader>p",
  reviewDiff: "<leader>d",
  inspectMcp: "<leader>k",
} as const
