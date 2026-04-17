import { Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RunPhase, formatDuration } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"

export function PhaseRail(props: {
  phase: RunPhase
  label: string
  status: "pending" | "active" | "completed" | "failed"
  stepCount?: number
  durationMs?: number
}) {
  const { theme } = useTheme()

  const labelColor = createMemo(() => {
    switch (props.status) {
      case "active":
        return theme.primary
      case "completed":
        return theme.success
      case "failed":
        return theme.error
      case "pending":
      default:
        return theme.textMuted
    }
  })

  const summary = createMemo(() => {
    const parts: string[] = []
    if (props.stepCount && props.stepCount > 0) {
      parts.push(`${props.stepCount} step${props.stepCount === 1 ? "" : "s"}`)
    }
    const dur = props.durationMs ? formatDuration(props.durationMs) : ""
    if (dur) parts.push(dur)
    return parts.join(" · ")
  })

  return (
    <box
      flexDirection="row"
      gap={1}
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
      marginTop={1}
      marginBottom={0}
    >
      <text
        fg={labelColor()}
        attributes={props.status === "active" ? TextAttributes.BOLD : TextAttributes.DIM}
      >
        {props.label.toLowerCase()}
      </text>

      {/* Spacer pushes summary to the right */}
      <box flexGrow={1} />

      <Show when={summary()}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          {summary()}
        </text>
      </Show>
    </box>
  )
}
