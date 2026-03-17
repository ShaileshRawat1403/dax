import { useTheme } from "@tui/context/theme"
import { Show } from "solid-js"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"

export function RefinePane() {
  const { theme } = useTheme()
  const kv = useKV()

  const refinedPrompt = () => kv.get("dax_active_refined_prompt", "")

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
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
        <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
          <text fg={theme.primary} bold>
            ✦ Refine
          </text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "approvals")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>⚠ Approvals</text>
        </box>
      </box>

      <Show when={!refinedPrompt()}>
        <text fg={theme.textMuted}>:: auto-refine standing by. enable and submit a prompt.</text>
      </Show>

      <Show when={refinedPrompt()}>
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.success} bold>
            ✦ Active Refined Execution Context
          </text>
          <text fg={theme.textMuted}>DAX is executing with the following augmented parameters:</text>
        </box>
        <box padding={1} border={["left"]} borderColor={theme.accent}>
          <text fg={theme.text} whiteSpace="pre-wrap">
            {refinedPrompt()}
          </text>
        </box>
      </Show>
    </box>
  )
}
