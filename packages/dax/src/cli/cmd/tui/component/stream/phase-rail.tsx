import { Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RunPhase, formatDuration } from "@/dax/presentation/session-stream"
import { useTheme, tint } from "@tui/context/theme"

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
  hasExpandableContent?: boolean
}) {
  const { theme } = useTheme()

  const statusColor = createMemo(() => {
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

  const icon = () => phaseIcon(props.phase, props.status)

  const summary = () => {
    const parts: string[] = []
    if (props.stepCount && props.stepCount > 0) {
      parts.push(`${props.stepCount} step${props.stepCount === 1 ? "" : "s"}`)
    }
    const dur = props.durationMs ? formatDuration(props.durationMs) : ""
    if (dur) parts.push(dur)
    return parts.length > 0 ? parts.join(" · ") : ""
  }

  const expandIcon = () => (props.expanded ? "▾" : "▸")

  return (
    <box
      flexDirection="row"
      gap={1}
      alignItems="center"
      paddingTop={0.5}
      paddingBottom={0.5}
      paddingLeft={1}
      paddingRight={1}
      marginTop={1}
      marginBottom={0.5}
      backgroundColor={props.status === "active" ? tint(theme.background, theme.primary, 0.04) : "transparent"}
      borderStyle={props.status === "active" ? "round" : "none"}
      borderColor={props.status === "active" ? theme.borderActive : "transparent"}
      onMouseUp={props.onToggle}
    >
      {/* Connector segment above */}
      <box width={1} />

      {/* Status indicator */}
      <box width={2} alignItems="center">
        <text fg={statusColor()} attributes={props.status === "active" ? TextAttributes.BOLD : undefined}>
          {icon()}
        </text>
      </box>

      {/* Phase label */}
      <text
        fg={props.status === "active" ? theme.text : theme.textMuted}
        attributes={props.status === "active" ? TextAttributes.BOLD : undefined}
        wrapMode="none"
      >
        {props.label.toUpperCase()}
      </text>

      {/* Summary metadata */}
      <Show when={summary()}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          · {summary()}
        </text>
      </Show>

      <box flexGrow={1} />

      {/* Toggle arrow — only shown when there are events to expand */}
      <Show when={props.hasExpandableContent}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          {expandIcon()}
        </text>
      </Show>
    </box>
  )
}
