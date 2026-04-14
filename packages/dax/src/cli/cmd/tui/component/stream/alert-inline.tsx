import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { RenderableStreamItem } from "@/dax/presentation/session-stream"
import type { RunNarrativeItem } from "@/server/run-contract"

function getAlertTypeLabel(type: string): string {
  if (type === "intervention.required") return "INTERVENTION REQUIRED"
  if (type === "approval.requested") return "APPROVAL REQUIRED"
  if (type === "intervention.resolved") return "RESOLVED"
  if (type === "approval.resolved") return "APPROVED"
  return "ALERT"
}

function getRiskLabel(metadata?: Record<string, any>): string {
  if (!metadata) return ""
  const risk = metadata.risk
  if (risk) return `${risk.toUpperCase()} RISK`
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
  const isResolved = () => props.item.type === "approval.resolved" || props.item.type === "intervention.resolved"
  const isActionable = () =>
    props.item.type === "approval.requested" || props.item.type === "intervention.required"

  const borderColor = () => {
    if (isResolved()) return "$success"
    if (isPending()) return "$warning"
    return "$borderSubtle"
  }

  const iconGlyph = () => {
    if (isResolved()) return "✓"
    if (isPending()) return "⚠"
    return "·"
  }

  const iconColor = () => {
    if (isResolved()) return "$success"
    if (isPending()) return "$warning"
    return "$textMuted"
  }

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
      borderColor={borderColor()}
      onMouseUp={() => {
        if (isActionable() && props.onNavigateToApprovals) {
          props.onNavigateToApprovals()
        }
      }}
    >
      {/* Header row */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={iconColor()} attributes={TextAttributes.BOLD}>
          {iconGlyph()}
        </text>
        <text fg={iconColor()} attributes={TextAttributes.BOLD}>
          {typeLabel()}
        </text>
        <Show when={riskLabel()}>
          <text fg={isPending() ? "$warning" : "$textMuted"} attributes={TextAttributes.DIM}>
            ({riskLabel()})
          </text>
        </Show>
      </box>

      {/* Message */}
      <Show when={props.item.message}>
        <box paddingLeft={2} paddingTop={0}>
          <text fg="$text" wrapMode="word">
            {props.item.message}
          </text>
        </box>
      </Show>

      {/* CTA for actionable alerts */}
      <Show when={isActionable()}>
        <box paddingLeft={2} paddingTop={1}>
          <box
            flexDirection="row"
            gap={1}
            paddingLeft={1}
            paddingRight={1}
            borderStyle="rounded"
            borderColor="$warning"
          >
            <text fg="$warning" attributes={TextAttributes.BOLD}>
              →
            </text>
            <text fg="$warning">Open review queue</text>
          </box>
        </box>
      </Show>
    </box>
  )
}
