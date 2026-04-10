import { Show } from "solid-js"
import type { RenderableStreamItem } from "@/dax/presentation/session-stream"
import type { RunNarrativeItem } from "@/server/run-contract"

function getAlertTypeLabel(type: string): string {
  if (type === "intervention.required") return "INTERVENTION"
  if (type === "approval.requested") return "APPROVAL REQUIRED"
  if (type === "intervention.resolved") return "INTERVENTION RESOLVED"
  if (type === "approval.resolved") return "APPROVAL RESOLVED"
  return "ALERT"
}

function getRiskLabel(metadata?: Record<string, any>): string {
  if (!metadata) return ""
  const risk = metadata.risk
  if (risk) return `(${risk.toUpperCase()} RISK)`
  return ""
}

export function AlertInline(props: {
  item: RenderableStreamItem
  onNavigateToApprovals?: () => void
}) {
  const narrativeItem = props.item.data as RunNarrativeItem
  const typeLabel = () => getAlertTypeLabel(props.item.type ?? "")
  const riskLabel = () => getRiskLabel(narrativeItem?.metadata)
  const isPending = () => props.item.status === "pending"
  const isActionable = () =>
    props.item.type === "approval.requested" || props.item.type === "intervention.required"

  return (
    <box
      flexDirection="column"
      gap={0}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      marginTop={1}
      border={["left"]}
      borderColor={isActionable() ? "$warning" : isPending() ? "$warning" : "$success"}
      backgroundColor={isActionable() ? "$backgroundElement" : isPending() ? "$backgroundElement" : "transparent"}
      onMouseUp={() => {
        if (isActionable() && props.onNavigateToApprovals) {
          props.onNavigateToApprovals()
        }
      }}
    >
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={isPending() ? "$warning" : "$success"} attributes="bold">
          {isPending() ? "⚠" : "✓"}
        </text>
        <text fg={isPending() ? "$warning" : "$success"} attributes="bold">
          {typeLabel()}
        </text>
        <Show when={riskLabel()}>
          <text fg={isPending() ? "$warning" : "$success"}>{riskLabel()}</text>
        </Show>
      </box>
      <box paddingLeft={2} paddingTop={0}>
        <text fg="$text" wrapMode="word">
          {props.item.message}
        </text>
      </box>
      <Show when={isActionable()}>
        <box paddingLeft={2} paddingTop={1}>
          <text fg="$warning" attributes="bold">Click to open the review queue</text>
        </box>
      </Show>
    </box>
  )
}
