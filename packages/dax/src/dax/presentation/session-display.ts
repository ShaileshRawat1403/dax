export const DISPLAY_MODES = ["operator", "inspect", "quiet"] as const

export type DisplayMode = (typeof DISPLAY_MODES)[number]
export type SidebarSection = "reflection" | "telemetry" | "runtime" | "todo" | "diff" | "audit" | "mcp" | "lsp"

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

export function resolveDisplayDetailToggles(input: {
  displayMode: DisplayMode
  showThinking: boolean
  showTimestamps: boolean
  showDetails: boolean
  showAssistantMetadata: boolean
}) {
  if (input.displayMode === "quiet") {
    return {
      showThinking: false,
      showTimestamps: false,
      showDetails: false,
      showAssistantMetadata: false,
    }
  }

  if (input.displayMode === "inspect") {
    return {
      showThinking: input.showThinking,
      showTimestamps: input.showTimestamps,
      showDetails: true,
      showAssistantMetadata: true,
    }
  }

  return {
    showThinking: input.showThinking,
    showTimestamps: input.showTimestamps,
    showDetails: input.showDetails,
    showAssistantMetadata: input.showAssistantMetadata,
  }
}

export function shouldShowSidebarSection(input: {
  displayMode: DisplayMode
  section: SidebarSection
}) {
  if (input.displayMode === "quiet") return false
  if (input.displayMode === "inspect") return true

  // Operator mode keeps runtime-critical sections visible and hides deep inspection-heavy sections.
  return input.section !== "reflection" && input.section !== "telemetry"
}

export function shouldShowWorkstationPane(input: {
  displayMode: DisplayMode
  paneVisibility: "auto" | "pinned" | "hidden"
  hasCriticalIntervention: boolean
  isRuntimeCritical: boolean
}) {
  if (input.displayMode === "quiet") {
    // Quiet mode stays minimal and only surfaces hard intervention checkpoints.
    return input.hasCriticalIntervention
  }
  if (input.paneVisibility === "hidden") {
    return input.hasCriticalIntervention || input.isRuntimeCritical
  }
  if (input.paneVisibility === "pinned") return true
  return true
}

export function hasMemoryContext(input: {
  reflectionPresent: boolean
  reflectionHistoryCount: number
  pmListCount: number
  pmRuleCount: number
}) {
  return input.reflectionPresent || input.reflectionHistoryCount > 0 || input.pmListCount > 0 || input.pmRuleCount > 0
}
