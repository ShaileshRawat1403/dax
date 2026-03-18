import { useTheme } from "@tui/context/theme"
import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { createSignal, createEffect, Show } from "solid-js"
import { useTextareaKeybindings } from "../textarea-keybindings"
import { setSkipRefocus } from "../../app"

export function RefinePane(props: { initialPrompt: string; onUpdate: (prompt: string) => void; onSubmit?: () => void }) {
  const { theme } = useTheme()
  let textareaRef: TextareaRenderable
  const [isInitialized, setIsInitialized] = createSignal(false)
  const textareaKeybindings = useTextareaKeybindings()

  // Force update when props change
  createEffect(() => {
    const newValue = props.initialPrompt || ""
    // Only set text if we haven't initialized yet OR if there's new content
    if (textareaRef && newValue && !isInitialized()) {
      textareaRef.setText(newValue)
      setIsInitialized(true)
    }
  })

  const hasContent = () => props.initialPrompt && props.initialPrompt.length > 10

  const focusTextarea = () => {
    setSkipRefocus(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        textareaRef?.focus()
      })
    })
  }

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1} onMouseDown={focusTextarea}>
      <box flexDirection="column" gap={0} paddingBottom={1} border={["bottom"]} borderColor={theme.border}>
        <text fg={theme.accent} bold>
          ✦ STRUCTURED EXECUTION CONTRACT
        </text>
        <Show when={hasContent()}>
          <text fg={theme.success}>✓ Contract ready - edit below then press Enter</text>
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
        onMouseDown={focusTextarea}
      >
        <textarea
          ref={(r: TextareaRenderable) => {
            textareaRef = r
            // Set initial value when ref is available
            if (r && props.initialPrompt) {
              r.setText(props.initialPrompt)
              setIsInitialized(true)
            }
            // Focus after a delay
            setTimeout(() => {
              r?.focus()
              r?.gotoLineEnd()
            }, 100)
          }}
          initialValue={props.initialPrompt}
          onContentChange={(e: any) => {
            // Pass changes back to parent
            props.onUpdate(e.plainText || "")
          }}
          onMouseDown={focusTextarea}
          onSubmit={() => props.onSubmit?.()}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
          flexGrow={1}
          keyBindings={textareaKeybindings()}
        />
      </box>

      <box paddingTop={1} border={["top"]} borderColor={theme.border}>
        <text fg={theme.success}>👉 Edit above, then press Enter to execute</text>
      </box>
    </box>
  )
}
