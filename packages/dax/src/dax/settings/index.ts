export const DAX_SETTING = {
  explain_mode: "explain_mode",
  policy_profile: "policy_profile",
  eli12_summary_visibility: "eli12_summary_visibility",
  session_pane_visibility: "session_pane_visibility",
  session_pane_mode: "session_pane_mode",
  session_pane_follow_mode: "session_pane_follow_mode",
  session_stream_slow: "session_stream_slow",
  session_stream_speed: "session_stream_speed",
} as const

export type StreamSpeed = "slow" | "normal" | "fast"

export const STREAM_SPEED_CADENCE_MS: Record<StreamSpeed, number> = {
  slow: 60,
  normal: 30,
  fast: 12,
}

export function nextStreamSpeed(current: StreamSpeed): StreamSpeed {
  if (current === "slow") return "normal"
  if (current === "normal") return "fast"
  return "slow"
}
