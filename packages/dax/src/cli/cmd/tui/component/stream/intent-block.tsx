import { TextAttributes } from "@opentui/core"
import { type RenderableStreamItem, stripInlineMarkdown } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"

export function IntentBlock(props: { item: RenderableStreamItem }) {
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} marginTop={0} marginBottom={1}>
      <text fg={theme.textMuted} wrapMode="word" attributes={TextAttributes.DIM}>
        {stripInlineMarkdown(props.item.message ?? "")}
      </text>
    </box>
  )
}
