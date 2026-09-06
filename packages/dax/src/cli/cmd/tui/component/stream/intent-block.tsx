import { type RenderableStreamItem, stripInlineMarkdown } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"
import { STREAM_INDENT } from "./layout"

export function IntentBlock(props: { item: RenderableStreamItem }) {
  const { theme } = useTheme()

  return (
    <box paddingLeft={STREAM_INDENT.content} paddingRight={STREAM_INDENT.content} marginTop={0} marginBottom={1}>
      <text fg={theme.textMuted} wrapMode="word">
        {stripInlineMarkdown(props.item.message ?? "")}
      </text>
    </box>
  )
}
