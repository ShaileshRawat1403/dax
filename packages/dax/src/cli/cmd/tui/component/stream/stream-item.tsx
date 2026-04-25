import { Show, Switch, Match } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { type RenderableStreamItem, type RunPhase, getPhaseLabel } from "@/dax/presentation/session-stream"
import type { AssistantMessage, UserMessage } from "@dax-ai/sdk/v2"
import { useTheme } from "@tui/context/theme"
import { RunEventRow } from "./run-event-row"
import { AlertInline } from "./alert-inline"
import { PhaseRail } from "./phase-rail"

export function StreamItem(props: {
  item: RenderableStreamItem
  isLast: boolean
  index: number
  previousItem?: RenderableStreamItem
  allItems?: RenderableStreamItem[]
  onNavigateToApprovals?: () => void
  MessageComponent: typeof MessagePlaceholder
}) {
  const suppressHeader = () => {
    if (props.item.kind !== "message.assistant") return false
    const currAgent = (props.item.data as AssistantMessage).agent
    // Look backward past run.events to find the last assistant message.
    // If it has the same agent, suppress the repeated label — it's the same mode continuing.
    const all = props.allItems
    if (!all) return false
    for (let i = props.index - 1; i >= 0; i--) {
      const prev = all[i]!
      if (prev.kind === "message.assistant") {
        return (prev.data as AssistantMessage).agent === currAgent
      }
      // Stop looking back if we cross a user turn or phase boundary
      if (prev.kind === "message.user" || prev.kind === "phase.marker") break
    }
    return false
  }

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
        <AlertInline item={props.item} onNavigateToApprovals={props.onNavigateToApprovals} isLast={props.isLast} reviewKeyHint="press r" />
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
          suppressHeader={suppressHeader()}
        />
      </Match>
    </Switch>
  )
}

function TurnSeparator() {
  return (
    <box
      flexShrink={0}
      marginTop={2}
      marginBottom={1}
      marginLeft={2}
      marginRight={2}
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
      paddingLeft={2}
      paddingRight={2}
      marginTop={1}
      marginBottom={1}
    >
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
        {props.variant ? `⟳  context compacted · ${props.variant}` : "⟳  context compacted"}
      </text>
    </box>
  )
}

function MessagePlaceholder(props: { message: AssistantMessage | UserMessage; last: boolean; partsOverride?: any[]; suppressHeader?: boolean }) {
  return (
    <box paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={1}>
      <text fg="$text">{`[${props.message.role} message - use existing Message component]`}</text>
    </box>
  )
}
