import { createMemo, Match, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useTerminalDimensions } from "@opentui/solid"

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
  const tiny = createMemo(() => width() < 60)
  const small = createMemo(() => width() < 80)

  const sessionCount = createMemo(() => sync.data.session.length)

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={1} flexDirection="row" flexShrink={0} alignItems="center">
        <Show when={permissions().length > 0}>
          <text fg={theme.warning}>{`! ${permissions().length} pending`}</text>
        </Show>
        <Show when={!tiny() && lsp().length > 0}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.success}>●</text>
            <text fg={theme.text}>{`${lsp().length} lsp`}</text>
          </box>
        </Show>
        <Show when={mcp() > 0}>
          <box flexDirection="row" gap={1}>
            <Switch>
              <Match when={mcpError()}>
                <span style={{ fg: theme.error }}>!</span>
              </Match>
              <Match when={true}>
                <span style={{ fg: theme.success }}>●</span>
              </Match>
            </Switch>
            <text fg={theme.text}>{`${mcp()} mcp`}</text>
          </box>
        </Show>
        <Show when={!small() && sessionCount() > 0}>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.textMuted}>{`${sessionCount()} sessions`}</text>
        </Show>
        <Show when={!tiny()}>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.textMuted}>[?] help</text>
        </Show>
      </box>
    </box>
  )
}
