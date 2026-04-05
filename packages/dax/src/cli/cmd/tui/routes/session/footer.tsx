import { createMemo, Show } from "solid-js"
import { tint, useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useCommandDialog } from "../../component/dialog-command"
import { useDialog } from "../../ui/dialog"
import { isMcpStatusAttention, isMcpStatusBlocked } from "@/dax/status"

function KeyHint(props: { key: string; label: string }) {
  const { theme } = useTheme()
  return (
    <box
      flexDirection="row"
      gap={1}
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.backgroundElement}
      border={["round"]}
      borderColor={theme.borderSubtle}
    >
      <box
        backgroundColor={theme.background}
        border={["round"]}
        borderColor={theme.borderSubtle}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.key}
        </text>
      </box>
      <text fg={theme.textMuted}>{props.label}</text>
    </box>
  )
}

function StatusIndicator(props: { label: string; attention?: boolean; blocked?: boolean }) {
  const { theme } = useTheme()
  const color = createMemo(() => {
    if (props.attention) return props.blocked ? theme.error : theme.warning
    return theme.textMuted
  })
  return (
    <box
      backgroundColor={
        props.attention
          ? tint(theme.backgroundElement, props.blocked ? theme.error : theme.warning, 0.08)
          : theme.backgroundElement
      }
      border={["round"]}
      borderColor={props.attention ? (props.blocked ? theme.warning : theme.error) : theme.borderSubtle}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={color()}>{props.label}</text>
    </box>
  )
}

export function Footer(props?: { lifecycleLabel?: string }) {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const command = useCommandDialog()
  const dialog = useDialog()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const mcpTotal = createMemo(() => Object.keys(sync.data.mcp).length)
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpAttention = createMemo(() => Object.values(sync.data.mcp).some((x) => isMcpStatusAttention(x as any)))
  const mcpBlocked = createMemo(() => Object.values(sync.data.mcp).some((x) => isMcpStatusBlocked(x as any)))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const directory = useDirectory()

  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 70)
  const small = createMemo(() => width() < 95)

  const mode = createMemo(() => {
    if (route.data.type !== "session") return "LAUNCH"
    return (props?.lifecycleLabel ?? "READY").toUpperCase()
  })

  const looksLikeHelpKey = (evt: any) =>
    (!evt.ctrl && !evt.meta && !evt.super && evt.shift && evt.name === "/") ||
    evt.sequence === "?" ||
    evt.key === "?" ||
    evt.character === "?"

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    const focusedName = renderer.currentFocusedRenderable?.constructor?.name ?? ""
    if (focusedName.includes("Textarea")) return
    if (looksLikeHelpKey(evt)) {
      evt.preventDefault()
      command.trigger("help.show")
      return
    }
  })

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
      {/* Left: mode + directory */}
      <box flexDirection="row" gap={1} alignItems="center">
        <box
          backgroundColor={theme.primary}
          border={["round"]}
          borderColor={theme.borderActive}
          paddingLeft={1}
          paddingRight={1}
        >
          <text fg={theme.background} attributes={TextAttributes.BOLD}>
            {mode()}
          </text>
        </box>
        <Show when={!tiny()}>
          <text fg={theme.textMuted} dim>
            {directory()}
          </text>
        </Show>
      </box>

      {/* Right: status indicators + actions */}
      <box gap={1} flexDirection="row" flexShrink={0} alignItems="center">
        {/* MCP status */}
        <Show when={mcpTotal() > 0 && !tiny()}>
          <StatusIndicator label={`MCP ${mcp()}/${mcpTotal()}`} attention={mcpAttention()} blocked={mcpBlocked()} />
        </Show>

        {/* LSP status */}
        <Show when={lsp().length > 0 && !tiny()}>
          <StatusIndicator label={`LSP ${lsp().length}`} />
        </Show>

        {/* Separator */}
        <Show when={!tiny()}>
          <text fg={theme.borderSubtle}>|</text>
        </Show>

        {/* Actions */}
        <KeyHint key="/" label={small() ? "" : "Actions"} />

        {/* Help */}
        <KeyHint key="?" label={small() ? "" : "Help"} />
      </box>
    </box>
  )
}
