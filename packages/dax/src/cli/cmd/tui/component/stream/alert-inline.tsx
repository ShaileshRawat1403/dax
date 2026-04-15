import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { RenderableStreamItem } from "@/dax/presentation/session-stream"
import type { RunNarrativeItem } from "@/server/run-contract"

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
}

function getAlertTypeLabel(type: string): string {
  if (type === "intervention.required") return "INTERVENTION REQUIRED"
  if (type === "approval.requested") return "APPROVAL REQUIRED"
  if (type === "intervention.resolved") return "Resolved"
  if (type === "approval.resolved") return "Approved"
  return "ALERT"
}

function getRiskLabel(metadata?: Record<string, any>): string {
  if (!metadata) return ""
  const risk = metadata.risk
  if (risk) return `${risk.toUpperCase()} RISK`
  return ""
}

function getResolutionReason(metadata?: Record<string, any>): string {
  if (!metadata) return ""
  return metadata.reason || metadata.message || metadata.comment || ""
}

export function AlertInline(props: {
  item: RenderableStreamItem
  onNavigateToApprovals?: () => void
}) {
  const narrativeItem = props.item.data as RunNarrativeItem
  const typeLabel = () => getAlertTypeLabel(props.item.type ?? "")
  const riskLabel = () => getRiskLabel(narrativeItem?.metadata)
  const resolutionReason = () => getResolutionReason(narrativeItem?.metadata)
  const isPending = () => props.item.status === "pending"
  const isResolved = () => props.item.type === "approval.resolved" || props.item.type === "intervention.resolved"
  const isActionable = () =>
    props.item.type === "approval.requested" || props.item.type === "intervention.required"

  const borderColor = () => {
    if (isResolved()) return "$success"
    if (isPending()) return "$warning"
    return "$borderSubtle"
  }

  // Resolved state: compact single-line acknowledgement, no extra chrome
  if (isResolved()) {
    return (
      <box
        flexDirection="row"
        gap={1}
        alignItems="center"
        paddingLeft={2}
        paddingTop={0}
        paddingBottom={0}
        marginTop={0}
      >
        <text fg="$success">✓</text>
        <text fg="$success">{typeLabel()}</text>
        <Show when={resolutionReason()}>
          <text fg="$textMuted" dim>— {resolutionReason()}</text>
        </Show>
        <Show when={!resolutionReason() && props.item.message}>
          <text fg="$textMuted" dim>— {stripInlineMarkdown(props.item.message!)}</text>
        </Show>
      </box>
    )
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
        <text fg="$warning" attributes={TextAttributes.BOLD}>⚠</text>
        <text fg="$warning" attributes={TextAttributes.BOLD}>
          {typeLabel()}
        </text>
        <Show when={riskLabel()}>
          <text fg="$warning" attributes={TextAttributes.DIM}>
            ({riskLabel()})
          </text>
        </Show>
      </box>

      {/* Message */}
      <Show when={props.item.message}>
        <box paddingLeft={2} paddingTop={0}>
          <text fg="$text" wrapMode="word">
            {stripInlineMarkdown(props.item.message!)}
          </text>
        </box>
      </Show>

      {/* CTA for actionable alerts */}
      <Show when={isActionable()}>
        <box paddingLeft={2} paddingTop={1}>
          <box flexDirection="row" gap={1}>
            <text fg="$warning">→</text>
            <text fg="$textMuted">Open review queue to respond</text>
          </box>
        </box>
      </Show>
    </box>
  )
}
