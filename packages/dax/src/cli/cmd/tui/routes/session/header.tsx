import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"
import { isEli12Mode } from "@/dax/intent"

type HeaderAction = {
  label: string
  onPress: () => void
  primary?: boolean
}

export function Header(props: {
  sessionLabel?: string
  lifecycleLabel?: string
  currentStep?: string
  trustLabel?: string
  emphasis?: "normal" | "muted"
  actions?: HeaderAction[]
  busy?: boolean
}) {
  const kv = useKV()
  const { theme } = useTheme()

  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const toggleEli12 = () => {
    kv.set(DAX_SETTING.explain_mode, explainMode() ? "normal" : "eli12")
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
            <For each={letters}>
              {(letter, index) => (
                <text fg={letterColor(index())} attributes={letterWeight(index())}>
                  {letter}
                </text>
              )}
            </For>
            <Show when={showLifecycleChip()}>
              <box
                backgroundColor={theme.backgroundElement}
                border={["round"]}
                borderColor={theme.borderSubtle}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={lifecycleColor()}>{props.lifecycleLabel?.toLowerCase()}</text>
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
