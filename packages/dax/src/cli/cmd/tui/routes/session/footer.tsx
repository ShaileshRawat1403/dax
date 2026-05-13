import { createMemo, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useDirectory } from "../../context/directory"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, type RGBA } from "@opentui/core"
import { useCommandDialog } from "../../component/dialog-command"
import { useDialog } from "../../ui/dialog"
import type { FooterProjection, FooterHealth } from "@/dax/presentation/ui-state-resolver"

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

type FooterPalette = {
  textMuted: RGBA
  warning: RGBA
  error: RGBA
  borderSubtle: RGBA
}

// Footer chip palette mapped by FooterHealth class.
// Footer stays passive unless there is a problem:
//   healthy     = muted (no attention)
//   degraded    = warning (operator-relevant but not blocking)
//   unavailable = error (operator must act)
export function envChipColorForHealth(health: FooterHealth, theme: FooterPalette): RGBA {
  switch (health) {
    case "healthy":
      return theme.textMuted
    case "degraded":
      return theme.warning
    case "unavailable":
      return theme.error
  }
}

// DAX UI Interaction Contract v0.1 — Footer is a dumb consumer of
// FooterProjection. It does not read sync.data, does not interpret MCP/LSP/
// provider statuses, and does not render run lifecycle. See Section 8.
export function Footer(props?: {
  footerProjection?: FooterProjection
  workflowMode?: string
  onCycleWorkflowMode?: () => void
}) {
  const { theme } = useTheme()
  const command = useCommandDialog()
  const dialog = useDialog()
  const renderer = useRenderer()
  const dimensions = useTerminalDimensions()
  const directory = useDirectory()

  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 70)
  const small = createMemo(() => width() < 95)

  const envColor = createMemo(() => {
    const health = props?.footerProjection?.health
    if (!health) return theme.textMuted
    return envChipColorForHealth(health, theme)
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
      paddingTop={0.5}
      paddingBottom={0.5}
      backgroundColor={theme.background}
      border={["top"]}
      borderColor={theme.borderSubtle}
    >
      {/* Left: workflow mode + directory */}
      <box flexDirection="row" gap={1} alignItems="center">
        <Show when={props?.workflowMode}>
          <box
            onMouseUp={() => props?.onCycleWorkflowMode?.()}
            backgroundColor={theme.backgroundElement}
            border={["round"]}
            borderColor={theme.borderSubtle}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              {props?.workflowMode === "plan"
                ? "CHAT"
                : props?.workflowMode === "build"
                  ? "BUILD"
                  : props?.workflowMode?.toUpperCase()}
            </text>
          </box>
        </Show>
        <Show when={!tiny()}>
          <text fg={theme.textMuted} dim>
            {directory()}
          </text>
        </Show>
      </box>

      {/* Right: environment chip + actions/help */}
      <box gap={1} flexDirection="row" flexShrink={0} alignItems="center">
        <Show when={props?.footerProjection && !tiny()}>
          <box
            backgroundColor={theme.backgroundElement}
            border={["round"]}
            borderColor={
              props!.footerProjection!.health === "healthy" ? theme.borderSubtle : envColor()
            }
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={envColor()}>{props!.footerProjection!.label}</text>
          </box>
        </Show>

        <Show when={!tiny()}>
          <text fg={theme.borderSubtle}>|</text>
        </Show>

        <KeyHint key="/" label={small() ? "" : "Actions"} />
        <KeyHint key="?" label={small() ? "" : "Help"} />
      </box>
    </box>
  )
}
