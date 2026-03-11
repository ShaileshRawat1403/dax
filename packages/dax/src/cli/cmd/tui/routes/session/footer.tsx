import { createMemo, For, Match, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useTerminalDimensions } from "@opentui/solid"

export function Footer(props?: {
  lifecycleLabel?: string
  trustLabel?: string
  focusLabel?: string
  focusHints?: string[]
  onOpenTimeline?: () => void
  onOpenArtifacts?: () => void
  onOpenVerify?: () => void
  onOpenRelease?: () => void
  onOpenInspect?: () => void
  onOpenApprovals?: () => void
}) {
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
  const compactHints = createMemo(() => (props?.focusHints ?? []).slice(0, small() ? 2 : 3))
  const footerActions = createMemo(() => {
    const actions: Array<{ label: string; onPress?: () => void }> = [
      { label: tiny() ? "[t]" : "[t] timeline", onPress: props?.onOpenTimeline },
      { label: tiny() ? "[a]" : "[a] artifacts", onPress: props?.onOpenArtifacts },
      { label: tiny() ? "[v]" : "[v] verify", onPress: props?.onOpenVerify },
      { label: tiny() ? "[r]" : "[r] release", onPress: props?.onOpenRelease },
      { label: tiny() ? "[i]" : "[i] inspect", onPress: props?.onOpenInspect },
    ]
    if (permissions().length > 0) {
      actions.push({ label: tiny() ? "[p]" : "[p] approvals", onPress: props?.onOpenApprovals })
    }
    return actions.filter((action) => !!action.onPress)
  })

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
        <Show when={!small() && props?.focusLabel}>
          <text fg={theme.textMuted}>{`Focus ${props?.focusLabel}`}</text>
        </Show>
      </box>
      <box gap={1} flexDirection="row" flexShrink={0} alignItems="center">
        <Show when={permissions().length > 0}>
          <text fg={theme.warning}>{`${permissions().length} approval${permissions().length === 1 ? "" : "s"} pending`}</text>
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
            {`Trust ${props?.trustLabel?.toLowerCase()}`}
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
        <Show when={!small() && compactHints().length > 0}>
          <box gap={1} flexDirection="row" alignItems="center">
            <For each={compactHints()}>
              {(hint, index) => (
                <>
                  <Show when={index() > 0}>
                    <text fg={theme.textMuted}>·</text>
                  </Show>
                  <text fg={theme.textMuted}>{hint}</text>
                </>
              )}
            </For>
          </box>
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
