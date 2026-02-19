import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { tint, useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast, useToast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useTerminalDimensions } from "@opentui/solid"

const STAGES = ["Explore", "Think", "Plan", "Execute", "Verify", "Done"]
const STAGES_ELI12 = ["Explore", "Think", "Plan", "Do", "Check", "Done"]

const WELCOME_MESSAGES = {
  firstTime: [
    "Welcome to DAX! Type anything to get started",
    "Ready to code with confidence",
    "Your AI coding partner awaits",
  ],
  returning: ["Welcome back! Ready to continue?", "Good to see you again", "Let's build something great"],
}

let once = false
let welcomeShown = false

function AnimatedHeader(props: { theme: any }) {
  const [tick, setTick] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => {
      setTick((t) => t + 1)
    }, 80)
    onCleanup(() => clearInterval(timer))
  })

  const letters = ["D", "A", "X"]

  const letterColor = (index: number) => {
    const colors = [props.theme.primary, props.theme.accent, props.theme.secondary]
    const offset = (tick() + index * 3) % (colors.length * 4)
    if (offset < colors.length) return colors[offset]
    return colors[colors.length - 1 - (offset - colors.length)]
  }

  const letterBlink = (index: number) => {
    const t = tick()
    const phase = (t + index * 4) % 8
    return phase < 2
  }

  return (
    <box flexDirection="column" alignItems="center" gap={0}>
      <box flexDirection="row" alignItems="center" gap={0}>
        <For each={letters}>
          {(letter, i) => (
            <text fg={letterColor(i())} attributes={letterBlink(i()) ? TextAttributes.BOLD : undefined}>
              {letter}
            </text>
          )}
        </For>
      </box>
      <text fg={props.theme.textMuted} attributes={TextAttributes.BOLD}>
        Code with confidence
      </text>
    </box>
  )
}

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const dimensions = useTerminalDimensions()
  const toast = useToast()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const isFirstTimeUser = createMemo(() => sync.data.session.length === 0)
  const sessionCount = createMemo(() => sync.data.session.length)
  const tipsHidden = createMemo(() => kv.get("tips_hidden", true))
  const showTips = createMemo(() => {
    if (isFirstTimeUser()) return false
    return !tipsHidden()
  })
  const explainMode = createMemo(() => kv.get("explain_mode", "normal") === "eli12")
  const stages = createMemo(() => (explainMode() ? STAGES_ELI12 : STAGES))

  command.register(() => [
    {
      title: tipsHidden() ? "Show tips" : "Hide tips",
      value: "tips.toggle",
      keybind: "tips_toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("tips_hidden", !tipsHidden())
        dialog.clear()
      },
    },
    {
      title: explainMode() ? "Disable ELI12 mode" : "Enable ELI12 mode",
      value: "eli12.toggle",
      category: "System",
      onSelect: (dialog) => {
        kv.set("explain_mode", explainMode() ? "normal" : "eli12")
        dialog.clear()
      },
    },
  ])

  const Hint = (
    <Show when={connectedMcpCount() > 0}>
      <box flexShrink={0} flexDirection="row" gap={1}>
        <box flexDirection="row" gap={1}>
          <Switch>
            <Match when={mcpError()}>
              <span style={{ fg: theme.error }}>!</span>
            </Match>
            <Match when={true}>
              <span style={{ fg: theme.success }}>●</span>
            </Match>
          </Switch>
          <text fg={theme.textMuted}>{Locale.pluralize(connectedMcpCount(), "{} mcp", "{} mcp")}</text>
        </box>
      </box>
    </Show>
  )

  let prompt: PromptRef
  const args = useArgs()
  onMount(() => {
    if (once) return
    once = true

    if (!welcomeShown) {
      welcomeShown = true
      setTimeout(() => {
        if (isFirstTimeUser()) {
          const msg = WELCOME_MESSAGES.firstTime[Math.floor(Math.random() * WELCOME_MESSAGES.firstTime.length)]
          toast.show({ message: msg, variant: "info", duration: 4000 })
        } else {
          const msg = WELCOME_MESSAGES.returning[Math.floor(Math.random() * WELCOME_MESSAGES.returning.length)]
          const sessionInfo = sessionCount() > 0 ? ` (${sessionCount()} sessions)` : ""
          toast.show({ message: msg + sessionInfo, variant: "success", duration: 3000 })
        }
      }, 500)
    }

    if (route.initialPrompt) {
      prompt.set(route.initialPrompt)
    } else if (args.prompt) {
      prompt.set({ input: args.prompt, parts: [] })
      prompt.submit()
    }
  })
  const directory = useDirectory()

  const width = createMemo(() => dimensions().width)
  const height = createMemo(() => dimensions().height)

  const size = createMemo(() => {
    const w = width()
    const h = height()
    if (w < 50 || h < 16) return "tiny"
    if (w < 70) return "small"
    return "medium"
  })

  const tiny = createMemo(() => size() === "tiny")
  const small = createMemo(() => size() === "small")
  const showInput = createMemo(() => height() >= 14)
  const showStages = createMemo(() => height() >= 18)

  const bg = createMemo(() => theme.background)
  const inputBg = createMemo(() => tint(bg(), theme.primary, 0.06))

  return (
    <>
      <box
        flexGrow={1}
        justifyContent="center"
        alignItems="center"
        paddingLeft={tiny() ? 0 : 1}
        paddingRight={tiny() ? 0 : 1}
        paddingTop={tiny() ? 0 : 1}
        gap={tiny() ? 0 : 1}
        backgroundColor={bg()}
      >
        <Show
          when={showInput()}
          fallback={
            <box padding={1}>
              <text fg={theme.textMuted}>Terminal too small</text>
            </box>
          }
        >
          <box width="100%" maxWidth={small() ? undefined : 72} alignItems="center" gap={tiny() ? 0 : 1}>
            <AnimatedHeader theme={theme} />

            <Show when={showStages()}>
              <StageIndicator stages={stages()} current={0} theme={theme} />
            </Show>

            <box width="100%" backgroundColor={inputBg()} padding={tiny() ? 0 : 1}>
              <Prompt
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                }}
                hint={Hint}
              />
            </box>

            <Show when={!tiny() && showTips()}>
              <box width="100%" maxWidth={56} alignItems="center">
                <Tips />
              </box>
            </Show>
          </box>
        </Show>
        <Toast />
      </box>

      <box
        paddingTop={tiny() ? 0 : 1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="row"
        flexShrink={0}
        gap={2}
      >
        <text fg={theme.textMuted}>{directory()}</text>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <Show when={mcp()}>
            <box flexDirection="row" gap={1}>
              <Switch>
                <Match when={mcpError()}>
                  <span style={{ fg: theme.error }}>!</span>
                </Match>
                <Match when={true}>
                  <span style={{ fg: connectedMcpCount() > 0 ? theme.success : theme.textMuted }}>●</span>
                </Match>
              </Switch>
              <Show when={!tiny()}>
                <text fg={theme.textMuted}>{`${connectedMcpCount()} mcp`}</text>
              </Show>
            </box>
          </Show>
        </box>
        <box flexGrow={1} />
        <text fg={theme.textMuted}>v{Installation.VERSION}</text>
      </box>
    </>
  )
}

function StageIndicator(props: { stages: string[]; current: number; theme: any }) {
  const activeColor = () => props.theme.accent
  const doneColor = () => props.theme.success
  const pendingColor = () => props.theme.textMuted

  return (
    <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap" justifyContent="center">
      <For each={props.stages}>
        {(stage, index) => {
          const isActive = () => index() === props.current
          const isDone = () => index() < props.current

          return (
            <box flexDirection="row" gap={0} alignItems="center">
              <text
                fg={isDone() ? doneColor() : isActive() ? activeColor() : pendingColor()}
                attributes={isActive() ? TextAttributes.BOLD : undefined}
              >
                {isDone() ? "●" : isActive() ? "●" : "○"}
              </text>
              <text
                fg={isActive() ? activeColor() : pendingColor()}
                attributes={isActive() ? TextAttributes.BOLD : undefined}
              >
                {" "}
                {stage}
              </text>
              <Show when={index() !== props.stages.length - 1}>
                <text fg={pendingColor()}> ·</text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
