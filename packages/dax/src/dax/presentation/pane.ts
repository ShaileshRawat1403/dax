export const PANE_MODE = ["artifact", "diff", "rao", "pm"] as const

export type PaneMode = (typeof PANE_MODE)[number]

export const PANE_VISIBILITY = ["auto", "pinned", "hidden"] as const

export type PaneVisibility = (typeof PANE_VISIBILITY)[number]

export const PANE_FOLLOW_MODE = ["live", "smart"] as const

export type PaneFollowMode = (typeof PANE_FOLLOW_MODE)[number]

export function paneLabel(mode: PaneMode, eli12: boolean) {
  if (eli12) {
    return {
      artifact: "files",
      diff: "changes",
      rao: "insights",
      pm: "memory",
    }[mode]
  }

  return {
    artifact: "artifact",
    diff: "diff",
    rao: "rao",
    pm: "pm",
  }[mode]
}

export function paneTitle(mode: PaneMode, eli12: boolean) {
  if (eli12) return paneLabel(mode, true)
  return mode.toUpperCase()
}

export function insightsLabel(eli12: boolean) {
  return eli12 ? "Insights" : "RAO"
}

export function memoryLabel(eli12: boolean) {
  return eli12 ? "Memory" : "PM"
}
