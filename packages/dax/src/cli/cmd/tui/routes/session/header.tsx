import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import type { AssistantMessage } from "@dax-ai/sdk/v2"
import { Installation } from "@/installation"
import { useTerminalDimensions } from "@opentui/solid"
import { cpus, freemem, totalmem } from "node:os"

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const [telemetry, setTelemetry] = createSignal({ cpu: 0, ram: 0 })

  const cpuSnap = () =>
    cpus().reduce(
      (acc, item) => {
        const total = item.times.user + item.times.nice + item.times.sys + item.times.idle + item.times.irq
        return { idle: acc.idle + item.times.idle, total: acc.total + total }
      },
      { idle: 0, total: 0 },
    )

  onMount(() => {
    let prev = cpuSnap()
    const timer = setInterval(() => {
      const next = cpuSnap()
      const totalDiff = next.total - prev.total
      const idleDiff = next.idle - prev.idle
      prev = next
      const cpu = totalDiff > 0 ? Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100))) : 0
      const ramTotal = totalmem()
      const ramUsed = ramTotal - freemem()
      const ram = ramTotal > 0 ? Math.max(0, Math.min(100, Math.round((ramUsed / ramTotal) * 100))) : 0
      setTelemetry({ cpu, ram })
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

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
        paddingTop={tiny() ? 0 : 1}
        paddingBottom={tiny() ? 0 : 1}
        paddingLeft={tiny() ? 1 : 2}
        paddingRight={1}
        flexShrink={0}
      >
        <box flexDirection={small() ? "column" : "row"} justifyContent="space-between" gap={small() ? 0 : 1}>
          <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            <text fg={isThinking() ? theme.accent : theme.success} attributes={TextAttributes.BOLD}>
              [{statusLabel()}]
            </text>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              DAX
            </text>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {title()}
            </text>
          </box>

          <box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
            <Show when={!tiny()}>
              <text fg={theme.textMuted}>{`[CPU:${telemetry().cpu}%]`}</text>
              <text fg={theme.textMuted}>{`[RAM:${telemetry().ram}%]`}</text>
              <text fg={theme.textMuted}>·</text>
            </Show>
            <Show when={context()}>
              <text fg={theme.textMuted}>{context()} tok</text>
              <text fg={theme.textMuted}>·</text>
            </Show>
            <text fg={theme.textMuted}>{`${msgCount()} msg`}</text>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.success}>{cost()}</text>
            <Show when={!tiny()}>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>v{Installation.VERSION}</text>
            </Show>
          </box>
        </box>
      </box>
    </box>
  )
}
