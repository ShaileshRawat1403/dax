import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RunPhase, formatDuration } from "@/dax/presentation/session-stream"

const PHASE_ICONS: Record<string, string> = {
  thinking: "◎",
  exploring: "◈",
  planning: "◇",
  executing: "◉",
  verifying: "✦",
  done: "✓",
}

function phaseIcon(phase: RunPhase | string, status: string): string {
  if (status === "completed") return "✓"
  if (status === "failed") return "✗"
  if (status === "active") return PHASE_ICONS[phase] ?? "●"
  return "○"
}

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

  const icon = () => phaseIcon(props.phase, props.status)

  const summary = () => {
    const parts: string[] = []
    if (props.stepCount && props.stepCount > 0) {
      parts.push(`${props.stepCount} step${props.stepCount === 1 ? "" : "s"}`)
    }
    const dur = props.durationMs ? formatDuration(props.durationMs) : ""
    if (dur) parts.push(dur)
    return parts.length > 0 ? parts.join("  ·  ") : ""
  }

  const expandIcon = () => (props.expanded ? "▾" : "▸")

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
      {/* Status indicator */}
      <text fg={statusColor()} attributes={props.status === "active" ? TextAttributes.BOLD : undefined}>
        {icon()}
      </text>

      {/* Toggle arrow */}
      <text fg="$textMuted" attributes={TextAttributes.DIM}>
        {expandIcon()}
      </text>

      {/* Phase label */}
      <text
        fg={statusColor()}
        attributes={props.status === "active" ? TextAttributes.BOLD : undefined}
        wrapMode="none"
      >
        {props.label.toUpperCase()}
      </text>

      {/* Summary metadata */}
      <Show when={summary()}>
        <text fg="$textMuted" attributes={TextAttributes.DIM}>
          ·  {summary()}
        </text>
      </Show>
    </box>
  )
}
