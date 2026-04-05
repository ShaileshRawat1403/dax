import { createMemo, Match, Show, Switch } from "solid-js"
import { tint, useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useRoute } from "../../context/route"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useCommandDialog } from "../../component/dialog-command"
import { useDialog } from "../../ui/dialog"
import { isMcpStatusAttention, isMcpStatusBlocked } from "@/dax/status"

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
  const narrow = createMemo(() => width() < 120)

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

      {/* Center: shortcuts (hidden on tiny screens) */}
      <Show when={!tiny()}>
        <box flexDirection="row" gap={1} alignItems="center">
          <Show when={!narrow()}>
            <box flexDirection="row" gap={1} alignItems="center">
              <box
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.textMuted}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    ^R
                  </text>{" "}
                  refine
                </text>
              </box>
              <box
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.textMuted}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    ^K
                  </text>{" "}
                  stash
                </text>
              </box>
              <box
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.textMuted}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    ^G
                  </text>{" "}
                  diff
                </text>
              </box>
            </box>
          </Show>
        </box>
      </Show>

      {/* Right: status indicators + actions */}
      <box gap={1} flexDirection="row" flexShrink={0} alignItems="center">
        <Show when={mcpTotal() > 0 && !tiny()}>
          <box
            backgroundColor={
              mcpAttention()
                ? tint(theme.backgroundElement, mcpBlocked() ? theme.warning : theme.error, 0.08)
                : theme.backgroundElement
            }
            border={["round"]}
            borderColor={mcpAttention() ? (mcpBlocked() ? theme.warning : theme.error) : theme.borderSubtle}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={mcpAttention() ? (mcpBlocked() ? theme.warning : theme.error) : theme.textMuted}>
              {mcpAttention() ? "!" : "●"} MCP:{mcp()}/{mcpTotal()}
            </text>
          </box>
        </Show>
        <Show when={lsp().length > 0 && !tiny()}>
          <box
            backgroundColor={theme.backgroundElement}
            border={["round"]}
            borderColor={theme.borderSubtle}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.textMuted}>● LSP:{lsp().length}</text>
          </box>
        </Show>
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
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            /
          </text>
          <Show when={!small()}>
            <text fg={theme.textMuted}>Actions</text>
          </Show>
        </box>
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
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            ?
          </text>
          <Show when={!small()}>
            <text fg={theme.textMuted}>Help</text>
          </Show>
        </box>
      </box>
    </box>
  )
}
