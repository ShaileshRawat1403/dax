import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RenderableStreamItem, stripInlineMarkdown } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"
import type { RunNarrativeItem } from "@/server/run-contract"
import { STREAM_INDENT } from "./layout"
import { decisionGlyph } from "@/dax/presentation/status-glyph"

type ResolutionDecision = "approve" | "deny" | "expired" | "cancelled" | "unknown"

function getResolutionDecision(metadata?: Record<string, any>): ResolutionDecision {
  if (!metadata) return "unknown"
  const decision = String(metadata.decision ?? metadata.status ?? "").toLowerCase()
  if (decision === "approve" || decision === "approved") return "approve"
  if (decision === "deny" || decision === "denied" || decision === "reject") return "deny"
  if (decision === "expired") return "expired"
  if (decision === "cancelled") return "cancelled"
  return "unknown"
}

function getAlertTypeLabel(type: string, decision: ResolutionDecision): string {
  if (type === "intervention.required") return "INTERVENTION REQUIRED"
  if (type === "approval.requested") return "APPROVAL REQUIRED"
  if (type === "intervention.resolved") return "Resolved"
  if (type === "approval.resolved") {
    if (decision === "approve") return "Approved"
    if (decision === "deny") return "Denied"
    if (decision === "expired") return "Expired"
    if (decision === "cancelled") return "Cancelled"
    return "Resolved"
  }
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
  isLast?: boolean
  reviewKeyHint?: string
}) {
  const { theme } = useTheme()
  const narrativeItem = props.item.data as RunNarrativeItem
  const decision = () => getResolutionDecision(narrativeItem?.metadata)
  const typeLabel = () => getAlertTypeLabel(props.item.type ?? "", decision())
  const riskLabel = () => getRiskLabel(narrativeItem?.metadata)
  const resolutionReason = () => getResolutionReason(narrativeItem?.metadata)
  const isPending = () => props.item.status === "pending"
  const isResolved = () => props.item.type === "approval.resolved" || props.item.type === "intervention.resolved"
  const isActionable = () =>
    props.item.type === "approval.requested" || props.item.type === "intervention.required"

  const baseTextColor = () => (props.isLast ? theme.text : theme.textMuted)

  const resolvedTone = () => {
    const d = decision()
    if (d === "approve") return theme.success
    if (d === "deny") return theme.error
    if (d === "expired" || d === "cancelled") return theme.warning
    return theme.textMuted
  }

  const resolvedGlyph = () => decisionGlyph(decision())

  const resolvedHeadline = () => {
    const d = decision()
    if (d === "approve") return "Approved · DAX is continuing"
    if (d === "deny") return "Denied · DAX stopped this action"
    if (d === "expired") return "Expired · No decision in time"
    if (d === "cancelled") return "Cancelled"
    return "Resolved"
  }

  const borderColor = () => {
    if (isResolved()) return resolvedTone()
    if (isPending()) return theme.warning
    return theme.borderSubtle
  }

  // Resolved state: compact single-line acknowledgement, no extra chrome.
  // The glyph + headline communicate the outcome (approve/deny/expired)
  // explicitly so the operator never has to infer from absence of activity.
  if (isResolved()) {
    return (
      <box
        flexDirection="row"
        gap={1}
        alignItems="center"
        paddingLeft={STREAM_INDENT.content}
        paddingTop={0}
        paddingBottom={0}
        marginTop={0}
      >
        <text fg={resolvedTone()}>{resolvedGlyph()}</text>
        <text fg={resolvedTone()} attributes={TextAttributes.BOLD}>
          {resolvedHeadline()}
        </text>
        <text fg={theme.textMuted}>· {typeLabel()}</text>
        <Show when={resolutionReason()}>
          <text fg={theme.textMuted}>— {resolutionReason()}</text>
        </Show>
        <Show when={!resolutionReason() && props.item.message}>
          <text fg={theme.textMuted}>— {stripInlineMarkdown(props.item.message!)}</text>
        </Show>
      </box>
    )
  }

  // DAX UI Interaction Contract v0.1 Section 5: transcript is narration only.
  // No controls live here. Approve/deny is in the Inspector. The keyboard
  // shortcut (default `r`) still routes to the approval pane.
  return (
    <box
      flexDirection="column"
      gap={0}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={STREAM_INDENT.content}
      paddingRight={STREAM_INDENT.content}
      marginTop={1}
    >
      {/* Header row */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={borderColor()} attributes={TextAttributes.BOLD}>⚠</text>
        <text fg={borderColor()} attributes={TextAttributes.BOLD}>
          {typeLabel()}
        </text>
        <Show when={riskLabel()}>
          <text fg={borderColor()}>
            ({riskLabel()})
          </text>
        </Show>
      </box>

      {/* Message and CTA */}
      <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={STREAM_INDENT.content} marginLeft={1} marginTop={0}>
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
            <text fg={theme.textMuted}>
              Open the review pane to respond
              {props.reviewKeyHint ? ` (press ${props.reviewKeyHint})` : ""}.
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}
