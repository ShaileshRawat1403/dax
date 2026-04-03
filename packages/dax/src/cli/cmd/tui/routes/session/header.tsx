import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"
import { isEli12Mode } from "@/dax/intent"
import type { PersonaPack } from "@/dax/presentation/persona"
import { nextDisplayMode, type DisplayMode } from "@/dax/presentation/session-display"

type HeaderAction = {
  label: string
  onPress: () => void
  primary?: boolean
}

export function Header(props: {
  sessionLabel?: string
  lifecycleLabel?: string
  decisionState?: string
  persona?: PersonaPack
  currentStep?: string
  trustLabel?: string
  emphasis?: "normal" | "muted"
  actions?: HeaderAction[]
  busy?: boolean
}) {
  const kv = useKV()
  const { theme } = useTheme()

  const [displayMode, setDisplayMode] = kv.signal<DisplayMode>(DAX_SETTING.display_mode, "operator")
  const [queueVisibleRaw, setQueueVisibleRaw] = kv.signal<string | boolean>(DAX_SETTING.intervention_queue_visible, true)
  const queueVisible = createMemo(() => queueVisibleRaw() !== false && queueVisibleRaw() !== "false")
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const toggleEli12 = () => {
    kv.set(DAX_SETTING.explain_mode, explainMode() ? "normal" : "eli12")
  }
  const cycleDisplayMode = () => {
    setDisplayMode(() => nextDisplayMode(displayMode()))
  }
  const toggleQueue = () => {
    setQueueVisibleRaw(() => !queueVisible())
  }

  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTick((t) => (t + 1) % 10), 140)
    onCleanup(() => clearInterval(timer))
  })

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

  const decisionColor = createMemo(() => {
    const state = props.decisionState?.toLowerCase() ?? ""
    if (state === "critiquing" || state === "interpreting") return theme.accent
    if (state === "verifying") return theme.secondary
    if (state === "executing") return theme.primary
    if (state === "recovering") return theme.warning
    return theme.textMuted
  })

  const personaLabel = createMemo(() => {
    if (!props.persona || !props.decisionState) return props.decisionState
    const state = props.decisionState.toLowerCase().split(" ")[0]!
    return props.persona.ui.statusLabels[state] ?? props.decisionState
  })

  const letters = ["D", "A", "X"]
  const letterColor = (index: number) => {
    const palette = [theme.primary, theme.accent, theme.secondary]
    return palette[(tick() + index) % palette.length] ?? theme.primary
  }
  const letterWeight = (index: number) => ((tick() + index) % 5 === 0 ? TextAttributes.BOLD : undefined)

  return (
    <box flexShrink={0} backgroundColor={theme.backgroundPanel}>
      <box paddingTop={0} paddingBottom={0} paddingLeft={1} paddingRight={1} flexShrink={0}>
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
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
              <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                {props.persona!.ui.glyph}
              </text>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {props.persona!.label.toUpperCase()}
              </text>
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
            <Show when={props.decisionState && props.emphasis !== "muted"}>
              <box
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={decisionColor()} attributes={TextAttributes.BOLD}>
                  {personaLabel()?.toUpperCase()}
                </text>
              </box>
            </Show>
          </box>

          <box flexDirection="row" gap={1} alignItems="center">
            <box
              onMouseUp={toggleEli12}
              flexDirection="row"
              backgroundColor={theme.backgroundElement}
              border={["round"]}
              borderColor={theme.borderSubtle}
              paddingLeft={1}
              paddingRight={1}
            >
              <text
                fg={!explainMode() ? theme.primary : theme.textMuted}
                attributes={!explainMode() ? TextAttributes.BOLD : undefined}
              >
                NORMAL
              </text>
              <text fg={theme.textMuted}>|</text>
              <text
                fg={explainMode() ? theme.primary : theme.textMuted}
                attributes={explainMode() ? TextAttributes.BOLD : undefined}
              >
                ELI12
              </text>
            </box>
            <box
              onMouseUp={cycleDisplayMode}
              flexDirection="row"
              backgroundColor={theme.backgroundElement}
              border={["round"]}
              borderColor={theme.borderSubtle}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.textMuted}>{displayMode().toUpperCase()}</text>
            </box>
            <box
              onMouseUp={toggleQueue}
              flexDirection="row"
              backgroundColor={theme.backgroundElement}
              border={["round"]}
              borderColor={theme.borderSubtle}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={queueVisible() ? theme.primary : theme.textMuted}>QUEUE</text>
            </box>
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
