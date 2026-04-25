import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RenderableStreamItem, stripInlineMarkdown } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"
import type { RunNarrativeItem } from "@/server/run-contract"

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
  isLast?: boolean
  reviewKeyHint?: string
}) {
  const { theme } = useTheme()
  const narrativeItem = props.item.data as RunNarrativeItem
  const typeLabel = () => getAlertTypeLabel(props.item.type ?? "")
  const riskLabel = () => getRiskLabel(narrativeItem?.metadata)
  const resolutionReason = () => getResolutionReason(narrativeItem?.metadata)
  const isPending = () => props.item.status === "pending"
  const isResolved = () => props.item.type === "approval.resolved" || props.item.type === "intervention.resolved"
  const isActionable = () =>
    props.item.type === "approval.requested" || props.item.type === "intervention.required"

  const baseTextColor = () => (props.isLast ? theme.text : theme.textMuted)

  const borderColor = () => {
    if (isResolved()) return theme.success
    if (isPending()) return theme.warning
    return theme.borderSubtle
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
        <text fg={theme.success}>✓</text>
        <text fg={theme.success} attributes={TextAttributes.BOLD}>Approval received</text>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>· {typeLabel()}</text>
        <Show when={resolutionReason()}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>— {resolutionReason()}</text>
        </Show>
        <Show when={!resolutionReason() && props.item.message}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>— {stripInlineMarkdown(props.item.message!)}</text>
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
      onMouseUp={() => {
        if (isActionable() && props.onNavigateToApprovals) {
          props.onNavigateToApprovals()
        }
      }}
    >
      {/* Header row */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={borderColor()} attributes={TextAttributes.BOLD}>⚠</text>
        <text fg={borderColor()} attributes={TextAttributes.BOLD}>
          {typeLabel()}
        </text>
        <Show when={riskLabel()}>
          <text fg={borderColor()} attributes={TextAttributes.DIM}>
            ({riskLabel()})
          </text>
        </Show>
      </box>

      {/* Message and CTA */}
      <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={2} marginLeft={0.5} marginTop={0}>
        <Show when={props.item.message}>
          <box paddingLeft={0} paddingTop={0}>
            <text fg={baseTextColor()} wrapMode="word">
              {stripInlineMarkdown(props.item.message!)}
            </text>
          </box>
        </Show>

        <Show when={isActionable()}>
          <box flexDirection="row" gap={1} alignItems="center" paddingTop={0}>
            <text fg={theme.borderSubtle}>╰─</text>
            <text fg={theme.warning} attributes={TextAttributes.BOLD}>[ Review ]</text>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              {props.reviewKeyHint ? `${props.reviewKeyHint} or click` : "click"} to open review queue
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}
