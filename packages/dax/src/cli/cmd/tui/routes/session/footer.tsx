import { createMemo, Match, Show, Switch } from "solid-js"
import { tint, useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useCommandDialog } from "../../component/dialog-command"
import { useDialog } from "../../ui/dialog"

export function Footer(props?: { lifecycleLabel?: string }) {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()
  const command = useCommandDialog()
  const dialog = useDialog()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const mcp = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))
  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const directory = useDirectory()

  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 70)
  const small = createMemo(() => width() < 95)

  const mode = createMemo(() => {
    if (route.data.type !== "session") return "LAUNCH"
    return (props?.lifecycleLabel ?? "READY").toUpperCase()
  })
  const showDirectory = createMemo(() => !small())

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
      <box flexDirection="row" gap={1}>
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
        <Show when={showDirectory()}>
          <text fg={theme.textMuted}>{directory()}</text>
        </Show>
      </box>

      <box gap={2} flexDirection="row" flexShrink={0} alignItems="center">
        <box flexDirection="row" gap={1}>
          <box
            onMouseUp={() => command.trigger("help.show")}
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
              <text fg={theme.textMuted}>?</text>
            </box>
            <text fg={theme.textMuted}>Help</text>
          </box>
          <box
            onMouseUp={() => command.show()}
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
              <text fg={theme.textMuted}>/</text>
            </box>
            <text fg={theme.textMuted}>Actions</text>
          </box>
          <Show when={mcp() > 0}>
            <box
              backgroundColor={mcpError() ? tint(theme.backgroundElement, theme.error, 0.08) : theme.backgroundElement}
              border={["round"]}
              borderColor={mcpError() ? theme.error : theme.borderSubtle}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={mcpError() ? theme.error : theme.textMuted}>{mcpError() ? "!" : "●"} MCP:{mcp()}</text>
            </box>
          </Show>
          <Show when={lsp().length > 0}>
            <box backgroundColor={theme.backgroundElement} border={["round"]} borderColor={theme.borderSubtle} paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>● LSP:{lsp().length}</text>
            </box>
          </Show>
        </box>
      </box>
    </box>
  )
}
