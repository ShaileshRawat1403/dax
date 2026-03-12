import { createMemo, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useTerminalDimensions } from "@opentui/solid"
import { SESSION_COMMAND_LABELS } from "@/dax/session-shell"

export function Footer(props?: {
  lifecycleLabel?: string
  onOpenTimeline?: () => void
  onOpenPm?: () => void
  onOpenInspect?: () => void
  onOpenApprovals?: () => void
  onOpenDiff?: () => void
}) {
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
  const mode = createMemo(() => {
    if (route.data.type !== "session") return "Launch"
    return props?.lifecycleLabel ?? "Execute"
  })
  const footerActions = createMemo(() => {
    const actions: Array<{ label: string; onPress?: () => void }> = [
      { label: tiny() ? "[t]" : `[t] ${SESSION_COMMAND_LABELS.jumpTimeline.toLowerCase()}`, onPress: props?.onOpenTimeline },
      { label: tiny() ? "[p]" : "[p] pm", onPress: props?.onOpenPm },
      { label: tiny() ? "[m]" : "[m] mcp", onPress: props?.onOpenInspect },
      { label: tiny() ? "[d]" : "[d] diff", onPress: props?.onOpenDiff },
    ]
    if (permissions().length > 0) {
      actions.push({
        label: tiny() ? "[a]" : `[a] ${SESSION_COMMAND_LABELS.reviewApprovals.toLowerCase()}`,
        onPress: props?.onOpenApprovals,
      })
    }
    return actions.filter((item) => item.onPress)
  })

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
        <Show when={footerActions().length > 0}>
          <box gap={1} flexDirection="row" alignItems="center" flexWrap="wrap">
            <For each={footerActions()}>
              {(action) => (
                <box onMouseUp={() => action.onPress?.()}>
                  <text fg={theme.textMuted}>{action.label}</text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </box>
    </box>
  )
}
