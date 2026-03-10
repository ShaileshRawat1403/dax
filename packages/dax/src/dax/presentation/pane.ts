export const PANE_MODE = ["artifact", "diff", "rao", "pm", "audit"] as const

export type PaneMode = (typeof PANE_MODE)[number]

export const PANE_VISIBILITY = ["auto", "pinned", "hidden"] as const

export type PaneVisibility = (typeof PANE_VISIBILITY)[number]

export const PANE_FOLLOW_MODE = ["live", "smart"] as const

export type PaneFollowMode = (typeof PANE_FOLLOW_MODE)[number]

export function paneLabel(mode: PaneMode, eli12: boolean) {
  if (eli12) {
    return {
      artifact: "artifacts",
      diff: "evidence",
      rao: "approvals",
      pm: "plan",
      audit: "audit",
    }[mode]
  }

  return {
    artifact: "artifacts",
    diff: "evidence",
    rao: "approvals",
    pm: "plan",
    audit: "audit",
  }[mode]
}

export function paneTitle(mode: PaneMode, eli12: boolean) {
  return paneLabel(mode, eli12)
}

export function insightsLabel(eli12: boolean) {
  return eli12 ? "Needs your decision" : "Approvals"
}

export function memoryLabel(eli12: boolean) {
  return "Plan"
}
