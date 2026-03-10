import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import type { PermissionRequest, QuestionRequest } from "@dax-ai/sdk/v2"
import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "../context/theme"

type ApprovalItem =
  | {
      kind: "permission"
      id: string
      title: string
      summary: string
      detail: string[]
    }
  | {
      kind: "question"
      id: string
      title: string
      summary: string
      detail: string[]
    }

function permissionItem(item: PermissionRequest): ApprovalItem {
  const patterns = item.patterns.length > 0 ? item.patterns.join(", ") : "none"
  const toolInfo = item.tool ? `tool call ${item.tool.callID}` : "manual gate"
  return {
    kind: "permission",
    id: item.id,
    title: `${item.permission} pending approval`,
    summary: `${toolInfo} · patterns: ${patterns}`,
    detail: [
      `Permission: ${item.permission}`,
      `Patterns: ${patterns}`,
      `Always-allow options: ${item.always.length > 0 ? item.always.join(", ") : "none"}`,
      `Session: ${item.sessionID}`,
    ],
  }
}

function questionItem(item: QuestionRequest): ApprovalItem {
  const headers = item.questions.map((question) => question.header).join(", ")
  return {
    kind: "question",
    id: item.id,
    title: item.questions.length === 1 ? item.questions[0]!.header : `${item.questions.length} questions`,
    summary: headers,
    detail: item.questions.flatMap((question, index) => {
      const options = question.options.map((option) => `${option.label}: ${option.description}`)
      return [
        `${index + 1}. ${question.question}`,
        ...options.map((option) => `   - ${option}`),
      ]
    }),
  }
}

export function DialogApprovals(props: {
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  onOpenLive?: (requestID: string) => void
  explainMode?: boolean
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal(0)

  const items = createMemo<ApprovalItem[]>(() => [
    ...props.permissions.map(permissionItem),
    ...props.questions.map(questionItem),
  ])

  function move(delta: number) {
    const list = items()
    if (list.length === 0) return
    let next = selected() + delta
    if (next < 0) next = list.length - 1
    if (next >= list.length) next = 0
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
      const item = current()
      if (!item) return
      props.onOpenLive?.(item.id)
    }
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const current = createMemo(() => items()[selected()])
  const title = createMemo(() => (props.explainMode ? "Things awaiting operator decision" : "Pending approvals and questions"))
  const footer = createMemo(() =>
    props.explainMode
      ? "Open live review so DAX can continue the blocked step safely."
      : "Open live review to resolve approvals and questions in the approvals panel.",
  )
  const emptyState = createMemo(() =>
    props.explainMode ? "No operator decision is required right now." : "No pending approvals or questions.",
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {title()}
        </text>
        <text fg={theme.textMuted}>up/down move • enter open live review • esc close</text>
      </box>

      <Show
        when={items().length > 0}
        fallback={<text fg={theme.textMuted}>{emptyState()}</text>}
      >
        <box flexDirection="row" gap={2} height={18}>
          <box width={28} flexDirection="column">
            <For each={items()}>
              {(item, index) => (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={selected() === index() ? theme.primary : undefined}
                  onMouseUp={() => setSelected(index())}
                >
                  <text fg={selected() === index() ? theme.selectedListItemText : item.kind === "permission" ? theme.warning : theme.accent}>
                    {item.kind === "permission" ? "?" : "…"} {item.title}
                  </text>
                </box>
              )}
            </For>
          </box>

          <box width={48} flexDirection="column" gap={1}>
            <Show when={current()}>
              <text fg={theme.text}>
                <b>{current()!.title}</b>
              </text>
              <Show when={props.explainMode}>
                <text fg={theme.text}>
                  {current()!.kind === "permission"
                    ? "DAX is awaiting your approval before it can continue this step."
                    : "DAX is awaiting your answer before it can continue this step."}
                </text>
              </Show>
              <text fg={theme.textMuted} wrapMode="word">
                {current()!.summary}
              </text>
              <For each={current()!.detail}>
                {(line) => (
                  <text fg={theme.textMuted} wrapMode="word">
                    {line}
                  </text>
                )}
              </For>
            </Show>
          </box>
        </box>
      </Show>
      <text fg={theme.textMuted}>{footer()}</text>
    </box>
  )
}
