import { Show, Switch, Match } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { RenderableStreamItem } from "@/dax/presentation/session-stream"
import type { AssistantMessage, UserMessage } from "@dax-ai/sdk/v2"
import { useTheme } from "@tui/context/theme"
import { PhaseRail } from "./phase-rail"
import { RunEventRow } from "./run-event-row"
import { AlertInline } from "./alert-inline"
import { IntentBlock } from "./intent-block"

export function StreamItem(props: {
  item: RenderableStreamItem
  expanded: boolean
  isLast: boolean
  onTogglePhase: () => void
  onNavigateToApprovals?: () => void
  MessageComponent: typeof MessagePlaceholder
}) {
  return (
    <Switch>
      <Match when={props.item.kind === "phase.marker"}>
        <PhaseRail
          phase={props.item.phase!}
          label={props.item.message ?? ""}
          status={props.item.status ?? "pending"}
          expanded={props.expanded}
          onToggle={props.onTogglePhase}
          stepCount={props.item.phaseStepCount}
          durationMs={props.item.durationMs}
        />
      </Match>

      <Match when={props.item.kind === "run.event"}>
        <Show when={props.expanded}>
          <Switch fallback={<RunEventRow item={props.item} />}>
            <Match when={props.item.type === "intent.created"}>
              <IntentBlock item={props.item} />
            </Match>
          </Switch>
        </Show>
      </Match>

      <Match when={props.item.kind === "alert.inline"}>
        <AlertInline item={props.item} onNavigateToApprovals={props.onNavigateToApprovals} />
      </Match>

      <Match when={props.item.kind === "compaction.marker"}>
        <CompactionMarker />
      </Match>

      <Match when={props.item.kind === "message.user"}>
        <props.MessageComponent message={props.item.data as UserMessage} last={props.isLast} partsOverride={props.item.parts} />
      </Match>

      <Match when={props.item.kind === "message.assistant"}>
        <props.MessageComponent
          message={props.item.data as AssistantMessage}
          last={props.isLast}
          partsOverride={props.item.parts}
        />
      </Match>
    </Switch>
  )
}

function CompactionMarker() {
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
      <text fg={theme.borderSubtle}>────</text>
      <text fg={theme.textMuted} attributes={TextAttributes.DIM}>⟳ context compacted</text>
      <text fg={theme.borderSubtle}>────</text>
    </box>
  )
}

function MessagePlaceholder(props: { message: AssistantMessage | UserMessage; last: boolean; partsOverride?: any[] }) {
  return (
    <box paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={1}>
      <text fg="$text">{`[${props.message.role} message - use existing Message component]`}</text>
    </box>
  )
}
