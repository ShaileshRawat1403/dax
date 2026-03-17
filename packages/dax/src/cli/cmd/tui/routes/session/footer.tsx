import { createMemo, Match, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"

export function Footer(props?: { lifecycleLabel?: string }) {
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
  const questions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.question[route.data.sessionID] ?? []
  })
  const directory = useDirectory()

  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 70)
  const small = createMemo(() => width() < 95)

  const mode = createMemo(() => {
    if (route.data.type !== "session") return "LAUNCH"
    return (props?.lifecycleLabel ?? "READY").toUpperCase()
  })

  const hasAwaitingAction = createMemo(() => permissions().length > 0 || questions().length > 0)

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      gap={1}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.backgroundPanel}
    >
      <box flexDirection="row" gap={1}>
        <box backgroundColor={theme.primary} paddingLeft={1} paddingRight={1}>
          <text fg={theme.background} attributes={TextAttributes.BOLD}>
            {mode()}
          </text>
        </box>
        <Show when={!small()}>
          <text fg={theme.textMuted}>{directory()}</text>
        </Show>
      </box>

      <box gap={2} flexDirection="row" flexShrink={0} alignItems="center">
        <Show when={hasAwaitingAction()}>
          <box backgroundColor={theme.warning} paddingLeft={1} paddingRight={1}>
            <text fg={theme.background} attributes={TextAttributes.BOLD}>
              ACTION REQUIRED
            </text>
          </box>
        </Show>

        <box flexDirection="row" gap={1}>
          <Show
            when={hasAwaitingAction()}
            fallback={
              <>
                <text fg={theme.textMuted}>[?] Help</text>
                <text fg={theme.textMuted}>[/] Menu</text>
              </>
            }
          >
            <text fg={theme.warning}>[Y] Approve</text>
            <text fg={theme.warning}>[N] Reject</text>
            <text fg={theme.textMuted}>[Esc] Cancel</text>
          </Show>
          <Show when={mcp() > 0}>
            <text fg={mcpError() ? theme.error : theme.textMuted}>
              {mcpError() ? "!" : "●"} MCP:{mcp()}
            </text>
          </Show>
          <Show when={lsp().length > 0}>
            <text fg={theme.textMuted}>● LSP:{lsp().length}</text>
          </Show>
        </box>
      </box>
    </box>
  )
}
