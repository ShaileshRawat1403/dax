export const DISPLAY_MODES = ["operator", "inspect", "quiet"] as const

export type DisplayMode = (typeof DISPLAY_MODES)[number]

export function nextDisplayMode(current: string): DisplayMode {
  const index = DISPLAY_MODES.indexOf(current as DisplayMode)
  return DISPLAY_MODES[(index + 1 + DISPLAY_MODES.length) % DISPLAY_MODES.length]!
}

export function resolveSessionSidebarVisibility(input: {
  hasParentSession: boolean
  sidebarOpen: boolean
  displayMode: DisplayMode
}) {
  if (input.hasParentSession) return false
  if (input.displayMode === "quiet") return false
  return input.sidebarOpen
}

export function shouldAutoOpenSidebar(displayMode: DisplayMode) {
  return displayMode === "inspect"
}

export function shouldShowInterventionQueue(input: {
  displayMode: DisplayMode
  queueVisible: boolean
}) {
  if (input.displayMode === "quiet") return false
  return input.queueVisible
}
