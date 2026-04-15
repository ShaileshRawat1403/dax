import { Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RenderableStreamItem, formatDuration } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"

// Strip inline markdown markers so **bold**, *italic*, `code`, etc. don't
// render as raw asterisks/backticks in a plain <text> node.
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1") // bold+italic
    .replace(/\*\*(.+?)\*\*/g, "$1")      // bold
    .replace(/\*(.+?)\*/g, "$1")          // italic
    .replace(/__(.+?)__/g, "$1")          // bold (underscore)
    .replace(/_(.+?)_/g, "$1")            // italic (underscore)
    .replace(/`(.+?)`/g, "$1")            // inline code
    .replace(/~~(.+?)~~/g, "$1")          // strikethrough
}

function getEventIcon(status: "pending" | "active" | "completed" | "failed"): string {
  switch (status) {
    case "active":
      return "●"
    case "completed":
      return "✓"
    case "failed":
      return "✗"
    case "pending":
    default:
      return "○"
  }
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  "run.created": "Session",
  "run.started": "Workstation",
  "run.completed": "Goal",
  "run.failed": "Execution",
  "intent.created": "Target",
  "plan.compiled": "Strategy",
  "step.proposed": "Step",
  "step.started": "Executing",
  "step.completed": "Step",
  "step.failed": "Step",
  "approval.requested": "Gate",
  "approval.resolved": "Gate",
  "artifact.created": "Evidence",
  "audit.posture_updated": "Trust",
  "intervention.required": "Alert",
  "intervention.resolved": "Alert",
}

function getEventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? (type.split(".")[0] ?? "Event")
}

export function RunEventRow(props: { item: RenderableStreamItem }) {
  const { theme } = useTheme()
  const status = () => props.item.status ?? "pending"
  const icon = () => getEventIcon(status())
  
  const color = createMemo(() => {
    switch (status()) {
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

  const typeLabel = () => getEventTypeLabel(props.item.type ?? "")
  const isFailed = () => status() === "failed"
  const isActive = () => status() === "active"
  const duration = () => (props.item.durationMs ? formatDuration(props.item.durationMs) : "")

  return (
    <box
      flexDirection="row"
      gap={1}
      alignItems="flex-start"
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={1}
      paddingRight={2}
    >
      {/* Timeline connector */}
      <box width={2} alignItems="center">
        <text fg={theme.borderSubtle} dim>│</text>
      </box>

      {/* Status dot */}
      <text
        fg={color()}
        attributes={isActive() ? TextAttributes.BOLD : undefined}
      >
        {icon()}
      </text>

      {/* Type label */}
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
        {typeLabel()}:
      </text>

      {/* Message */}
      <text
        fg={isFailed() ? theme.error : theme.text}
        attributes={isActive() ? TextAttributes.BOLD : undefined}
        wrapMode="word"
      >
        {stripInlineMarkdown(props.item.message ?? "")}
      </text>

      {/* Duration */}
      <Show when={duration()}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          ({duration()})
        </text>
      </Show>
    </box>
  )
}

