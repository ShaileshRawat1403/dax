import { TextAttributes } from "@opentui/core"
import type { RenderableStreamItem } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
}

export function IntentBlock(props: { item: RenderableStreamItem }) {
  const { theme } = useTheme()

  return (
    <box
      flexDirection="column"
      gap={0}
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={4}
      paddingRight={2}
      marginTop={0}
      marginBottom={0}
      border={["left"]}
      borderColor={theme.accent}
    >
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
        UNDERSTOOD
      </text>
      <text fg={theme.text} wrapMode="word">
        {stripInlineMarkdown(props.item.message ?? "")}
      </text>
    </box>
  )
}
