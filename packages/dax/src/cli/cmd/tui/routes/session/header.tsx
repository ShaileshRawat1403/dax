import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import type { AssistantMessage } from "@dax-ai/sdk/v2"
import { Installation } from "@/installation"
import { useTerminalDimensions } from "@opentui/solid"
import { useUIActivity } from "../../context/activity"

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const { telemetry, currentPun } = useUIActivity()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const cost = createMemo(() => {
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    return total.toLocaleString()
  })

  const isThinking = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant")
    if (!last) return false
    if (!last.time.completed) return true
    const parts = sync.data.part[last.id] ?? []
    return parts.some((p) => p.type === "tool" && p.state.status === "pending")
  })

  const currentTool = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant")
    if (!last) return
    const parts = sync.data.part[last.id] ?? []
    const tool = parts.find((p) => p.type === "tool" && p.state.status === "pending")
    return tool ? (tool as any).tool : null
  })
  const liveStage = createMemo(() => {
    if (!isThinking()) return "Done"
    const tool = currentTool()
    if (!tool) return "Thinking"
    if (["read", "glob", "grep", "list", "webfetch", "websearch", "codesearch"].includes(tool)) return "Exploring"
    if (["task", "todowrite", "question", "skill"].includes(tool)) return "Planning"
    if (["write", "edit", "apply_patch", "bash"].includes(tool)) return "Executing"
    return "Thinking"
  })
  const sessionIntent = createMemo(() => {
    const user = messages().find((x) => x.role === "user")
    if (!user) return session().title
    const part = (sync.data.part[user.id] ?? []).find((x) => x.type === "text" && "text" in x && x.text.trim())
    if (!part || !("text" in part)) return session().title
    const body = part.text.replace(/\s+/g, " ").trim().replace(/[.!?].*$/, "")
    if (!body) return session().title
    const text = body[0].toUpperCase() + body.slice(1)
    if (text.length <= 44) return text
    return `${text.slice(0, 41)}...`
  })
  const title = createMemo(() => `${sessionIntent()} · ${liveStage()}`)

  const msgCount = createMemo(() => messages().filter((x) => x.role === "user").length)

  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 60)
  const small = createMemo(() => width() < 80)

  const statusLabel = () => (isThinking() ? (currentTool() ? `running: ${currentTool()}` : "thinking") : "ready")

  return (
    <box flexShrink={0} backgroundColor={theme.backgroundPanel}>
      <box
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={1}
        paddingRight={1}
        flexShrink={0}
      >
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              DAX
            </text>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {title()}
            </text>
            <Show when={isThinking()}>
              <text fg={theme.accent}>[{statusLabel()}]</text>
              <Show when={!tiny()}>
                <text fg={theme.textMuted}>{currentPun()}</text>
              </Show>
            </Show>
          </box>

          <box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
            <Show when={!tiny()}>
              <text fg={theme.textMuted}>{`C:${telemetry().cpu}% R:${telemetry().ram}%`}</text>
            </Show>
            <Show when={context()}>
              <text fg={theme.textMuted}>{context()}t</text>
            </Show>
            <text fg={theme.textMuted}>{`${msgCount()}m`}</text>
            <text fg={theme.success}>{cost()}</text>
          </box>
        </box>
      </box>
    </box>
  )
}
