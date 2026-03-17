import { useTheme } from "@tui/context/theme"
import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { Show } from "solid-js"

export function RefinePane(props: { initialPrompt: string; onUpdate: (prompt: string) => void }) {
  const { theme } = useTheme()
  let textarea: TextareaRenderable

  // If we have content, show it. Otherwise show placeholder.
  const hasContent = () => props.initialPrompt && props.initialPrompt.length > 10

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1}>
      <box flexDirection="column" gap={0} paddingBottom={1} border={["bottom"]} borderColor={theme.border}>
        <text fg={theme.accent} bold>
          ✦ STRUCTURED EXECUTION CONTRACT
        </text>
        <Show when={hasContent()}>
          <text fg={theme.success}>✓ Contract ready - review and edit below</text>
        </Show>
        <Show when={!hasContent()}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            Click "Refine Current" to generate a contract
          </text>
        </Show>
      </box>

      <box
        flexGrow={1}
        flexDirection="column"
        marginTop={1}
        border={["all"]}
        borderColor={hasContent() ? theme.success : theme.border}
        padding={1}
      >
        <textarea
          ref={(r: TextareaRenderable) => (textarea = r)}
          value={props.initialPrompt}
          onContentChange={() => props.onUpdate(textarea.plainText)}
          textColor={theme.text}
          focusedTextColor={theme.text}
          flexGrow={1}
        />
      </box>

      <box paddingTop={1} border={["top"]} borderColor={theme.border}>
        <text fg={theme.success}>👉 Press Enter to execute this contract</text>
      </box>
    </box>
  )
}
