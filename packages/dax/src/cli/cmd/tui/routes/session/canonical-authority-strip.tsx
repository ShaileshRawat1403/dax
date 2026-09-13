import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import type { DisplayMode } from "@/dax/presentation/session-display"
import { useCanonicalInspectorSource } from "./canonical-inspector-source"
import { presentCanonicalAuthorityStrip } from "./canonical-authority-strip-presentation"

/** Compact persistent header truth. Its actions only change workstation focus. */
export function CanonicalAuthorityStrip(props: { displayMode: DisplayMode; onReviewDecision: () => void; onInspectTruth: () => void }) {
  const { theme } = useTheme()
  const source = useCanonicalInspectorSource()
  const view = () => presentCanonicalAuthorityStrip(source.state(), props.displayMode)
  const color = () => view().warning ? theme.warning : theme.primary

  return (
    <box flexDirection="column" gap={0} paddingTop={0.5}>
      {/* Row 1: Lifecycle and action triggers */}
      <box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <text fg={color()} attributes={TextAttributes.BOLD}>{view().lifecycle}</text>
        <Show when={view().pendingApprovals > 0}>
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>Action required: {view().pendingApprovals}</text>
          <box onMouseUp={props.onReviewDecision} border={['round']} borderColor={theme.borderSubtle} paddingLeft={1} paddingRight={1}>
            <text fg={theme.textMuted}>Review decision</text>
          </box>
        </Show>
        <Show when={view().inspect}>
          <box onMouseUp={props.onInspectTruth} border={['round']} borderColor={theme.borderSubtle} paddingLeft={1} paddingRight={1}>
            <text fg={theme.textMuted}>Inspect truth</text>
          </box>
        </Show>
      </box>
      {/* Row 2: Invocation goal / intent */}
      <Show when={view().intent}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted} wrapMode="word">Goal: {view().intent}</text>
        </box>
      </Show>
      {/* Row 3: Validated canonical authority log status */}
      <box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        <text fg={theme.textMuted} wrapMode="word">{view().authority}</text>
      </box>
      {/* Row 4: Inspect mode details */}
      <Show when={view().details}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted} wrapMode="word">{view().details}</text>
        </box>
      </Show>
    </box>
  )
}
