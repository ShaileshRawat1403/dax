import { Show } from "solid-js"
import { type RenderableStreamItem, formatDuration } from "@/dax/presentation/session-stream"

function getEventIcon(type: string, status: "pending" | "active" | "completed" | "failed"): string {
  if (status === "active") return "●"
  if (status === "completed") return "✓"
  if (status === "failed") return "✗"
  return "○"
}

function getEventColor(status: "pending" | "active" | "completed" | "failed"): string {
  switch (status) {
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

function getEventTypeLabel(type: string): string {
  const labels: Record<string, string> = {
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
  return labels[type] ?? type.split(".")[0] ?? "Event"
}

export function RunEventRow(props: { item: RenderableStreamItem }) {
  const icon = () => getEventIcon(props.item.type ?? "", props.item.status ?? "pending")
  const color = () => getEventColor(props.item.status ?? "pending")
  const typeLabel = () => getEventTypeLabel(props.item.type ?? "")
  const isFailed = () => props.item.status === "failed"
  const duration = () => props.item.durationMs ? formatDuration(props.item.durationMs) : ""

  return (
    <box
      flexDirection="row"
      gap={1}
      alignItems="flex-start"
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={2}
      paddingRight={2}
    >
      <text fg={color()}>{icon()}</text>
      <text fg="$textMuted" attributes="dim">
        {typeLabel()}:
      </text>
      <text fg={isFailed() ? "$error" : "$text"} wrapMode="word">
        {props.item.message}
      </text>
      <Show when={duration()}>
        <text fg="$textMuted" attributes="dim">
          ({duration()})
        </text>
      </Show>
    </box>
  )
}
