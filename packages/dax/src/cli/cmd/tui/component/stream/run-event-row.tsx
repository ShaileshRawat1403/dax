import { Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RenderableStreamItem, formatDuration, stripInlineMarkdown } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"

function getEventIcon(status: "pending" | "active" | "completed" | "failed"): string {
  switch (status) {
    case "active":
      return "●"
    case "completed":
      return "✓"
    case "failed":
      return "✗"
    case "pending":
    default:
      return "○"
  }
}

export function RunEventRow(props: { item: RenderableStreamItem }) {
  const { theme } = useTheme()
  const status = () => props.item.status ?? "pending"
  const icon = () => getEventIcon(status())
  
  const color = createMemo(() => {
    switch (status()) {
      case "active":
        return theme.primary
      case "completed":
        return theme.success
      case "failed":
        return theme.error
      case "pending":
      default:
        return theme.textMuted
    }
  })

  const isFailed = () => status() === "failed"
  const isActive = () => status() === "active"
  const duration = () => (props.item.durationMs ? formatDuration(props.item.durationMs) : "")
  const label = () => props.item.narrative?.label ?? "Event"
  const sentence = () => stripInlineMarkdown(props.item.narrative?.sentence ?? props.item.message ?? "")
  const next = () => stripInlineMarkdown(props.item.narrative?.next ?? "")

  return (
    <box flexDirection="row" gap={1} alignItems="flex-start" paddingTop={0} paddingBottom={0} paddingLeft={1} paddingRight={2}>
      <box width={2} alignItems="center">
        <text fg={theme.borderSubtle} dim>│</text>
      </box>

      <text fg={color()} attributes={isActive() ? TextAttributes.BOLD : undefined}>
        {icon()}
      </text>

      <box flexDirection="column" flexGrow={1} gap={0}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            {label()}
          </text>
          <Show when={duration()}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              {duration()}
            </text>
          </Show>
        </box>

        <text
          fg={isFailed() ? theme.error : theme.text}
          attributes={isActive() ? TextAttributes.BOLD : undefined}
          wrapMode="word"
        >
          {sentence()}
        </text>

        <Show when={next()}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="word">
            Next: {next()}
          </text>
        </Show>
      </box>
    </box>
  )
}
