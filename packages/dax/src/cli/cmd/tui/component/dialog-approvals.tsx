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
      reason?: string
      detail: string[]
    }
  | {
      kind: "question"
      id: string
      title: string
      summary: string
      reason?: string
      detail: string[]
    }

function permissionItem(item: PermissionRequest): ApprovalItem {
  const patterns = Array.isArray(item.patterns) && item.patterns.length > 0 ? item.patterns.join(", ") : "none"
  const always = Array.isArray(item.always) && item.always.length > 0 ? item.always.join(", ") : "none"
  const reason =
    typeof item.metadata?.description === "string" && item.metadata.description.trim()
      ? item.metadata.description.trim()
      : undefined
  const toolInfo = item.tool ? `tool call ${item.tool.callID}` : "manual gate"
  return {
    kind: "permission",
    id: item.id,
    title: item.permission,
    summary: reason ?? `${toolInfo} · patterns: ${patterns}`,
    reason,
    detail: [
      `Action: ${item.permission}`,
      `Governance class: permission gate`,
      `Patterns: ${patterns}`,
      `Always-allow options: ${always}`,
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
      return [`${index + 1}. ${question.question}`, ...options.map((option) => `   - ${option}`)]
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
  const title = createMemo(() => (props.explainMode ? "Execution paused for approval" : "Approvals"))
  const footer = createMemo(() =>
    props.explainMode
      ? "Open the approval pane to review the blocked action and continue safely."
      : "Open the approval pane to approve or deny the blocked action.",
  )
  const emptyState = createMemo(() =>
    props.explainMode ? "No execution step is waiting on your decision right now." : "No approvals or questions are waiting.",
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {title()}
        </text>
        <text fg={theme.textMuted}>up/down move • enter open live review • esc close</text>
      </box>

      <Show when={items().length > 0} fallback={<text fg={theme.textMuted}>{emptyState()}</text>}>
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
                  <text
                    fg={selected() === index() ? theme.selectedListItemText : item.kind === "permission" ? theme.warning : theme.accent}
                  >
                    {item.kind === "permission" ? "Approve" : "Answer"} · {item.title}
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
                    ? "Execution is paused until you approve or deny this action."
                    : "Execution is paused until you answer this question."}
                </text>
              </Show>
              <Show when={current()!.kind === "permission" && current()!.reason}>
                <text fg={theme.text} wrapMode="word">
                  {current()!.reason}
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
