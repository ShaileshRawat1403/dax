import { Show, Switch, Match } from "solid-js"
import type { RenderableStreamItem } from "@/dax/presentation/session-stream"
import type { AssistantMessage, UserMessage } from "@dax-ai/sdk/v2"
import { PhaseRail } from "./phase-rail"
import { RunEventRow } from "./run-event-row"
import { AlertInline } from "./alert-inline"

export function StreamItem(props: {
  item: RenderableStreamItem
  expanded: boolean
  onTogglePhase: () => void
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
        />
      </Match>

      <Match when={props.item.kind === "run.event"}>
        <Show when={props.expanded}>
          <RunEventRow item={props.item} />
        </Show>
      </Match>

      <Match when={props.item.kind === "alert.inline"}>
        <AlertInline item={props.item} />
      </Match>

      <Match when={props.item.kind === "message.user"}>
        <props.MessageComponent message={props.item.data as UserMessage} last={false} />
      </Match>

      <Match when={props.item.kind === "message.assistant"}>
        <props.MessageComponent message={props.item.data as AssistantMessage} last={false} />
      </Match>
    </Switch>
  )
}

function MessagePlaceholder(props: { message: AssistantMessage | UserMessage; last: boolean }) {
  return (
    <box paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={1}>
      <text fg="$text">[{props.message.role} message - use existing Message component]</text>
    </box>
  )
}
