export const PANE_MODE = ["audit", "approvals", "memory", "refine", "operator"] as const

export type PaneMode = (typeof PANE_MODE)[number]

export type OperatorTab = "instructions" | "controls" | "context" | "session" | "commands"

export const PANE_VISIBILITY = ["auto", "pinned", "hidden"] as const

export type PaneVisibility = (typeof PANE_VISIBILITY)[number]

export const PANE_FOLLOW_MODE = ["live", "smart"] as const

export type PaneFollowMode = (typeof PANE_FOLLOW_MODE)[number]

export function paneLabel(mode: PaneMode, eli12: boolean) {
  return {
    audit: "audit",
    approvals: "approvals",
    memory: "memory",
    refine: "refine",
    operator: "operator",
  }[mode]
}

export function paneCompactLabel(mode: PaneMode, eli12: boolean) {
  return {
    audit: "audit",
    approvals: "approve",
    memory: "memory",
    refine: "refine",
    operator: "operator",
  }[mode]
}

export function paneTitle(mode: PaneMode, eli12: boolean) {
  return paneLabel(mode, eli12)
}

export function insightsLabel(eli12: boolean) {
  return eli12 ? "Needs your decision" : "approvals"
}

export function memoryLabel(eli12: boolean) {
  return "memory"
}

export function paneContextLabel(mode: PaneMode): string {
  switch (mode) {
    case "approvals":
      return "Awaiting operator decision"
    case "audit":
      return "Trust, verification, and guard posture"
    case "memory":
      return "Durable operator context"
    case "refine":
      return "Refine prompt and execution profile"
    case "operator":
      return "Operator controls and session management"
    default:
      return ""
  }
}

export function deriveAutoPaneMode(input: {
  hasApprovals: boolean
  hasRefineDraft: boolean
  hasAuditAttention: boolean
  hasDiffContext: boolean
  hasLiveContext: boolean
  hasMemoryContext: boolean
  hasPlanContext: boolean
  liveStage?: "exploring" | "thinking" | "planning" | "executing" | "verifying" | "waiting" | "retrying" | "done"
  fallback: PaneMode
}): PaneMode {
  if (input.hasApprovals) return "approvals"
  if ((input.liveStage === "verifying" || input.liveStage === "done") && input.hasAuditAttention) return "audit"
  if (input.hasRefineDraft) return "refine"
  if (input.hasAuditAttention) return "audit"
  if (input.hasMemoryContext) return "memory"
  return input.fallback
}

export function deriveActivePaneMode(input: {
  hasApprovals: boolean
  hasRefineDraft: boolean
  hasAuditAttention: boolean
  hasDiffContext: boolean
  hasLiveContext: boolean
  hasMemoryContext: boolean
  hasPlanContext: boolean
  liveStage?: "exploring" | "thinking" | "planning" | "executing" | "verifying" | "waiting" | "retrying" | "done"
  fallback: PaneMode
  paneMode: PaneMode
  paneVisibility: PaneVisibility
  paneFollowMode: PaneFollowMode
  following: boolean
}): PaneMode {
  if (input.hasRefineDraft) return "refine"
  if (input.hasApprovals) return "approvals"
  if (input.paneVisibility === "pinned" && !input.following) return input.paneMode

  const autoMode = deriveAutoPaneMode({
    hasApprovals: input.hasApprovals,
    hasRefineDraft: input.hasRefineDraft,
    hasAuditAttention: input.hasAuditAttention,
    hasDiffContext: input.hasDiffContext,
    hasLiveContext: input.hasLiveContext,
    hasMemoryContext: input.hasMemoryContext,
    hasPlanContext: input.hasPlanContext,
    liveStage: input.liveStage,
    fallback: input.fallback,
  })

  if (input.paneFollowMode === "live") {
    return autoMode
  }

  if (input.paneFollowMode === "smart") {
    if (input.paneVisibility === "pinned" && input.following) {
      const currentMode = input.paneMode
      if (isModeStale(currentMode, autoMode, input.liveStage)) {
        return autoMode
      }
      return currentMode
    }
    return autoMode
  }

  return input.paneMode
}

function isModeStale(currentMode: PaneMode, recommendedMode: PaneMode, liveStage?: string): boolean {
  if (currentMode === recommendedMode) return false

  if (currentMode === "approvals" && recommendedMode !== "approvals") {
    return true
  }

  if (recommendedMode === "audit" && currentMode !== "audit" && (liveStage === "verifying" || liveStage === "done")) {
    return true
  }

  return false
}

export function getFollowModeLabel(mode: PaneFollowMode): string {
  switch (mode) {
    case "live":
      return "Live follow"
    case "smart":
      return "Smart follow"
    default:
      return "Manual"
  }
}

export function getFollowModeDescription(mode: PaneFollowMode): string {
  switch (mode) {
    case "live":
      return "Pane follows run stage automatically"
    case "smart":
      return "Pane switches only when context changes"
    default:
      return "Manual mode"
  }
}

export function shouldAutoShowPane(input: {
  wide: boolean
  hasApprovals: boolean
  hasRefineDraft: boolean
  hasAuditAttention: boolean
  hasDiffContext: boolean
  hasLiveContext: boolean
  hasMemoryContext: boolean
  hasPlanContext: boolean
}) {
  if (!input.wide) return false
  return (
    input.hasApprovals ||
    input.hasRefineDraft ||
    input.hasAuditAttention ||
    input.hasDiffContext ||
    input.hasLiveContext ||
    input.hasMemoryContext ||
    input.hasPlanContext
  )
}
