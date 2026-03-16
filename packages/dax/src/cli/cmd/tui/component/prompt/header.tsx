import { useTheme } from "@tui/context/theme"
import { createMemo } from "solid-js"

export type HeaderProps = {
  sessionID?: string
  phase?: "Idle" | "Thinking" | "Executing" | "Blocked (Approval)" | "Verifying"
  trustPosture?: "Guarded" | "Elevated Risk" | "Verified"
}

export function WorkstationHeader(props: HeaderProps) {
  const { theme } = useTheme()

  const session = createMemo(() => (props.sessionID ? props.sessionID.slice(0, 8) : "local"))
  const phase = createMemo(() => props.phase || "Idle")
  const trust = createMemo(() => props.trustPosture || "Guarded")

  // Dynamic colors based on state
  const phaseColor = createMemo(() => {
    if (phase() === "Blocked (Approval)") return theme.warning
    if (phase() === "Executing" || phase() === "Thinking") return theme.primary
    if (phase() === "Verifying") return theme.success
    return theme.textMuted
  })

  const trustColor = createMemo(() => {
    if (trust() === "Elevated Risk") return theme.error
    if (trust() === "Verified") return theme.success
    return theme.secondary
  })

  return (
    <box
      flexDirection="row"
      border={["bottom"]}
      borderColor={phase() === "Blocked (Approval)" ? theme.warning : theme.border}
      paddingLeft={1}
      paddingRight={1}
      width="100%"
    >
      <text fg={theme.primary} bold>
        DAX ✦
      </text>
      <text fg={theme.textMuted}> │ Session: </text>
      <text fg={theme.text}>{session()}</text>

      <text fg={theme.textMuted}> │ Phase: </text>
      <text fg={phaseColor()}>{phase()}</text>

      <text fg={theme.textMuted}> │ Trust: </text>
      <text fg={trustColor()}>{trust()}</text>
    </box>
  )
}
