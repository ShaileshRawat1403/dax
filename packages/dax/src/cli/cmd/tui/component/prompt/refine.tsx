import { useTheme } from "@tui/context/theme"
import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { createSignal, createEffect, Show } from "solid-js"

export function RefinePane(props: { initialPrompt: string; onUpdate: (prompt: string) => void }) {
  const { theme } = useTheme()
  let textareaRef: TextareaRenderable
  const [displayValue, setDisplayValue] = createSignal("")

  // Force update when props change
  createEffect(() => {
    const newValue = props.initialPrompt || ""
    setDisplayValue(newValue)
    // Also update the textarea directly if it exists
    if (textareaRef && newValue) {
      textareaRef.setText(newValue)
    }
  })

  const hasContent = () => displayValue().length > 10

  const handleChange = (text: string) => {
    setDisplayValue(text)
    props.onUpdate(text)
  }

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
          ref={(r: TextareaRenderable) => {
            textareaRef = r
            // Set initial value
            if (r && props.initialPrompt) {
              r.setText(props.initialPrompt)
            }
          }}
          value={displayValue()}
          onContentChange={(e: any) => handleChange(e.plainText || "")}
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
