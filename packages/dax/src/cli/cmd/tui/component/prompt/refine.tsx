import { useTheme } from "@tui/context/theme"
import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { createSignal } from "solid-js"

export function RefinePane(props: { initialPrompt: string; onUpdate: (prompt: string) => void }) {
  const { theme } = useTheme()
  let textarea: TextareaRenderable
  const [debug, setDebug] = createSignal("")

  // Debug: show what's being passed
  const displayContent = () => {
    const content = props.initialPrompt || ""
    setDebug(`Content length: ${content.length}, First 50: ${content.slice(0, 50)}`)

    if (content && content.length > 0) {
      return content
    }
    return `## 🎯 Goal
Type your goal here

## 📋 Execution Plan
1. Step one
2. Step two  
3. Step three

## ✅ Success Criteria
- Criterion 1
- Criterion 2

## ⚙️ Constraints & Requirements
- Constraint 1

---
_Click Refine Current to generate a structured contract_`
  }

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1}>
      <box flexDirection="column" gap={0} paddingBottom={1} border={["bottom"]} borderColor={theme.border}>
        <text fg={theme.accent} bold>
          ✦ STRUCTURED EXECUTION CONTRACT
        </text>
        <text fg={theme.error}>({debug()})</text>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          Review and edit before execution.
        </text>
      </box>

      <box flexGrow={1} flexDirection="column" marginTop={1} border={["all"]} borderColor={theme.accent} padding={1}>
        <textarea
          ref={(r: TextareaRenderable) => (textarea = r)}
          value={displayContent()}
          onContentChange={() => props.onUpdate(textarea.plainText)}
          textColor={theme.text}
          focusedTextColor={theme.text}
          flexGrow={1}
        />
      </box>

      <box paddingTop={1} border={["top"]} borderColor={theme.border}>
        <text fg={theme.success}>👉 Press Enter to execute</text>
      </box>
    </box>
  )
}
