import type { RenderableStreamItem } from "@/dax/presentation/session-stream"
import type { RunNarrativeItem } from "@/server/run-contract"

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
  const narrativeItem = props.item.data as RunNarrativeItem
  const icon = () => getEventIcon(props.item.type ?? "", props.item.status ?? "pending")
  const color = () => getEventColor(props.item.status ?? "pending")
  const typeLabel = () => getEventTypeLabel(props.item.type ?? "")

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
      <text fg="$text" wrapMode="word">
        {props.item.message}
      </text>
    </box>
  )
}
