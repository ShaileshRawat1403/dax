import { createMemo, For, Show } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import type { AssistantMessage } from "@dax-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
import { classifyAssistantNarrativeIntensity } from "@/dax/assistant-narrative"

type HeaderAction = {
  label: string
  onPress: () => void
  primary?: boolean
}

export function Header(props: {
  stageLabel: string
  stageReason: string
  detail?: string
  emphasis?: "normal" | "muted"
  actions?: HeaderAction[]
}) {
  const route = useRouteData("session")
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const stageColor = createMemo(() => {
    if (props.stageLabel.includes("Waiting")) return theme.warning
    if (props.stageLabel.includes("Complete") || props.stageLabel.includes("Done")) return theme.success
    if (props.stageLabel.includes("Understanding")) return theme.secondary
    return theme.accent
  })
  const sessionIntent = createMemo(() => {
    const s = session()
    if (!s) return "Loading..."
    const user = messages().find((x) => x.role === "user")
    if (!user) return s.title
    const part = (sync.data.part[user.id] ?? []).find((x) => x.type === "text" && "text" in x && x.text.trim())
    if (!part || !("text" in part)) return s.title
    const body = part.text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?].*$/, "")
    if (!body) return s.title
    const text = body[0].toUpperCase() + body.slice(1)
    if (text.length <= 44) return text
    return `${text.slice(0, 41)}...`
  })
  const title = createMemo(() => sessionIntent())
  const headline = createMemo(() => {
    const reason = props.stageReason?.trim()
    if (!reason) return props.stageLabel
    return reason[0].toUpperCase() + reason.slice(1)
  })
  const shellIntensity = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant") as AssistantMessage | undefined
    if (!last) return "guided" as const
    const parent = last.parentID ? messages().find((x) => x.id === last.parentID && x.role === "user") : undefined
    const askedPart =
      parent &&
      (sync.data.part[parent.id] ?? []).find((x) => x.type === "text" && "text" in x && x.text.trim())
    const asked = askedPart && "text" in askedPart ? askedPart.text : ""
    const parts = sync.data.part[last.id] ?? []
    return classifyAssistantNarrativeIntensity({
      asked,
      mode: last.mode,
      hasPendingTool: parts.some((part) => part.type === "tool" && part.state.status === "pending"),
      hasToolActivity: parts.some((part) => part.type === "tool"),
      toolCount: parts.filter((part) => part.type === "tool").length,
      hasExecuteTool: parts.some((part) => part.type === "tool" && ["write", "edit", "apply_patch", "bash"].includes(part.tool)),
      hasVerifyTool: parts.some((part) => part.type === "tool" && ["read", "grep", "list", "glob"].includes(part.tool)),
      hasReasoning: parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0),
      hasError: !!last.error,
      completed: !!last.time.completed,
      doing: "",
      next: "",
    })
  })

  const dimensions = useTerminalDimensions()
  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 60)
  const wide = createMemo(() => width() >= 90)
  const showSessionTitle = createMemo(() => shellIntensity() === "operational" && wide())
  const showHeadline = createMemo(() => shellIntensity() !== "light" || props.emphasis === "normal" || !!props.detail)
  const showStageBadge = createMemo(() => shellIntensity() !== "light" && props.stageLabel !== "Complete")
  const detailColor = createMemo(() => (props.emphasis === "muted" ? theme.textMuted : theme.warning))

  return (
    <box flexShrink={0} backgroundColor={theme.backgroundPanel}>
      <box paddingTop={0} paddingBottom={0} paddingLeft={1} paddingRight={1} flexShrink={0}>
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              DAX
            </text>
            <Show when={showSessionTitle()}>
              <>
                <text fg={theme.textMuted}>
                  {title()}
                </text>
                <text fg={theme.textMuted}>·</text>
              </>
            </Show>
            <Show when={showHeadline()}>
              <text fg={shellIntensity() === "light" ? theme.textMuted : theme.text} attributes={props.emphasis === "normal" ? TextAttributes.BOLD : undefined}>
                {headline()}
              </text>
            </Show>
            <Show when={showStageBadge()}>
              <text fg={theme.textMuted}>·</text>
              <text fg={stageColor()}>{props.stageLabel}</text>
            </Show>
            <Show when={!tiny() && props.detail}>
              <text fg={theme.textMuted}>·</text>
              <text fg={detailColor()} attributes={props.emphasis === "normal" ? TextAttributes.BOLD : undefined}>
                {props.detail}
              </text>
            </Show>
          </box>
          <Show when={props.actions?.length}>
            <box flexDirection="row" gap={1} alignItems="center">
              <For each={props.actions}>
                {(action) => (
                  <box
                    onMouseUp={action.onPress}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={action.primary ? theme.primary : theme.backgroundElement}
                  >
                    <text fg={action.primary ? theme.background : theme.textMuted}>{action.label}</text>
                  </box>
                )}
              </For>
            </box>
          </Show>
        </box>
      </box>
    </box>
  )
}
