import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import type { TextPart } from "@dax-ai/sdk/v2"
import { Locale } from "@/util/locale"
import { DialogMessage } from "./dialog-message"
import { useDialog } from "../../ui/dialog"
import { useTheme } from "../../context/theme"
import type { PromptInfo } from "../../component/prompt/history"

export function DialogTimeline(props: {
  sessionID: string
  onMove: (messageID: string) => void
  setPrompt?: (prompt: PromptInfo) => void
}) {
  const sync = useSync()
  const dialog = useDialog()
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined

  onMount(() => {
    dialog.setSize("large")
  })

  const rows = createMemo(() => {
    const messages = sync.data.message[props.sessionID] ?? []
    const result = [] as Array<{
      id: string
      title: string
      footer: string
      summary: string
    }>
    for (const message of messages) {
      if (message.role !== "user") continue
      const part = (sync.data.part[message.id] ?? []).find(
        (x) => x.type === "text" && !x.synthetic && !x.ignored,
      ) as TextPart
      if (!part) continue
      const compact = part.text.replace(/\n/g, " ").trim()
      result.push({
        id: message.id,
        title: compact,
        footer: Locale.time(message.time.created),
        summary: compact.length > 180 ? compact.slice(0, 177) + "..." : compact,
      })
    }
    result.reverse()
    return result
  })

  const current = createMemo(() => rows()[selected()])

  function move(delta: number) {
    const list = rows()
    if (list.length === 0) return
    let next = selected() + delta
    if (next < 0) next = list.length - 1
    if (next >= list.length) next = 0
    setSelected(next)
    const target = scroll?.getChildren().find((child) => child.id === list[next]?.id)
    if (!target || !scroll) return
    const y = target.y - scroll.y
    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1)
    if (y < 0) scroll.scrollBy(y)
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
    if (evt.name === "pageup") {
      evt.preventDefault()
      scroll?.scrollBy(-(scroll?.height ?? 10))
    }
    if (evt.name === "pagedown") {
      evt.preventDefault()
      scroll?.scrollBy(scroll?.height ?? 10)
    }
    if (evt.name === "home") {
      evt.preventDefault()
      setSelected(0)
      scroll?.scrollTo(0)
    }
    if (evt.name === "end") {
      evt.preventDefault()
      const list = rows()
      setSelected(Math.max(0, list.length - 1))
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
    }
    if (evt.name === "return") {
      evt.preventDefault()
      const row = current()
      if (!row) return
      props.onMove(row.id)
      dialog.replace(() => (
        <DialogMessage messageID={row.id} sessionID={props.sessionID} setPrompt={props.setPrompt} />
      ))
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Timeline
        </text>
        <text fg={theme.textMuted}>up/down move • enter open • pageup/pagedown scroll • esc close</text>
      </box>

      <Show when={rows().length > 0} fallback={<text fg={theme.textMuted}>No timeline entries yet.</text>}>
        <box flexDirection="row" gap={2} height={18}>
          <scrollbox ref={scroll} width={44} height={18}>
            <box flexDirection="column">
              <For each={rows()}>
                {(row, index) => (
                  <box
                    id={row.id}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={selected() === index() ? theme.primary : undefined}
                    onMouseUp={() => setSelected(index())}
                  >
                    <text fg={selected() === index() ? theme.selectedListItemText : theme.text}>
                      {row.footer}  {row.title}
                    </text>
                  </box>
                )}
              </For>
            </box>
          </scrollbox>

          <box width={34} flexDirection="column" gap={1}>
            <Show when={current()}>
              <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="word">
                {current()!.summary}
              </text>
              <text fg={theme.textMuted}>Open this turn to inspect or reuse the prompt.</text>
            </Show>
          </box>
        </box>
      </Show>
    </box>
  )
}
