import { type Accessor, createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { pipe, sumBy } from "remeda"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import type { AssistantMessage, Session } from "@dax-ai/sdk/v2"
import { Installation } from "@/installation"
import { useTerminalDimensions } from "@opentui/solid"
import { cpus, freemem, totalmem } from "node:os"

const CPU_FRAMES = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

const Title = (props: { session: Accessor<Session> }) => {
  const { theme } = useTheme()
  return (
    <text fg={theme.text} attributes={TextAttributes.BOLD}>
      {props.session().title}
    </text>
  )
}

export function Header() {
  const route = useRouteData("session")
  const sync = useSync()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const [telemetry, setTelemetry] = createSignal({ cpu: 0, ram: 0, tick: 0 })

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
      setTelemetry((t) => ({ cpu, ram, tick: t.tick + 1 }))
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  const cpuBar = () => {
    const v = telemetry().cpu
    const i = Math.floor((v / 100) * 8)
    return CPU_FRAMES[Math.min(i, 7)]
  }

  const ramBar = () => {
    const v = telemetry().ram
    const i = Math.floor((v / 100) * 8)
    return CPU_FRAMES[Math.min(i, 7)]
  }

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

  const msgCount = createMemo(() => messages().filter((x) => x.role === "user").length)

  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 60)
  const small = createMemo(() => width() < 80)

  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const t = setInterval(() => setTick((t) => (t + 1) % 8), 120)
    onCleanup(() => clearInterval(t))
  })

  const statusIcon = () => (isThinking() ? CPU_FRAMES[tick()] : "●")

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
              {statusIcon()}
            </text>
            <text fg={theme.textMuted}>
              {isThinking() ? (currentTool() ? `running: ${currentTool()}` : "thinking") : "ready"}
            </text>
            <text fg={theme.textMuted}>·</text>
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              DAX
            </text>
            <text fg={theme.textMuted}>·</text>
            <Title session={session} />
          </box>

          <box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
            <Show when={!tiny()}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.warning}>{cpuBar()}</text>
                <text fg={theme.textMuted}>{`${telemetry().cpu}%`}</text>
              </box>
              <box flexDirection="row" gap={1}>
                <text fg={theme.info}>{ramBar()}</text>
                <text fg={theme.textMuted}>{`${telemetry().ram}%`}</text>
              </box>
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
