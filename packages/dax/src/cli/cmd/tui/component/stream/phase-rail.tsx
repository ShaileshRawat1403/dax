import type { RunPhase } from "@/dax/presentation/session-stream"

export function PhaseRail(props: {
  phase: RunPhase
  label: string
  status: "pending" | "active" | "completed" | "failed"
  expanded: boolean
  onToggle: () => void
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
    </box>
  )
}
