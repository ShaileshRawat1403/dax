import { useTheme } from "@tui/context/theme"
import { TextareaRenderable, TextAttributes } from "@opentui/core"

export function RefinePane(props: { initialPrompt: string; onUpdate: (prompt: string) => void }) {
  const { theme } = useTheme()
  let textarea: TextareaRenderable

  const displayContent = () => {
    if (props.initialPrompt && props.initialPrompt.length > 0) {
      return props.initialPrompt
    }
    return `## 🎯 Goal
[Your refined goal will appear here]

## 📋 Execution Plan
1. Step one
2. Step two
3. Step three

## ✅ Success Criteria
- [Success criterion 1]
- [Success criterion 2]

## ⚙️ Constraints & Requirements
- [Constraint 1]
- [Constraint 2]

---
_Click Refine Current to generate a structured contract, or type your prompt and press Enter to execute._`
  }

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1}>
      <box flexDirection="column" gap={0} paddingBottom={1} border={["bottom"]} borderColor={theme.border}>
        <text fg={theme.accent} bold>
          ✦ STRUCTURED EXECUTION CONTRACT
        </text>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          Review and edit the optimized plan before execution.
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
        <text fg={theme.success}>
          👉 Press <span style={{ fg: theme.text, bold: true }}>Enter</span> in the prompt box to start this mission.
        </text>
      </box>
    </box>
  )
}
