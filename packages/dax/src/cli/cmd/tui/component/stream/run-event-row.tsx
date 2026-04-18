import { Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RenderableStreamItem, stripInlineMarkdown } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"

export function RunEventRow(props: { item: RenderableStreamItem }) {
  const { theme } = useTheme()
  const status = () => props.item.status ?? "pending"
  const isFailed = () => status() === "failed"
  const isCompleted = () => status() === "completed"
  const sentence = () => stripInlineMarkdown(props.item.narrative?.sentence ?? props.item.message ?? "")
  const type = () => props.item.type ?? ""
  const duration = createMemo(() => {
    if (!props.item.durationMs) return ""
    const ms = props.item.durationMs
    if (ms < 1000) return ""
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`
  })

  // intent.created — render as subtle framing prose, no chrome
  if (type() === "intent.created") {
    return (
      <box paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={0}>
        <text fg={theme.textMuted} wrapMode="word" attributes={TextAttributes.DIM}>
          {sentence()}
        </text>
      </box>
    )
  }

  // run.completed — clean success indicator
  if (type() === "run.completed") {
    return (
      <box
        flexDirection="row"
        gap={1}
        alignItems="flex-start"
        paddingLeft={2}
        paddingRight={2}
        marginTop={1}
        marginBottom={0}
      >
        <text fg={theme.success} flexShrink={0}>✓</text>
        <box flexDirection="row" gap={1} alignItems="center" flexGrow={1}>
          <text fg={theme.textMuted} wrapMode="word">{sentence()}</text>
          <Show when={duration()}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} flexShrink={0}>
              {duration()}
            </text>
          </Show>
        </box>
      </box>
    )
  }

  // step.failed / run.failed — compact inline error row
  if (isFailed()) {
    return (
      <box
        flexDirection="column"
        gap={0}
        paddingLeft={2}
        paddingRight={2}
        marginTop={1}
        marginBottom={0}
      >
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.error} flexShrink={0}>✗</text>
          <text fg={theme.error} attributes={TextAttributes.BOLD}>
            {props.item.narrative?.label ?? "Failed"}
          </text>
        </box>
        <Show when={sentence()}>
          <box paddingLeft={2}>
            <text fg={theme.textMuted} wrapMode="word">{sentence()}</text>
          </box>
        </Show>
      </box>
    )
  }

  // default — compact tool-style row matching ⏺ chrome
  const isPending = () => !isCompleted() && !isFailed()
  return (
    <box flexDirection="column" gap={0} paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={0}>
      <box flexDirection="row" gap={1} alignItems="center">
        <Show
          when={isCompleted()}
          fallback={<Spinner color={theme.textMuted} />}
        >
          <text fg={theme.success} flexShrink={0}>⏺</text>
        </Show>
        <Show when={sentence()}>
          <text fg={theme.textMuted} wrapMode="word">{sentence()}</text>
        </Show>
      </box>
    </box>
  )
}
