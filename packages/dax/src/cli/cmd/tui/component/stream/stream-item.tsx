import { Show, Switch, Match } from "solid-js"
import { type RenderableStreamItem, type RunPhase, getPhaseLabel } from "@/dax/presentation/session-stream"
import type { AssistantMessage, UserMessage } from "@dax-ai/sdk/v2"
import { useTheme } from "@tui/context/theme"
import { RunEventRow } from "./run-event-row"
import { AlertInline } from "./alert-inline"
import { PhaseRail } from "./phase-rail"
import { STREAM_INDENT } from "./layout"

export function StreamItem(props: {
  item: RenderableStreamItem
  isLast: boolean
  index: number
  MessageComponent: typeof MessagePlaceholder
}) {
  return (
    <Switch>
      <Match when={props.item.kind === "phase.marker"}>
        <PhaseRail
          phase={(props.item.phase ?? "executing") as RunPhase}
          label={getPhaseLabel((props.item.phase ?? "executing") as RunPhase)}
          status={props.item.status ?? "completed"}
          stepCount={props.item.phaseStepCount}
          durationMs={props.item.durationMs}
        />
      </Match>

      <Match when={props.item.kind === "run.event"}>
        <RunEventRow item={props.item} isLast={props.isLast} />
      </Match>

      <Match when={props.item.kind === "alert.inline"}>
        <AlertInline item={props.item} isLast={props.isLast} reviewKeyHint="press r" />
      </Match>

      <Match when={props.item.kind === "compaction.marker"}>
        <CompactionMarker variant={props.item.message} />
      </Match>

      <Match when={props.item.kind === "message.user"}>
        <Show when={props.index > 0}>
          <TurnSeparator />
        </Show>
        <props.MessageComponent message={props.item.data as UserMessage} last={props.isLast} partsOverride={props.item.parts} />
      </Match>

      <Match when={props.item.kind === "message.assistant"}>
        <props.MessageComponent
          message={props.item.data as AssistantMessage}
          last={props.isLast}
          partsOverride={props.item.parts}
          suppressHeader={props.item.suppressHeader}
        />
      </Match>
    </Switch>
  )
}

/**
 * The boundary between one turn and the next.
 *
 * This used to be an empty box with margins, so the most important division in
 * the stream was three blank lines that looked like every other gap. A rule
 * costs one line and makes the turn structure scannable.
 */
function TurnSeparator() {
  const { theme } = useTheme()
  return (
    <box
      flexShrink={0}
      marginTop={1}
      marginBottom={1}
      marginLeft={STREAM_INDENT.structure}
      marginRight={STREAM_INDENT.structure}
      border={["top"]}
      borderColor={theme.border}
    />
  )
}

function CompactionMarker(props: { variant?: string }) {
  const { theme } = useTheme()
  return (
    <box
      flexDirection="row"
      gap={1}
      alignItems="center"
      paddingLeft={STREAM_INDENT.content}
      paddingRight={STREAM_INDENT.content}
      marginTop={1}
      marginBottom={1}
    >
      <text fg={theme.textMuted}>
        {props.variant ? `context compacted · ${props.variant}` : "context compacted"}
      </text>
    </box>
  )
}

function MessagePlaceholder(props: { message: AssistantMessage | UserMessage; last: boolean; partsOverride?: any[]; suppressHeader?: boolean }) {
  return (
    <box paddingLeft={STREAM_INDENT.content} paddingRight={STREAM_INDENT.content} marginTop={1} marginBottom={1}>
      <text fg="$text">{`[${props.message.role} message - use existing Message component]`}</text>
    </box>
  )
}
