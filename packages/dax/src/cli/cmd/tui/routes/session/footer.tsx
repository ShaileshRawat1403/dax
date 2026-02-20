import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useTerminalDimensions } from "@opentui/solid"
import { pipe, sumBy } from "remeda"
import type { AssistantMessage } from "@dax-ai/sdk/v2"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()

  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 70)
  const small = createMemo(() => width() < 95)

  const sessionCount = createMemo(() => sync.data.session.length)
  const mode = createMemo(() => (route.data.type === "session" ? "Execute" : "Launch"))

  const messages = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.message[route.data.sessionID] ?? []
  })

  const isStreaming = createMemo(() => {
    if (route.data.type !== "session") return false
    const last = messages().findLast((x) => x.role === "assistant")
    return last ? !last.time.completed : false
  })

  const [streamElapsed, setStreamElapsed] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => {
      if (!isStreaming()) {
        setStreamElapsed(0)
        return
      }
      const pendingMsg = messages().findLast((x) => x.role === "assistant" && !x.time.completed)
      if (pendingMsg) {
        const parent = messages().find((x) => x.role === "user" && x.id === (pendingMsg as any).parentID)
        if (parent) {
          setStreamElapsed(Date.now() - parent.time.created)
        }
      }
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  const streamElapsedLabel = createMemo(() => {
    const ms = streamElapsed()
    if (ms <= 0) return ""
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}m${secs.toString().padStart(2, "0")}s`
  })

  const liveCost = createMemo(() => {
    if (route.data.type !== "session") return ""
    const total = pipe(
      messages(),
      sumBy((x) => (x.role === "assistant" ? x.cost : 0)),
    )
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total)
  })

  const lastTokens = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return 0
    return (last.tokens.output ?? 0) + (last.tokens.reasoning ?? 0)
  })

  const toolPipeline = createMemo(() => {
    if (!isStreaming()) return ""
    const pendingMsg = messages().findLast((x) => x.role === "assistant" && !x.time.completed)
    if (!pendingMsg) return ""
    const parts = sync.data.part[pendingMsg.id] ?? []
    const tools = parts.filter((p) => p.type === "tool")
    const completed = tools.filter((t) => t.state.status === "completed").length
    const running = tools.filter((t) => t.state.status === "running").length
    const pending = tools.filter((t) => t.state.status === "pending").length
    const total = completed + running + pending
    if (total === 0) return ""
    return `${completed}/${total} tools`
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.primary}>{mode()}</text>
        <Show when={!small()}>
          <text fg={theme.textMuted}>{directory()}</text>
        </Show>
        <Show when={isStreaming() && streamElapsedLabel()}>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.accent}>{streamElapsedLabel()}</text>
        </Show>
        <Show when={isStreaming() && toolPipeline()}>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.textMuted}>{toolPipeline()}</text>
        </Show>
      </box>
      <box gap={1} flexDirection="row" flexShrink={0} alignItems="center">
        <Show when={isStreaming() && lastTokens() > 0 && !tiny()}>
          <text fg={theme.accent}>{`${lastTokens().toLocaleString()} tok`}</text>
          <text fg={theme.textMuted}>·</text>
        </Show>
        <Show when={route.data.type === "session" && liveCost()}>
          <text fg={theme.success}>{liveCost()}</text>
          <text fg={theme.textMuted}>·</text>
        </Show>
        <Show when={permissions().length > 0}>
          <text fg={theme.warning}>{`[approval:${permissions().length}]`}</text>
        </Show>
        <Show when={!tiny() && lsp().length > 0}>
          <text fg={theme.textMuted}>{`[lsp:${lsp().length}]`}</text>
        </Show>
        <Show when={mcp() > 0}>
          <Switch>
            <Match when={mcpError()}>
              <text fg={theme.error}>{`[mcp:${mcp()}!]`}</text>
            </Match>
            <Match when={true}>
              <text fg={theme.textMuted}>{`[mcp:${mcp()}]`}</text>
            </Match>
          </Switch>
        </Show>
        <Show when={!small() && sessionCount() > 0}>
          <text fg={theme.textMuted}>{`[sessions:${sessionCount()}]`}</text>
        </Show>
        <Show when={!tiny()}>
          <text fg={theme.textMuted}>[help:?]</text>
        </Show>
      </box>
    </box>
  )
}
