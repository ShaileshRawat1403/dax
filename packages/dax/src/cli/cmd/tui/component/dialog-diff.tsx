import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import type { FileDiff } from "@dax-ai/sdk/v2"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"

export function DialogDiff(props: { diffs: FileDiff[]; onOpenPane?: () => void; explainMode?: boolean }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal(0)

  const summary = createMemo(() => ({
    files: props.diffs.length,
    additions: props.diffs.reduce((sum, item) => sum + item.additions, 0),
    deletions: props.diffs.reduce((sum, item) => sum + item.deletions, 0),
  }))

  function move(delta: number) {
    if (props.diffs.length === 0) return
    let next = selected() + delta
    if (next < 0) next = props.diffs.length - 1
    if (next >= props.diffs.length) next = 0
    setSelected(next)
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      move(-1)
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      move(1)
    }
    if (evt.name === "return") {
      evt.preventDefault()
      props.onOpenPane?.()
    }
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const current = createMemo(() => props.diffs[selected()])
  const title = createMemo(() => (props.explainMode ? "Evidence review" : "Evidence detail"))
  const footer = createMemo(() =>
    props.explainMode
      ? "Open the evidence pane to inspect the live file-by-file change summary."
      : "Open the evidence pane for the live change summary while you continue the session.",
  )
  const emptyState = createMemo(() =>
    props.explainMode ? "No tracked file changes yet for this work." : "No tracked file changes yet.",
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {title()}
        </text>
        <text fg={theme.textMuted}>up/down move • enter open diff pane • esc close</text>
      </box>

      <box flexDirection="row" gap={1} flexWrap="wrap">
        <text fg={theme.textMuted}>{summary().files} files</text>
        <text fg={theme.textMuted}>•</text>
        <text fg={theme.diffAdded}>+{summary().additions}</text>
        <text fg={theme.textMuted}>•</text>
        <text fg={theme.diffRemoved}>-{summary().deletions}</text>
      </box>

      <Show when={props.diffs.length > 0} fallback={<text fg={theme.textMuted}>{emptyState()}</text>}>
        <box flexDirection="row" gap={2} height={18}>
          <box width={30} flexDirection="column">
            <For each={props.diffs}>
              {(item, index) => (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={selected() === index() ? theme.primary : undefined}
                  onMouseUp={() => setSelected(index())}
                >
                  <text fg={selected() === index() ? theme.selectedListItemText : theme.text}>
                    {item.file}
                  </text>
                </box>
              )}
            </For>
          </box>

          <box width={46} flexDirection="column" gap={1}>
            <Show when={current()}>
              <text fg={theme.text}>
                <b>{current()!.file}</b>
              </text>
              <Show when={props.explainMode}>
                <text fg={theme.text}>
                  DAX updated this file during the session.
                </text>
              </Show>
              <text fg={theme.textMuted}>Status: {current()!.status ?? "modified"}</text>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <text fg={theme.textMuted}>Changes:</text>
                <text fg={theme.diffAdded}>+{current()!.additions}</text>
                <text fg={theme.textMuted}>•</text>
                <text fg={theme.diffRemoved}>-{current()!.deletions}</text>
              </box>
              <Show when={current()!.before}>
                <text fg={theme.textMuted}>Before: {current()!.before}</text>
              </Show>
              <Show when={current()!.after}>
                <text fg={theme.textMuted}>After: {current()!.after}</text>
              </Show>
            </Show>
          </box>
        </box>
      </Show>
      <text fg={theme.textMuted}>{footer()}</text>
    </box>
  )
}
