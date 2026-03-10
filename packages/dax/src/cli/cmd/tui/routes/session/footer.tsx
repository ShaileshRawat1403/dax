import { createMemo, Match, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useTerminalDimensions } from "@opentui/solid"

export function Footer(props?: { lifecycleLabel?: string; trustLabel?: string }) {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()

  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 70)
  const small = createMemo(() => width() < 95)

  const mode = createMemo(() => {
    if (route.data.type !== "session") return "Launch"
    return props?.lifecycleLabel ?? "Activity"
  })
  const mcpAttention = createMemo(() =>
    Object.values(sync.data.mcp).filter(
      (x) => x.status === "failed" || x.status === "needs_auth" || x.status === "needs_client_registration",
    ).length,
  )

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={1}>
        <text fg={theme.primary}>{mode()}</text>
        <Show when={!small()}>
          <text fg={theme.textMuted}>{directory()}</text>
        </Show>
      </box>
      <box gap={1} flexDirection="row" flexShrink={0} alignItems="center">
        <Show when={permissions().length > 0}>
          <text fg={theme.warning}>{`${permissions().length} approval${permissions().length === 1 ? "" : "s"} waiting`}</text>
        </Show>
        <Show when={!tiny() && props?.trustLabel}>
          <text
            fg={
              props?.trustLabel === "Blocked"
                ? theme.error
                : props?.trustLabel === "Review needed"
                  ? theme.warning
                  : theme.success
            }
          >
            {`Audit ${props?.trustLabel?.toLowerCase()}`}
          </text>
        </Show>
        <Show when={mcpAttention() > 0}>
          <Switch>
            <Match when={mcpError()}>
              <text fg={theme.error}>{`${mcpAttention()} MCP issue${mcpAttention() === 1 ? "" : "s"}`}</text>
            </Match>
            <Match when={true}>
              <text fg={theme.warning}>{`${mcpAttention()} MCP need${mcpAttention() === 1 ? "s" : ""} attention`}</text>
            </Match>
          </Switch>
        </Show>
        <Show when={!tiny() && permissions().length === 0 && mcpAttention() === 0}>
          <text fg={theme.textMuted}>? help</text>
        </Show>
      </box>
    </box>
  )
}
