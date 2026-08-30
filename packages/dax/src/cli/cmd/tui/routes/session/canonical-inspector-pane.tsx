import { createEffect, createSignal, For, on, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import type { DisplayMode } from "@/dax/presentation/session-display"
import {
  acceptCanonicalInspectorRead,
  initialCanonicalInspectorState,
  rejectCanonicalInspectorRead,
} from "./canonical-inspector-state"
import { presentCanonicalInspector } from "./canonical-inspector-presentation"

/** Read-only canonical run inspector. It accepts no approval or execution callbacks. */
export function CanonicalInspectorPane(props: { runID: string; displayMode: DisplayMode; refreshKey?: unknown }) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const [state, setState] = createSignal(initialCanonicalInspectorState())
  let refreshEpoch = 0
  let lastRunID: string | undefined

  const refresh = async (runID: string, resetForRunChange: boolean) => {
    const epoch = ++refreshEpoch
    if (resetForRunChange) setState(initialCanonicalInspectorState())
    try {
      const url = new URL(`/runs/${encodeURIComponent(runID)}/inspector`, sdk.url)
      const response = await sdk.fetch(url)
      if (!response.ok) throw new Error(`Inspector request failed (${response.status})`)
      const next = acceptCanonicalInspectorRead(await response.json())
      if (next.status === "unavailable") throw new Error(next.error)
      if (epoch === refreshEpoch) setState(() => next)
    } catch (error) {
      if (epoch === refreshEpoch) setState((previous) => rejectCanonicalInspectorRead(previous, error))
    }
  }

  createEffect(on([() => props.runID, () => props.refreshKey], ([runID]) => {
    const resetForRunChange = lastRunID !== runID
    lastRunID = runID
    void refresh(runID, resetForRunChange)
  }, { defer: false }))

  const sections = () => {
    const current = state()
    return current.status === "ready" || current.status === "stale"
      ? presentCanonicalInspector(current.snapshot, props.displayMode)
      : []
  }
  const error = () => {
    const current = state()
    return "error" in current ? current.error : ""
  }

  return (
    <box flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
      <Show when={state().status === "loading"}>
        <text fg={theme.textMuted}>Loading validated canonical inspector…</text>
      </Show>
      <Show when={state().status === "unavailable"}>
        <box flexDirection="column" gap={0} border={["left"]} borderColor={theme.error} paddingLeft={1}>
          <text fg={theme.error} attributes={TextAttributes.BOLD}>CANONICAL INSPECTOR UNAVAILABLE</text>
          <text fg={theme.textMuted} wrapMode="word">{error()}</text>
        </box>
      </Show>
      <Show when={state().status === "stale"}>
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
