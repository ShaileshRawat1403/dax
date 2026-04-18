import { Show, Switch, Match } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { RenderableStreamItem } from "@/dax/presentation/session-stream"
import type { AssistantMessage, UserMessage } from "@dax-ai/sdk/v2"
import { useTheme } from "@tui/context/theme"
import { RunEventRow } from "./run-event-row"
import { AlertInline } from "./alert-inline"

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
        <></>
      </Match>

      <Match when={props.item.kind === "run.event"}>
        <RunEventRow item={props.item} />
      </Match>

      <Match when={props.item.kind === "alert.inline"}>
        <AlertInline item={props.item} onNavigateToApprovals={props.onNavigateToApprovals} />
      </Match>

      <Match when={props.item.kind === "compaction.marker"}>
        <CompactionMarker />
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
  const { theme } = useTheme()
  return (
    <box
      flexShrink={0}
      border={["top"]}
      borderColor={theme.borderSubtle}
      marginTop={1}
      marginBottom={0}
      marginLeft={2}
      marginRight={2}
    />
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

function MessagePlaceholder(props: { message: AssistantMessage | UserMessage; last: boolean; partsOverride?: any[]; suppressHeader?: boolean }) {
  return (
    <box paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={1}>
      <text fg="$text">{`[${props.message.role} message - use existing Message component]`}</text>
    </box>
  )
}
