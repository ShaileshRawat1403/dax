import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { tint, useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRoute, useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useTerminalDimensions } from "@opentui/solid"
import { HOME_STAGE, HOME_STAGE_ELI12 } from "@/dax/workflow/stage"
import { isEli12Mode, nextIntentMode } from "@/dax/intent"
import { DAX_BRAND } from "@/dax/brand"
import { DAX_SETTING } from "@/dax/settings"
import { useToast } from "../ui/toast"
import { useLocal } from "../context/local"

const WELCOME_MESSAGES = {
  firstTime: [
    "Welcome to DAX. Bring an idea, and we will turn it into real execution.",
    "You are one prompt away from a working plan and verified progress.",
    "Start in plain language. DAX handles the execution flow with you.",
  ],
  returning: [
    "Welcome back. Let us pick up momentum and ship the next improvement.",
    "You are back in DAX. Continue from context and execute with confidence.",
    "Good to see you again. Let us turn today’s intent into outcomes.",
  ],
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

  const letters = DAX_BRAND.name.toUpperCase().slice(0, 3).split("")

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
        {DAX_BRAND.category}
      </text>
    </box>
  )
}

function ActionChip(props: { label: string; active?: boolean; onPress: () => void; theme: any; icon?: string }) {
  const icon = () => props.icon ?? (props.active ? "●" : "○")
  return (
    <box onMouseUp={props.onPress} flexDirection="row" gap={0} alignItems="center">
      <text fg={props.active ? props.theme.primary : props.theme.textMuted}>{icon()}</text>
      <text fg={props.active ? props.theme.primary : props.theme.textMuted} marginLeft={1}>
        {props.label}
      </text>
    </box>
  )
}

function PromptStarter(props: { label: string; onPress: () => void; theme: any }) {
  return (
    <box onMouseUp={props.onPress} paddingLeft={1} paddingRight={1} backgroundColor={props.theme.backgroundElement}>
      <text fg={props.theme.textMuted}>{props.label}</text>
    </box>
  )
}

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const themeState = useTheme()
  const theme = new Proxy({} as any, {
    get: (_target, prop: string) => (themeState.theme as any)[prop],
  })
  const { navigate } = useRoute()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const toast = useToast()
  const local = useLocal()
  const dimensions = useTerminalDimensions()
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

  onCleanup(() => {
    promptRef.set(undefined)
  })
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const stages = createMemo(() => (explainMode() ? HOME_STAGE_ELI12 : HOME_STAGE))

  function promptText(kind: "explore" | "plan" | "audit" | "docs") {
    if (explainMode()) {
      return {
        explore: "Explore this repository and explain the main parts in simple language.",
        plan: "Plan the safest next steps for this project in simple language.",
        audit: "Audit this repository for the most important release, policy, and quality risks in simple language.",
        docs: "Read the docs and explain what this project does in simple language.",
      }[kind]
    }

    return {
      explore:
        "Explore this repository. Map the entry points, execution flow, key files, unknowns, and next reading targets.",
      plan: "Plan the next safe implementation steps for this project.",
      audit: "Audit this repository for the most important release, policy, test, and documentation risks.",
      docs: "Read the documentation and summarize the product surface, architecture, and operator flow.",
    }[kind]
  }

  function setPromptDraft(text: string, submit = false, mode?: "plan" | "build" | "explore" | "docs" | "audit") {
    if (mode) {
      local.agent.set(mode)
      kv.set(DAX_SETTING.session_workflow_mode, mode)
    }
    prompt.set({ input: text, parts: [] })
    prompt.focus()
    if (submit) prompt.submit()
  }

  function cycleTheme(step: 1 | -1) {
    const themes = Object.keys(themeState.all()).sort()
    if (!themes.length) return
    const current = themeState.selected
    const currentIndex = themes.indexOf(current)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const next = themes[(baseIndex + step + themes.length) % themes.length]
    if (!next) return
    themeState.set(next)
    toast.show({ message: `Theme: ${next}`, variant: "success", duration: 1500 })
  }

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
        kv.set(DAX_SETTING.explain_mode, nextIntentMode(kv.get(DAX_SETTING.explain_mode, "normal")))
        dialog.clear()
      },
    },
    {
      title: "Start Explore prompt",
      value: "dax.explore.start",
      category: "Workflows",
      onSelect: (dialog) => {
        setPromptDraft(promptText("explore"), false, "explore")
        dialog.clear()
      },
    },
    {
      title: "Start Plan prompt",
      value: "dax.plan.start",
      category: "Workflows",
      onSelect: (dialog) => {
        setPromptDraft(promptText("plan"), false, "plan")
        dialog.clear()
      },
    },
    {
      title: "Start Audit prompt",
      value: "dax.audit.start",
      category: "Workflows",
      onSelect: (dialog) => {
        setPromptDraft(promptText("audit"), false, "audit")
        dialog.clear()
      },
    },
    {
      title: "Start Docs prompt",
      value: "dax.docs.start",
      category: "Workflows",
      onSelect: (dialog) => {
        setPromptDraft(promptText("docs"), false, "docs")
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
              <text fg={theme.error}>!</text>
            </Match>
            <Match when={true}>
              <text fg={theme.success}>●</text>
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
        let message = ""
        if (isFirstTimeUser()) {
          message =
            WELCOME_MESSAGES.firstTime[Math.floor(Math.random() * WELCOME_MESSAGES.firstTime.length)] ??
            "Welcome to DAX."
        } else {
          const msg = WELCOME_MESSAGES.returning[Math.floor(Math.random() * WELCOME_MESSAGES.returning.length)]
          const sessionInfo = sessionCount() > 0 ? ` (${sessionCount()} sessions)` : ""
          message = (msg ?? "Welcome back to DAX.") + sessionInfo
        }
        toast.show({
          title: "Welcome",
          message,
          variant: "info",
          duration: 4200,
        })
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
  const showActions = createMemo(() => height() >= 16)

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

            <Show when={!tiny() && showActions()}>
              <box width="100%" flexDirection="row" justifyContent="center" gap={2} flexWrap="wrap" alignItems="center">
                <ActionChip
                  label="Explain"
                  active={explainMode()}
                  theme={theme}
                  onPress={() => command.trigger("eli12.toggle")}
                />
                <ActionChip
                  label="Explore"
                  theme={theme}
                  onPress={() => setPromptDraft(promptText("explore"), false, "explore")}
                />
                <ActionChip
                  label="Plan"
                  theme={theme}
                  onPress={() => setPromptDraft(promptText("plan"), false, "plan")}
                />
                <ActionChip
                  label="Audit"
                  theme={theme}
                  onPress={() => setPromptDraft(promptText("audit"), false, "audit")}
                />
                <ActionChip
                  label="Docs"
                  theme={theme}
                  onPress={() => setPromptDraft(promptText("docs"), false, "docs")}
                />
              </box>
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

            <Show when={!tiny()}>
              <box width="100%" flexDirection="row" justifyContent="center" gap={1} flexWrap="wrap" alignItems="center">
                <text fg={theme.textMuted}>Quick:</text>
                <PromptStarter
                  label="Explore"
                  theme={theme}
                  onPress={() => setPromptDraft(promptText("explore"), false, "explore")}
                />
                <PromptStarter
                  label="Plan"
                  theme={theme}
                  onPress={() => setPromptDraft(promptText("plan"), false, "plan")}
                />
                <PromptStarter
                  label="Audit"
                  theme={theme}
                  onPress={() => setPromptDraft(promptText("audit"), false, "audit")}
                />
                <PromptStarter
                  label="Docs"
                  theme={theme}
                  onPress={() => setPromptDraft(promptText("docs"), false, "docs")}
                />
              </box>
            </Show>

            <Show when={!tiny() && sessionCount() > 0}>
              <box width="100%" marginTop={1} flexDirection="column" gap={0}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  {"  "}RECENT SESSIONS
                </text>
                <box flexDirection="column" gap={0}>
                  <For each={sync.data.session.slice(0, 3)}>
                    {(s) => (
                      <box
                        onMouseUp={() => {
                          navigate({ type: "session", sessionID: s.id })
                        }}
                        paddingLeft={2}
                        paddingRight={2}
                        paddingTop={0}
                        paddingBottom={0}
                        flexDirection="row"
                        justifyContent="space-between"
                      >
                        <text fg={theme.text}>▸ {s.title.length > 50 ? s.title.slice(0, 47) + "..." : s.title}</text>
                        <text fg={theme.textMuted}>{new Date(s.time.updated).toLocaleDateString()}</text>
                      </box>
                    )}
                  </For>
                </box>
              </box>
            </Show>

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
                  <text fg={theme.error}>!</text>
                </Match>
                <Match when={true}>
                  <text fg={connectedMcpCount() > 0 ? theme.success : theme.textMuted}>●</text>
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

function StageIndicator(props: { stages: readonly string[]; current: number; theme: any }) {
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
