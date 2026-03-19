export const PANE_MODE = ["diff", "audit", "approvals", "plan", "refine"] as const

export type PaneMode = (typeof PANE_MODE)[number]

export const PANE_VISIBILITY = ["auto", "pinned", "hidden"] as const

export type PaneVisibility = (typeof PANE_VISIBILITY)[number]

export const PANE_FOLLOW_MODE = ["live", "smart"] as const

export type PaneFollowMode = (typeof PANE_FOLLOW_MODE)[number]

export function paneLabel(mode: PaneMode, eli12: boolean) {
  return {
    diff: "changes",
    audit: "audit",
    approvals: "approvals",
    plan: "plan",
    refine: "refine",
  }[mode]
}

export function paneCompactLabel(mode: PaneMode, eli12: boolean) {
  return {
    diff: "change",
    audit: "audit",
    approvals: "approve",
    plan: "plan",
    refine: "refine",
  }[mode]
}

export function paneTitle(mode: PaneMode, eli12: boolean) {
  return paneLabel(mode, eli12)
}

export function insightsLabel(eli12: boolean) {
  return eli12 ? "Needs your decision" : "approvals"
}

export function memoryLabel(eli12: boolean) {
  return "plan"
}

export function deriveAutoPaneMode(input: {
  hasApprovals: boolean
  hasRefineDraft: boolean
  hasAuditAttention: boolean
  hasPlanContext: boolean
  fallback: PaneMode
}): PaneMode {
  if (input.hasApprovals) return "approvals"
  if (input.hasRefineDraft) return "refine"
  if (input.hasAuditAttention) return "audit"
  if (input.hasPlanContext) return "plan"
  return input.fallback
}

export function deriveActivePaneMode(input: {
  hasApprovals: boolean
  hasRefineDraft: boolean
  hasAuditAttention: boolean
  hasPlanContext: boolean
  fallback: PaneMode
  paneMode: PaneMode
  paneVisibility: PaneVisibility
  paneFollowMode: PaneFollowMode
  smartFollowActive: boolean
}): PaneMode {
  if (input.hasApprovals) return "approvals"
  if (input.paneVisibility === "pinned" && !input.smartFollowActive) return input.paneMode
  if (input.paneFollowMode === "live") {
    return deriveAutoPaneMode({
      hasApprovals: input.hasApprovals,
      hasRefineDraft: input.hasRefineDraft,
      hasAuditAttention: input.hasAuditAttention,
      hasPlanContext: input.hasPlanContext,
      fallback: input.fallback,
    })
  }
  return deriveAutoPaneMode({
    hasApprovals: input.hasApprovals,
    hasRefineDraft: input.hasRefineDraft,
    hasAuditAttention: input.hasAuditAttention,
    hasPlanContext: input.hasPlanContext,
    fallback: input.fallback,
  })
}

export function shouldAutoShowPane(input: {
  wide: boolean
  hasApprovals: boolean
  hasRefineDraft: boolean
  hasAuditAttention: boolean
  hasPlanContext: boolean
}) {
  if (!input.wide) return false
  return input.hasApprovals || input.hasRefineDraft || input.hasAuditAttention || input.hasPlanContext
}
