import { useTheme } from "@tui/context/theme"
import { For, Show } from "solid-js"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"

export type ApprovalItem = {
  id: string
  tool: string
  command: string
  reason: string
}

export function ApprovalsPane(props: { approvals: ApprovalItem[] }) {
  const { theme } = useTheme()
  const kv = useKV()

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
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "plan")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>❖ Plan</text>
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
        <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
          <text fg={theme.warning} bold>
            ⚠ Approvals
          </text>
        </box>
      </box>

      <Show when={props.approvals.length === 0}>
        <text fg={theme.textMuted}>:: system clear (0 pending)</text>
      </Show>

      <For each={props.approvals}>
        {(item) => (
          <box
            flexDirection="column"
            marginBottom={1}
            border={["top", "bottom", "left", "right"]}
            borderColor={theme.warning}
            padding={1}
          >
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.warning} bold>
                ⚠ Action Required
              </text>
              <text fg={theme.textMuted}>{item.tool}</text>
            </box>
            <text fg={theme.textMuted}>Reason: {item.reason}</text>
            <box marginTop={1} padding={1} backgroundColor={theme.backgroundElement}>
              <text fg={theme.text}>{item.command}</text>
            </box>
          </box>
        )}
      </For>
    </box>
  )
}
