/**
 * Determines if a system event should be rendered in the main Transcript view.
 * Use this filter in your message-list event subscriber to stop background
 * leaks (e.g., "token refreshed") from polluting the execution narrative.
 */
export function shouldRenderInTranscript(eventType: string): boolean {
  const NOISY_EVENTS = [
    "system.log",
    "system.info",
    "auth.token.refresh",
    "auth.token.expired",
    "plugin.load",
    "http.request",
  ]

  if (NOISY_EVENTS.some((noisy) => eventType.includes(noisy))) {
    return false
  }

  // If it's explicitly allowed, or if it's not a known noisy system event
  return !eventType.startsWith("system.")
}
