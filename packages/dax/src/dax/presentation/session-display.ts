export const DISPLAY_MODES = ["operator", "inspect", "quiet"] as const

export type DisplayMode = (typeof DISPLAY_MODES)[number]

export function nextDisplayMode(current: string): DisplayMode {
  const index = DISPLAY_MODES.indexOf(current as DisplayMode)
  return DISPLAY_MODES[(index + 1 + DISPLAY_MODES.length) % DISPLAY_MODES.length]!
}

export function shouldShowInterventionQueue(input: { displayMode: DisplayMode; queueVisible: boolean }) {
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

export function shouldShowWorkstationPane(input: {
  displayMode: DisplayMode
  paneVisibility: "auto" | "pinned" | "hidden"
  hasCriticalIntervention: boolean
  hasAuditNeed: boolean
  hasRefineNeed: boolean
}) {
  // Critical interventions (pending approvals) override visibility — always show
  if (input.hasCriticalIntervention) return true
  if (input.paneVisibility === "hidden") return false
  if (input.paneVisibility === "pinned") return true

  // Auto mode: secondary attention (audit, refine, memory) only auto-opens
  // in inspect mode. Operator mode stays calm by default — the pane opens
  // only for critical intervention (resolver-driven, see PR-5) or when the
  // user has explicitly pinned it. See Contract Section 6: audit findings,
  // diff review, and selected evidence are user-initiated, not auto-open.
  if (input.displayMode === "inspect") {
    return input.hasAuditNeed || input.hasRefineNeed
  }

  return false
}

export function hasMemoryContext(input: {
  reflectionPresent: boolean
  reflectionHistoryCount: number
  pmListCount: number
  pmRuleCount: number
}) {
  return input.reflectionPresent || input.reflectionHistoryCount > 0 || input.pmListCount > 0 || input.pmRuleCount > 0
}
