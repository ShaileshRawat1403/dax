import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import type { ExecutionReflection } from "@/session/state-types"

export function ReflectionPanel(props: { reflection?: ExecutionReflection }) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1} gap={1}>
      <Show
        when={props.reflection}
        fallback={
          <box padding={1}>
            <text fg={theme.textMuted} attributes={TextAttributes.ITALIC}>
              No reflection data available for the current step.
            </text>
          </box>
        }
      >
        <box flexDirection="column" gap={0}>
          <box flexDirection="row" justifyContent="space-between" alignItems="center">
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              UNDERSTOOD
            </text>
            <box
              backgroundColor={props.reflection!.confidence > 0.8 ? theme.success : theme.warning}
              paddingLeft={1}
              paddingRight={1}
              border={["round"]}
              borderColor={theme.borderSubtle}
            >
              <text fg={theme.background}>
                {Math.round(props.reflection!.confidence * 100)}% CONFIDENCE
              </text>
            </box>
          </box>
          <text fg={theme.primary}>{props.reflection!.goal}</text>
        </box>

        <Show when={props.reflection!.assumptions.length > 0}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              ASSUMPTIONS
            </text>
            <For each={props.reflection!.assumptions}>
              {(assumption) => (
                <text fg={theme.text}>• {assumption}</text>
              )}
            </For>
          </box>
        </Show>

        <Show when={props.reflection!.risks.length > 0}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              CONCERNS
            </text>
            <For each={props.reflection!.risks}>
              {(risk) => (
                <box flexDirection="row" gap={1}>
                  <text fg={risk.level === "high" ? theme.error : theme.warning}>
                    [{risk.level.toUpperCase()}]
                  </text>
                  <text fg={theme.text}>{risk.item}</text>
                </box>
              )}
            </For>
          </box>
        </Show>

        <box flexDirection="column" gap={0}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            NEXT MOVE
          </text>
          <box flexDirection="row" gap={1}>
            <text fg={theme.success} attributes={TextAttributes.BOLD}>
              {props.reflection!.decision.toUpperCase()}
            </text>
            <text fg={theme.text}>- {props.reflection!.outcome_expected}</text>
          </box>
        </box>

        <Show when={props.reflection!.verificationPlan.length > 0}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              VERIFICATION PLAN
            </text>
            <For each={props.reflection!.verificationPlan}>
              {(check) => (
                <text fg={theme.textMuted}>□ {check}</text>
              )}
            </For>
          </box>
        </Show>
      </Show>
    </box>
  )
}
