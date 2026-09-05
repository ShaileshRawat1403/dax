import { Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RenderableStreamItem, stripInlineMarkdown, formatDuration } from "@/dax/presentation/session-stream"
import { statusGlyph } from "@/dax/presentation/status-glyph"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"
import { STREAM_INDENT } from "./layout"

/**
 * A run event is one line of the agent's narration.
 *
 * Two rules hold here. Nothing carrying a sentence is dimmed: `textMuted` with
 * the terminal DIM attribute on top measures 2.2:1 against the default theme,
 * which is below even the large-text floor, and this is the text the operator
 * is here to read. And history keeps the same weight as the newest row, because
 * a log you cannot scroll back through is not a log.
 */
export function RunEventRow(props: { item: RenderableStreamItem; isLast?: boolean }) {
  const { theme } = useTheme()
  const status = () => props.item.status ?? "pending"
  const isFailed = () => status() === "failed"
  const isCompleted = () => status() === "completed"
  const sentence = () => stripInlineMarkdown(props.item.narrative?.sentence ?? props.item.message ?? "")
  const type = () => props.item.type ?? ""
  const duration = () => (props.item.durationMs ? formatDuration(props.item.durationMs) : "")

  // intent.created — framing prose, no chrome, but still readable.
  if (type() === "intent.created") {
    return (
      <box paddingLeft={STREAM_INDENT.content} paddingRight={STREAM_INDENT.content} marginTop={1} marginBottom={0}>
        <text fg={theme.textMuted} wrapMode="word">
          {sentence()}
        </text>
      </box>
    )
  }

  if (type() === "run.completed") {
    return (
      <box
        flexDirection="row"
        gap={1}
        alignItems="flex-start"
        paddingLeft={STREAM_INDENT.content}
        paddingRight={STREAM_INDENT.content}
        marginTop={1}
        marginBottom={0}
      >
        <text fg={theme.success} flexShrink={0}>
          {statusGlyph("completed")}
        </text>
        <box flexDirection="row" gap={1} alignItems="center" flexGrow={1}>
          <text fg={theme.text} wrapMode="word">
            {sentence()}
          </text>
          <Show when={duration()}>
            <text fg={theme.textMuted} flexShrink={0}>
              {duration()}
            </text>
          </Show>
        </box>
      </box>
    )
  }

  if (isFailed()) {
    return (
      <box
        flexDirection="column"
        gap={0}
        paddingLeft={STREAM_INDENT.content}
        paddingRight={STREAM_INDENT.content}
        marginTop={1}
        marginBottom={0}
      >
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.error} flexShrink={0}>
            {statusGlyph("failed")}
          </text>
          <text fg={theme.error} attributes={TextAttributes.BOLD}>
            {props.item.narrative?.label ?? "Failed"}
          </text>
        </box>
        <Show when={sentence()}>
          <box paddingLeft={STREAM_INDENT.content}>
            <text fg={theme.text} wrapMode="word">
              {sentence()}
            </text>
          </box>
        </Show>
      </box>
    )
  }

  // default — one narration row. Tool execution chrome belongs to ToolPart;
  // narrative run.events stay lightweight to avoid duplicating it.
  const isPending = () => !isCompleted() && !isFailed()
  return (
    <box
      flexDirection="row"
      gap={1}
      alignItems="center"
      paddingLeft={STREAM_INDENT.content}
      paddingRight={STREAM_INDENT.content}
      marginTop={1}
      marginBottom={0}
    >
      <Show
        when={isPending()}
        fallback={
          <text fg={theme.success} flexShrink={0}>
            {statusGlyph("completed")}
          </text>
        }
      >
        <Spinner color={theme.primary} />
      </Show>
      <Show when={sentence()}>
        <text fg={theme.text} wrapMode="word">
          {sentence()}
        </text>
      </Show>
      <Show when={duration()}>
        <text fg={theme.textMuted} flexShrink={0}>
          {duration()}
        </text>
      </Show>
    </box>
  )
}
