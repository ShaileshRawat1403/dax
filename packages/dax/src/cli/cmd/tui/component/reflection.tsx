import { For, Show } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import type { ExecutionReflection } from "@/session/state-types"
import { createHistoricalReflectionSummary } from "@/session/reflection-pruning"

export function ReflectionPanel(props: { reflection?: ExecutionReflection; history?: ExecutionReflection[] }) {
  const { theme } = useTheme()
  const history = () => createHistoricalReflectionSummary(props.history ?? [])

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

        <Show when={props.reflection!.requiresApproval}>
          <box 
            backgroundColor={tint(theme.warning, theme.background, 0.15)} 
            padding={1} 
            border={["round", "double"]} 
            borderColor={theme.warning}
          >
            <text fg={theme.warning} attributes={TextAttributes.BOLD}>
              ⚠ REQUIRES OPERATOR APPROVAL
            </text>
            <text fg={theme.text} wrapMode="word">
              This move has significant impact or risk. Review the plan before granting permission.
            </text>
          </box>
        </Show>

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

        <Show when={props.reflection!.justification}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.success} attributes={TextAttributes.BOLD}>
              PATH RATIONALE
            </text>
            <text fg={theme.text} wrapMode="word">
              {props.reflection!.justification}
            </text>
          </box>
        </Show>

        <Show when={props.reflection!.ambiguities.length > 0}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.warning} attributes={TextAttributes.BOLD}>
              AMBIGUITIES
            </text>
            <For each={props.reflection!.ambiguities}>
              {(item) => (
                <text fg={theme.text}>? {item}</text>
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

        <Show when={props.reflection!.alternatives.length > 0}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              ALTERNATIVES CONSIDERED
            </text>
            <For each={props.reflection!.alternatives}>
              {(alt) => (
                <box flexDirection="column" paddingLeft={1}>
                  <text fg={theme.text}>• {alt.path}</text>
                  <text fg={theme.textMuted} dim>  {alt.tradeoff}</text>
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

        <Show when={history().length > 1}>
          <box flexDirection="column" gap={0}>
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              RECENT CHECKPOINTS
            </text>
            <For each={history().slice(0, -1)}>
              {(item) => (
                <box flexDirection="row" justifyContent="space-between" gap={1}>
                  <text fg={item.requiresApproval ? theme.warning : theme.textMuted} wrapMode="truncate-end">
                    {item.decision.toUpperCase()} · {item.goal}
                  </text>
                  <text fg={theme.textMuted}>
                    {Math.round(item.confidence * 100)}%
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </Show>
    </box>
  )
}
