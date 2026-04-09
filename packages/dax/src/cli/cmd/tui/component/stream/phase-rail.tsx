import { Show } from "solid-js"
import { type RunPhase, formatDuration } from "@/dax/presentation/session-stream"

export function PhaseRail(props: {
  phase: RunPhase
  label: string
  status: "pending" | "active" | "completed" | "failed"
  expanded: boolean
  onToggle: () => void
  stepCount?: number
  durationMs?: number
}) {
  const statusColor = () => {
    switch (props.status) {
      case "active":
        return "$primary"
      case "completed":
        return "$success"
      case "failed":
        return "$error"
      case "pending":
      default:
        return "$textMuted"
    }
  }

  const expandIcon = () => (props.expanded ? "▼" : "▶")

  const summary = () => {
    const parts: string[] = []
    if (props.stepCount && props.stepCount > 0) {
      parts.push(`${props.stepCount} step${props.stepCount === 1 ? "" : "s"}`)
    }
    const dur = props.durationMs ? formatDuration(props.durationMs) : ""
    if (dur) parts.push(dur)
    return parts.length > 0 ? parts.join(" · ") : ""
  }

  return (
    <box
      flexDirection="row"
      gap={1}
      alignItems="center"
      paddingTop={1}
      paddingBottom={0}
      paddingLeft={1}
      paddingRight={1}
      marginTop={1}
      border={["top"]}
      borderColor="$borderSubtle"
      onMouseUp={props.onToggle}
    >
      <text fg={statusColor()}>{expandIcon()}</text>
      <text fg={statusColor()} attributes={props.status === "active" ? "bold" : undefined}>
        {props.label.toUpperCase()}
      </text>
      <Show when={summary()}>
        <text fg="$textMuted" attributes="dim">
          · {summary()}
        </text>
      </Show>
    </box>
  )
}
