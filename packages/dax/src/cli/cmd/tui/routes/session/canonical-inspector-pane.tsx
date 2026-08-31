import { For, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import type { DisplayMode } from "@/dax/presentation/session-display"
import { presentCanonicalInspector } from "./canonical-inspector-presentation"
import { useCanonicalInspectorSource } from "./canonical-inspector-source"

/** Read-only canonical run inspector. It accepts no approval or execution callbacks. */
export function CanonicalInspectorPane(props: { displayMode: DisplayMode }) {
  const { theme } = useTheme()
  const source = useCanonicalInspectorSource()

  const sections = () => {
    const current = source.state()
    return current.status === "ready" || current.status === "stale"
      ? presentCanonicalInspector(current.snapshot, props.displayMode)
      : []
  }
  const error = () => {
    const current = source.state()
    return "error" in current ? current.error : ""
  }

  return (
    <box flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
      <Show when={source.state().status === "loading"}>
        <text fg={theme.textMuted}>Loading validated canonical inspector…</text>
      </Show>
      <Show when={source.state().status === "unavailable"}>
        <box flexDirection="column" gap={0} border={["left"]} borderColor={theme.error} paddingLeft={1}>
          <text fg={theme.error} attributes={TextAttributes.BOLD}>CANONICAL INSPECTOR UNAVAILABLE</text>
          <text fg={theme.textMuted} wrapMode="word">{error()}</text>
        </box>
      </Show>
      <Show when={source.state().status === "stale"}>
        <box flexDirection="column" gap={0} border={["left"]} borderColor={theme.warning} paddingLeft={1}>
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>STALE — LAST VALIDATED CANONICAL SNAPSHOT</text>
          <text fg={theme.textMuted} wrapMode="word">Refresh failed: {error()}</text>
        </box>
      </Show>
      <For each={sections()}>
        {(section) => (
          <box flexDirection="column" gap={0} border={["top"]} borderColor={section.warning ? theme.warning : theme.borderSubtle} paddingTop={1}>
            <text fg={section.warning ? theme.warning : theme.primary} attributes={TextAttributes.BOLD}>{section.title}</text>
            <For each={section.lines}>
              {(line) => <text fg={theme.textMuted} wrapMode="word">{line}</text>}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
