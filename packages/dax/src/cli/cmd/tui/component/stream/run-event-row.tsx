import { Show, createMemo } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RenderableStreamItem, stripInlineMarkdown } from "@/dax/presentation/session-stream"
import { useTheme } from "@tui/context/theme"
import { Spinner } from "@tui/component/spinner"

export function RunEventRow(props: { item: RenderableStreamItem; isLast?: boolean }) {
  const { theme } = useTheme()
  const baseTextColor = () => props.isLast ? theme.text : theme.textMuted
  const status = () => props.item.status ?? "pending"
  const isFailed = () => status() === "failed"
  const isCompleted = () => status() === "completed"
  const sentence = () => stripInlineMarkdown(props.item.narrative?.sentence ?? props.item.message ?? "")
  const type = () => props.item.type ?? ""
  const duration = createMemo(() => {
    if (!props.item.durationMs) return ""
    const ms = props.item.durationMs
    if (ms < 1000) return `${ms}ms`
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

  // default — single muted prose row. Tool execution chrome belongs to ToolPart;
  // narrative run.events here are intentionally lightweight to avoid duplicating it.
  const isPending = () => !isCompleted() && !isFailed()
  return (
    <box flexDirection="row" gap={1} alignItems="center" paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={0}>
      <Show when={isPending()} fallback={<text fg={theme.textMuted} flexShrink={0}>·</text>}>
        <Spinner color={theme.textMuted} />
      </Show>
      <Show when={sentence()}>
        <text fg={baseTextColor()} wrapMode="word" attributes={TextAttributes.DIM}>{sentence()}</text>
      </Show>
      <Show when={duration()}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM} flexShrink={0}>{duration()}</text>
      </Show>
    </box>
  )
}
