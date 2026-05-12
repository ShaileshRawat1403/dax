import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes, type RGBA } from "@opentui/core"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"
import { isEli12Mode } from "@/dax/intent"
import type { PersonaPack } from "@/dax/presentation/persona"
import { nextDisplayMode, type DisplayMode } from "@/dax/presentation/session-display"
import type { HeaderProjection, HeaderState } from "@/dax/presentation/ui-state-resolver"
import { Spinner } from "@tui/component/spinner"

type HeaderAction = {
  label: string
  onPress: () => void
  primary?: boolean
}

// DAX UI Interaction Contract v0.1 — Header is a dumb consumer of
// HeaderProjection. It does not own lifecycle, decision, trust, or approval
// display decisions. See docs/dax/ui-interaction-contract.md Section 1.
export function Header(props: {
  headerProjection?: HeaderProjection
  persona?: PersonaPack
  emphasis?: "normal" | "muted"
  actions?: HeaderAction[]
  busy?: boolean
  onCyclePersona?: () => void
  contextPercent?: number
}) {
  const kv = useKV()
  const { theme } = useTheme()

  const [displayMode, setDisplayMode] = kv.signal<DisplayMode>(DAX_SETTING.display_mode, "operator")
  const _explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const _cycleDisplayMode = () => {
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

  // Color mapping for the single projection-driven chip. Palette is
  // explicitly a contract non-goal, but mapping by state class produces
  // consistent perception across surfaces:
  //   error  = cannot proceed / failure
  //   warning = waiting / delayed / operator attention
  //   success = completed
  //   accent  = active work
  //   muted   = idle
  const projectionColor = createMemo(() => {
    const state = props.headerProjection?.state
    if (!state) return theme.textMuted
    return chipColorForState(state, theme)
  })

  const showProjectionChip = createMemo(
    () => !!props.headerProjection && props.emphasis !== "muted",
  )

  // Spinner shows only when the caller says we're busy AND the projection
  // indicates an active, in-flight run state. Spinner is presentational
  // motion, not display truth — it is intentionally NOT derived from the
  // resolver. See Contract Section 6.
  const showSpinner = createMemo(() => {
    if (!props.busy) return false
    const state = props.headerProjection?.state
    return state === "working" || state === "compacting" || state === "resuming"
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
          {/* Left: persona/logo + single projection chip */}
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

            <Show when={showProjectionChip()}>
              <box
                flexDirection="row"
                alignItems="center"
                gap={1}
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={
                  props.headerProjection!.requiresAction ? projectionColor() : theme.borderSubtle
                }
                paddingLeft={1}
                paddingRight={1}
              >
                <Show when={showSpinner()}>
                  <Spinner color={projectionColor()} />
                </Show>
                <text fg={projectionColor()} attributes={TextAttributes.BOLD}>
                  {props.headerProjection!.label}
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
      </box>
    </box>
  )
}

type ChipPalette = {
  error: RGBA
  warning: RGBA
  success: RGBA
  accent: RGBA
  textMuted: RGBA
}

export function chipColorForState(state: HeaderState, theme: ChipPalette): RGBA {
  switch (state) {
    case "policy_blocked":
    case "auth_required":
    case "failed":
      return theme.error
    case "waiting_for_approval":
    case "waiting_for_answer":
    case "cooling_down":
    case "provider_delayed":
      return theme.warning
    case "complete":
      return theme.success
    case "working":
    case "compacting":
    case "resuming":
      return theme.accent
    case "ready":
      return theme.textMuted
  }
}
