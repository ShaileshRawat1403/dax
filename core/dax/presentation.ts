export const PANE_MODE = ["artifact", "diff", "rao", "pm"] as const;
export type PaneMode = (typeof PANE_MODE)[number];

export const PANE_VISIBILITY = ["auto", "pinned", "hidden"] as const;
export type PaneVisibility = (typeof PANE_VISIBILITY)[number];

export const PANE_FOLLOW_MODE = ["live", "smart"] as const;
export type PaneFollowMode = (typeof PANE_FOLLOW_MODE)[number];

export function paneLabel(mode: PaneMode, eli12: boolean): string {
  const labels = {
    artifact: "files",
    diff: "changes",
    rao: "insights",
    pm: "memory",
  };
  if (eli12) {
    return labels[mode];
  }
  return mode;
}

export function paneTitle(mode: PaneMode, eli12: boolean): string {
  return eli12 ? paneLabel(mode, true) : mode.toUpperCase();
}

export function insightsLabel(eli12: boolean): string {
  return eli12 ? "Insights" : "RAO";
}

export function memoryLabel(eli12: boolean): string {
  return eli12 ? "Memory" : "PM";
}
