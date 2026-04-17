import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme, tint } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"
import { isEli12Mode } from "@/dax/intent"
import type { PersonaPack } from "@/dax/presentation/persona"
import { nextDisplayMode, type DisplayMode } from "@/dax/presentation/session-display"
import { Spinner } from "@tui/component/spinner"

type HeaderAction = {
  label: string
  onPress: () => void
  primary?: boolean
}

export function Header(props: {
  sessionLabel?: string
  lifecycle?: string
  lifecycleLabel?: string
  decisionState?: string
  persona?: PersonaPack
  currentStep?: string
  trustLabel?: string
  trustPosture?: string
  pendingApprovals?: number
  verificationStatus?: string
  emphasis?: "normal" | "muted"
  actions?: HeaderAction[]
  busy?: boolean
  onCyclePersona?: () => void
  contextPercent?: number
}) {
  const kv = useKV()
  const { theme } = useTheme()

  const [displayMode, setDisplayMode] = kv.signal<DisplayMode>(DAX_SETTING.display_mode, "operator")
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const cycleDisplayMode = () => {
    setDisplayMode(() => nextDisplayMode(displayMode()))
  }

  // Animated DAX logo (only shown when no persona is set)
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTick((t) => (t + 1) % 10), 140)
    onCleanup(() => clearInterval(timer))
  })

  const letters = ["D", "A", "X"]
  const letterColor = (index: number) => {
    const palette = [theme.primary, theme.accent, theme.secondary]
    return palette[(tick() + index) % palette.length] ?? theme.primary
  }
  const letterWeight = (index: number) => ((tick() + index) % 5 === 0 ? TextAttributes.BOLD : undefined)

  const lifecycleColor = createMemo(() => {
    const label = props.lifecycleLabel ?? ""
    if (/approval/i.test(label)) return theme.warning
    if (/blocked|failed/i.test(label)) return theme.error
    if (/completed|ready/i.test(label)) return theme.success
    return theme.accent
  })
  const showLifecycleChip = createMemo(
    () => !!props.lifecycleLabel && props.lifecycleLabel.toLowerCase() !== "idle" && props.emphasis === "normal",
  )
  const showDecisionChip = createMemo(() => {
    if (!props.decisionState || props.emphasis === "muted") return false
    const lifecycle = (props.lifecycleLabel ?? "").toLowerCase().trim()
    const decision = props.decisionState.toLowerCase().trim()
    if (!decision) return false
    if (lifecycle && lifecycle === decision) return false
    return true
  })

  const baseDecisionColor = createMemo(() => {
    const state = props.decisionState?.toLowerCase() ?? ""
    if (state === "critiquing" || state === "interpreting") return theme.accent
    if (state === "verifying") return theme.secondary
    if (state === "executing") return theme.primary
    if (state === "recovering") return theme.warning
    return theme.textMuted
  })

  // Pulse the decision label briefly when state changes
  const [pulsing, setPulsing] = createSignal(false)
  createEffect(() => {
    const _ = props.decisionState
    setPulsing(true)
    const t = setTimeout(() => setPulsing(false), 800)
    onCleanup(() => clearTimeout(t))
  })
  const decisionColor = createMemo(() => (pulsing() ? theme.text : baseDecisionColor()))

  const personaLabel = createMemo(() => {
    if (!props.persona || !props.decisionState) return props.decisionState
    const state = props.decisionState.toLowerCase().split(" ")[0]!
    return props.persona.ui.statusLabels[state] ?? props.decisionState
  })

  return (
    <box flexShrink={0} backgroundColor={theme.background} border={["bottom"]} borderColor={theme.borderSubtle}>
      <box
        paddingTop={0.5}
        paddingBottom={0.5}
        paddingLeft={1}
        paddingRight={1}
        flexShrink={0}
        flexDirection="column"
        gap={0}
      >
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          {/* Left: persona/logo + lifecycle chip + decision chip with spinner */}
          <box flexDirection="row" gap={1} alignItems="center">
            <Show
              when={props.persona}
              fallback={
                <For each={letters}>
                  {(letter, index) => (
                    <text fg={letterColor(index())} attributes={letterWeight(index())}>
                      {letter}
                    </text>
                  )}
                </For>
              }
            >
              <box
                onMouseUp={() => props.onCyclePersona?.()}
                flexDirection="row"
                alignItems="center"
                gap={1}
                paddingLeft={1}
                paddingRight={1}
                border={["round"]}
                borderColor={theme.borderSubtle}
              >
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                  {props.persona!.ui.glyph}
                </text>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {props.persona!.label.toUpperCase()}
                </text>
              </box>
            </Show>

            <Show when={showLifecycleChip()}>
              <box
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={lifecycleColor()}>{props.lifecycleLabel?.toUpperCase()}</text>
              </box>
            </Show>

            <Show when={showDecisionChip()}>
              <box
                flexDirection="row"
                alignItems="center"
                gap={1}
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={pulsing() ? theme.borderActive : theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <Show when={props.busy}>
                  <Spinner color={baseDecisionColor()} />
                </Show>
                <text fg={decisionColor()} attributes={TextAttributes.BOLD}>
                  {personaLabel()?.toUpperCase()}
                </text>
              </box>
            </Show>
          </box>

          {/* Right: session context */}
          <box flexDirection="row" gap={1} alignItems="center">
            <Show when={props.contextPercent !== undefined}>
              <box
                flexDirection="row"
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={props.contextPercent! > 80 ? theme.warning : theme.textMuted}>
                  ctx:{props.contextPercent}%
                </text>
              </box>
            </Show>
            <Show when={props.actions?.length}>
              <box flexDirection="row" gap={1} alignItems="center">
                <For each={props.actions}>
                  {(action) => (
                    <box
                      onMouseUp={action.onPress}
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={action.primary ? theme.primary : theme.backgroundElement}
                      border={["round"]}
                      borderColor={action.primary ? theme.borderActive : theme.borderSubtle}
                    >
                      <text fg={action.primary ? theme.background : theme.textMuted}>{action.label}</text>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </box>
        </box>

        {/* Trust / approvals / verification row */}
        <Show when={props.trustPosture !== undefined || props.pendingApprovals !== undefined}>
          <box flexDirection="row" alignItems="center" gap={1} marginTop={0} marginBottom={0}>
            <Show when={props.trustPosture}>
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={
                  props.trustPosture === "blocked"
                    ? theme.error
                    : props.trustPosture === "review_needed"
                      ? theme.warning
                      : theme.success
                }
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.textMuted}>Trust:</text>
                <text
                  fg={
                    props.trustPosture === "blocked"
                      ? theme.error
                      : props.trustPosture === "review_needed"
                        ? theme.warning
                        : theme.success
                  }
                  attributes={TextAttributes.BOLD}
                >
                  {props.trustPosture === "blocked"
                    ? "BLOCKED"
                    : props.trustPosture === "review_needed"
                      ? "REVIEW"
                      : "CLEAR"}
                </text>
              </box>
            </Show>
            <Show when={props.pendingApprovals !== undefined && props.pendingApprovals > 0}>
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={tint(theme.background, theme.warning, 0.15)}
                border={["round"]}
                borderColor={theme.warning}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                  {props.pendingApprovals!} APPROVAL
                  {props.pendingApprovals! > 1 ? "S" : ""} PENDING
                </text>
              </box>
            </Show>
            <Show when={props.verificationStatus}>
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.textMuted}>Verification:</text>
                <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
                  {props.verificationStatus?.toUpperCase()}
                </text>
              </box>
            </Show>
          </box>
        </Show>
      </box>
    </box>
  )
}
