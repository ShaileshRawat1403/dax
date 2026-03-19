import { useTheme } from "@tui/context/theme"
import { For, Show } from "solid-js"

export type AuditLogEntry = {
  commandText: string
  createdAt: number
  result?: {
    profile: "strict" | "balanced" | "advisory"
    status: "pass" | "warn" | "fail"
    summary: {
      blocker_count: number
      warning_count: number
      info_count: number
    }
    next_actions: string[]
  }
}

function formatAuditTime(timestamp: number) {
  const date = new Date(timestamp)
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function countLabel(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`
}

export function AuditLogPane(props: { history: AuditLogEntry[]; latest?: AuditLogEntry }) {
  const { theme } = useTheme()

  const latest = () => props.latest?.result

  const statusColor = (status: "pass" | "warn" | "fail") => {
    switch (status) {
      case "pass":
        return theme.success
      case "warn":
        return theme.warning
      case "fail":
        return theme.error
    }
  }

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1}>
      <text fg={theme.primary} bold>
        Audit snapshot
      </text>
      <Show when={latest()} fallback={<text fg={theme.textMuted}>:: no audit run recorded in this session</text>}>
        {(audit) => (
            <box flexDirection="column" gap={1}>
            <box
              flexDirection="column"
              gap={1}
              border={["round"]}
              borderColor={theme.borderSubtle}
              paddingLeft={1}
              paddingRight={1}
              paddingTop={0}
              paddingBottom={0}
            >
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Latest snapshot</text>
                <text fg={statusColor(audit().status)} bold>
                  {audit().status.toUpperCase()}
                </text>
              </box>
              <Show when={props.latest}>
                {(entry) => (
                  <box flexDirection="row" gap={1} flexWrap="wrap">
                    <text fg={theme.text}>{entry().commandText || "/audit"}</text>
                    <text fg={theme.textMuted}>·</text>
                    <text fg={theme.textMuted}>{formatAuditTime(entry().createdAt)}</text>
                  </box>
                )}
              </Show>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <text fg={theme.text}>Profile {audit().profile}</text>
                <text fg={theme.textMuted}>·</text>
                <text fg={theme.error}>{countLabel(audit().summary.blocker_count, "blocker")}</text>
                <text fg={theme.warning}>{countLabel(audit().summary.warning_count, "warning")}</text>
                <text fg={theme.textMuted}>{countLabel(audit().summary.info_count, "info")}</text>
              </box>
            </box>

            <Show when={audit().next_actions.length > 0}>
              <box
                flexDirection="column"
                gap={0}
                marginBottom={1}
                paddingLeft={1}
                border={["left"]}
                borderColor={theme.borderSubtle}
              >
                <text fg={theme.textMuted}>Next actions</text>
                <For each={audit().next_actions.slice(0, 4)}>
                  {(action) => <text fg={theme.text}>• {action}</text>}
                </For>
              </box>
            </Show>

            <box flexDirection="column" gap={1}>
              <text fg={theme.textMuted}>Recent audit runs</text>
              <For each={props.history.slice().reverse()}>
                {(entry) => (
                  <box
                    flexDirection="column"
                    gap={0}
                    paddingLeft={1}
                    border={["left"]}
                    borderColor={entry.result ? statusColor(entry.result.status) : theme.border}
                  >
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.text}>{entry.commandText || "/audit"}</text>
                      <text fg={theme.textMuted}>{formatAuditTime(entry.createdAt)}</text>
                    </box>
                    <Show
                      when={entry.result}
                      fallback={<text fg={theme.textMuted}>Waiting for structured audit result</text>}
                    >
                      {(result) => (
                        <box flexDirection="row" gap={1} flexWrap="wrap">
                          <text fg={statusColor(result().status)}>{result().status.toUpperCase()}</text>
                          <text fg={theme.textMuted}>profile {result().profile}</text>
                          <text fg={theme.error}>{countLabel(result().summary.blocker_count, "blocker")}</text>
                          <text fg={theme.warning}>{countLabel(result().summary.warning_count, "warning")}</text>
                          <text fg={theme.textMuted}>{countLabel(result().summary.info_count, "info")}</text>
                        </box>
                      )}
                    </Show>
                  </box>
                )}
              </For>
            </box>
          </box>
        )}
      </Show>
    </box>
  )
}
