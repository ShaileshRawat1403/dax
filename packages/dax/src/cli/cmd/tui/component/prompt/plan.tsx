import { useTheme } from "@tui/context/theme"
import { For, Show } from "solid-js"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"

export type PlanItem = {
  id: string
  title: string
  status: "pending" | "running" | "completed" | "failed"
}

export function PlanPane(props: { plan: PlanItem[] }) {
  const { theme } = useTheme()
  const kv = useKV()

  const getStatusIcon = (status: PlanItem["status"]) => {
    switch (status) {
      case "completed":
        return <text fg={theme.success}>[x]</text>
      case "running":
        return <text fg={theme.primary}>&gt;&gt;</text>
      case "failed":
        return <text fg={theme.error}>[!]</text>
      default:
        return <text fg={theme.textMuted}>[ ]</text>
    }
  }

  return (
    <box flexDirection="column" width="100%" height="100%" paddingLeft={1} paddingRight={1}>
      <box
        flexDirection="row"
        border={["bottom"]}
        borderColor={theme.border}
        paddingBottom={1}
        marginBottom={1}
        gap={2}
      >
        <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
          <text fg={theme.primary} bold>
            ❖ Plan
          </text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "artifacts")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>📦 Artifacts</text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "audit")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>🛡️ Audit</text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "refine")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>✦ Refine</text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "approvals")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>⚠ Approvals</text>
        </box>
      </box>

      <Show when={props.plan.length === 0}>
        <text fg={theme.textMuted}>:: no active runbook</text>
      </Show>

      <For each={props.plan}>
        {(item) => (
          <box flexDirection="row" gap={1} marginBottom={1}>
            {getStatusIcon(item.status)}
            <text fg={item.status === "completed" ? theme.textMuted : theme.text}>{item.title}</text>
          </box>
        )}
      </For>
    </box>
  )
}
