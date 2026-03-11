import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { Locale } from "@/util/locale"
import { collectSessionTimeline, type SessionTimelineEventType } from "@/cli/cmd/session"

function timelineLabel(type: SessionTimelineEventType) {
  switch (type) {
    case "session_created":
      return "Session created"
    case "plan_generated":
      return "Plan generated"
    case "execution_started":
      return "Execution started"
    case "execution_completed":
      return "Execution completed"
    case "approval_requested":
      return "Approval requested"
    case "approval_resolved":
      return "Approval resolved"
    case "artifact_produced":
      return "Artifacts produced"
    case "audit_finding_recorded":
      return "Audit issue detected"
    case "trust_posture_changed":
      return "Trust posture updated"
  }
}

export function DialogTimeline(props: { sessionID: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined

  onMount(() => {
    dialog.setSize("large")
  })

  const [rows] = createResource(
    () => props.sessionID,
    async (sessionID) => {
      return collectSessionTimeline(sessionID)
    },
  )

  const current = createMemo(() => rows()?.[selected()])

  function move(delta: number) {
    const list = rows() ?? []
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
      const list = rows() ?? []
      setSelected(Math.max(0, list.length - 1))
      if (scroll) scroll.scrollTo(scroll.scrollHeight)
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Session timeline
        </text>
        <text fg={theme.textMuted}>up/down move • pageup/pagedown scroll • esc close</text>
      </box>

      <Show when={!rows.loading} fallback={<text fg={theme.textMuted}>Loading session progression…</text>}>
        <Show
          when={!rows.error}
          fallback={<text fg={theme.error}>Unable to load session timeline.</text>}
        >
          <Show
            when={(rows() ?? []).length > 0}
            fallback={<text fg={theme.textMuted}>No timeline events recorded for this session yet.</text>}
          >
            <box flexDirection="row" gap={2} height={18}>
              <scrollbox ref={scroll} width={44} height={18}>
                <box flexDirection="column">
                  <For each={rows() ?? []}>
                    {(row, index) => (
                      <box
                        id={row.id}
                        paddingLeft={1}
                        paddingRight={1}
                        paddingTop={0}
                        paddingBottom={0}
                        backgroundColor={selected() === index() ? theme.primary : undefined}
                        onMouseUp={() => setSelected(index())}
                      >
                        <text fg={selected() === index() ? theme.selectedListItemText : theme.text}>
                          {Locale.todayTimeOrDateTime(row.timestamp)}  {timelineLabel(row.type)}
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
                  <Show when={current()!.state_effect}>
                    <text fg={theme.textMuted} wrapMode="word">
                      Effect: {current()!.state_effect}
                    </text>
                  </Show>
                  <Show when={current()!.reference}>
                    <text fg={theme.textMuted} wrapMode="word">
                      Reference: {current()!.reference}
                    </text>
                  </Show>
                </Show>
              </box>
            </box>
          </Show>
        </Show>
      </Show>
    </box>
  )
}
