import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, createResource, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { tint, useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRoute, useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { useSDK } from "../context/sdk"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useKeybind } from "../context/keybind"
import { useTerminalDimensions } from "@opentui/solid"
import { HOME_STAGE, HOME_STAGE_ELI12 } from "@/dax/workflow/stage"
import { isEli12Mode, nextIntentMode } from "@/dax/intent"
import { DAX_BRAND } from "@/dax/brand"
import { chooseMcpCapability, summarizeMcpReadiness } from "@/dax/experience"
import { DAX_SETTING } from "@/dax/settings"
import { resolvePreferredName } from "@/dax/user-profile"
import { Toast, useToast } from "../ui/toast"
import { labelProductState, productStateIcon, type ProductState } from "@/dax/status"

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
type HomeFeedback = {
  title: string
  detail: string
  outcome: string
}

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
    <box flexDirection="column" alignItems="flex-start" gap={0}>
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

function ReadinessAction(props: { label: string; onPress: () => void; theme: any; primary?: boolean }) {
  return (
    <box onMouseUp={props.onPress} paddingLeft={1} paddingRight={1} backgroundColor={props.primary ? props.theme.primary : undefined}>
      <text fg={props.primary ? props.theme.selectedListItemText : props.theme.text}>
        {props.label}
      </text>
    </box>
  )
}

function QuickTask(props: { label: string; onPress: () => void; theme: any }) {
  return (
    <box
      onMouseUp={props.onPress}
      backgroundColor={props.theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
    >
      <text fg={props.theme.primary}>{props.label}</text>
    </box>
  )
}

export function Home() {
  const sync = useSync()
  const kv = useKV()
  const sdk = useSDK()
  const themeState = useTheme()
  const theme = new Proxy({} as any, {
    get: (_target, prop: string) => (themeState.theme as any)[prop],
  })
  const { navigate } = useRoute()
  const route = useRouteData("home")
  const promptRef = usePromptRef()
  const command = useCommandDialog()
  const keybind = useKeybind()
  const toast = useToast()
  const dimensions = useTerminalDimensions()
  const mcp = createMemo(() => Object.keys(sync.data.mcp).length > 0)
  const mcpError = createMemo(() => Object.values(sync.data.mcp).some((x) => x.status === "failed"))

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })
  const primaryConnectedMcp = createMemo(() => {
    return Object.entries(sync.data.mcp)
      .filter(([, status]) => status.status === "connected")
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b))[0]
  })
  const blockedMcpCount = createMemo(() =>
    Object.values(sync.data.mcp).filter((x) => x.status === "needs_auth" || x.status === "needs_client_registration").length,
  )
  const failedMcpCount = createMemo(() => Object.values(sync.data.mcp).filter((x) => x.status === "failed").length)
  const [mcpInspect] = createResource(primaryConnectedMcp, async (name) => {
    if (!name) return undefined
    const result = await sdk.client.mcp.inspect({ name }).catch(() => undefined)
    return result?.data
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
  const preferredName = createMemo(() =>
    resolvePreferredName({
      configUsername: sync.data.config.username,
      kvGet: kv.get,
    }),
  )

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
          message = WELCOME_MESSAGES.firstTime[Math.floor(Math.random() * WELCOME_MESSAGES.firstTime.length)] ?? "Welcome to DAX."
        } else {
          const msg = WELCOME_MESSAGES.returning[Math.floor(Math.random() * WELCOME_MESSAGES.returning.length)]
          const sessionInfo = sessionCount() > 0 ? ` (${sessionCount()} sessions)` : ""
          message = (msg ?? "Welcome back to DAX.") + sessionInfo
        }
        toast.show({
          message,
          variant: "info",
          duration: 2600,
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
  const connectedProviders = createMemo(() => sync.data.provider_next.connected.length)
  const configuredMcp = createMemo(() => Object.keys(sync.data.mcp).length)
  const projectReady = createMemo(() => sync.data.vcs?.branch || sync.data.path.worktree)
  const latestSession = createMemo(() => sync.data.session[0])
  const providerReadiness = createMemo<{ state: ProductState; summary: string }>(() => {
    if (connectedProviders() > 0) {
      return {
        state: "connected",
        summary: `${connectedProviders()} provider connection${connectedProviders() === 1 ? "" : "s"} available.`,
      }
    }
    return {
      state: "blocked",
      summary: "No provider is connected yet. Connect one to unlock model execution.",
    }
  })
  const mcpCapability = createMemo(() => chooseMcpCapability(mcpInspect()))
  const mcpReadiness = createMemo<{ state: ProductState; summary: string }>(() => {
    return summarizeMcpReadiness({
      configured: configuredMcp(),
      failed: failedMcpCount(),
      blocked: blockedMcpCount(),
      connected: connectedMcpCount(),
      capability: mcpCapability(),
    })
  })
  const safeMcpReadiness = createMemo<{ state: ProductState; summary: string }>(() => {
    return (
      mcpReadiness() ?? {
        state: "waiting",
        summary: "Checking MCP readiness.",
      }
    )
  })
  const projectReadiness = createMemo<{ state: ProductState; summary: string }>(() => {
    if (projectReady()) {
      return {
        state: "connected",
        summary: sync.data.vcs?.branch
          ? `Workspace ready on branch ${sync.data.vcs.branch}.`
          : `Workspace root detected at ${sync.data.path.worktree}.`,
      }
    }
    return {
      state: "waiting",
      summary: "Loose directory detected. DAX works here, but project-aware flows are better in a repo.",
    }
  })
  const sessionReadiness = createMemo<{ state: ProductState; summary: string }>(() => {
    if (sessionCount() > 0) {
      return {
        state: "connected",
        summary: `Resume available. Latest session: ${latestSession()?.title ?? "recent work"}.`,
      }
    }
    return {
      state: "waiting",
      summary: "No prior sessions yet. Start with a safe read-only task in the prompt below.",
    }
  })
  const compactReadiness = createMemo(() => [
    { label: "provider", value: providerReadiness().state, summary: providerReadiness().summary },
    { label: "project", value: projectReadiness().state, summary: projectReadiness().summary },
    { label: "mcp", value: safeMcpReadiness().state, summary: safeMcpReadiness().summary },
  ])
  const [homeFeedback, setHomeFeedback] = createSignal<HomeFeedback | undefined>()

  function queuePrompt(input: string, submit = false) {
    prompt.set({ input, parts: [] })
    prompt.focus()
    if (submit) prompt.submit()
  }

  function rememberHomeAction(title: string, detail: string, outcome: string) {
    setHomeFeedback({ title, detail, outcome })
  }

  const resumeLatest = () => {
    if (!latestSession()) return
    rememberHomeAction("Resume latest", "Open the latest saved session.", `Resumed ${latestSession()!.title ?? "recent work"}.`)
    navigate({ type: "session", sessionID: latestSession()!.id })
  }

  const openProviderConnect = () => {
    rememberHomeAction(
      connectedProviders() > 0 ? "Switch provider" : "Connect provider",
      "Open the provider connect flow.",
      connectedProviders() > 0 ? "Ready to switch the active provider." : "Ready to connect the first provider.",
    )
    command.trigger("provider.connect")
  }
  const openMcpInspect = () => {
    rememberHomeAction("Inspect MCP", "Open the MCP cockpit.", "Showing live MCP server health and capability details.")
    command.trigger("mcp.inspect")
  }
  const openMcpDoctor = () => {
    rememberHomeAction("Run MCP doctor", "Run the MCP diagnostic flow.", "Checking configured MCP servers and connection status.")
    command.trigger("mcp.doctor")
  }
  const openProjectDoctor = () => {
    rememberHomeAction("Project doctor", "Run the project diagnostic flow.", "Checking repository and workspace readiness.")
    command.trigger("project.doctor")
  }
  const focusHomePrompt = () => {
    rememberHomeAction("Focus prompt", "Move to the main prompt.", "Ready for the next request.")
    prompt.focus()
  }
  const configurePreferredName = () => {
    const prefix = preferredName() ? `/name ${preferredName()}` : "/name "
    rememberHomeAction(
      preferredName() ? "Update preferred name" : "Set preferred name",
      "Prefill the prompt with the preferred-name command.",
      preferredName()
        ? `Ready to update how DAX addresses you. Current name: ${preferredName()}.`
        : "Ready to set how DAX should address you in future sessions.",
    )
    queuePrompt(prefix, false)
  }
  const queueRepoSummary = () => {
    rememberHomeAction(
      "Summarize repo",
      "Prompt: Summarize this repository structure and name the main moving parts.",
      "Queued a safe repository summary.",
    )
    queuePrompt("Summarize this repository structure and name the main moving parts.", true)
  }
  const queueSafeNextStep = () => {
    rememberHomeAction(
      "Safe next step",
      "Prompt: Find one safe next step in this project and explain why it is the best next move.",
      "Queued a safe next-step review.",
    )
    queuePrompt("Find one safe next step in this project and explain why it is the best next move.", true)
  }
  const queueMcpCheck = () => {
    rememberHomeAction(
      "Check MCP",
      "Prompt: Check which MCP capabilities are available in this workspace and explain the most useful read-only ones first.",
      "Queued an MCP capability review.",
    )
    queuePrompt("Check which MCP capabilities are available in this workspace and explain the most useful read-only ones first.", true)
  }
  const queueRecentWorkReview = () => {
    rememberHomeAction(
      "Review recent work",
      "Prompt: Review recent project changes and summarize what matters most to continue safely.",
      "Queued a recent-work review.",
    )
    queuePrompt("Review recent project changes and summarize what matters most to continue safely.", true)
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
      title: connectedProviders() > 0 ? "Switch provider" : "Connect provider",
      value: "home.provider.connect",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        openProviderConnect()
      },
    },
    {
      title: "Inspect MCP",
      value: "home.mcp.inspect",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        openMcpInspect()
      },
    },
    {
      title: "Run MCP doctor",
      value: "home.mcp.doctor",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        openMcpDoctor()
      },
    },
    {
      title: "Project doctor",
      value: "home.project.doctor",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        openProjectDoctor()
      },
    },
    {
      title: sessionCount() > 0 ? "Resume latest session" : "Focus prompt",
      value: "home.session.primary",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        if (latestSession()) {
          resumeLatest()
          return
        }
        focusHomePrompt()
      },
    },
    {
      title: preferredName() ? `Set preferred name (${preferredName()})` : "Set preferred name",
      value: "home.profile.name",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        configurePreferredName()
      },
    },
    {
      title: "Safe task: Summarize repo",
      value: "home.safe.repo_summary",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        queueRepoSummary()
      },
    },
    {
      title: "Safe task: Safe next step",
      value: "home.safe.next_step",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        queueSafeNextStep()
      },
    },
    {
      title: "Safe task: Check MCP",
      value: "home.safe.mcp_check",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        queueMcpCheck()
      },
    },
    {
      title: "Safe task: Review recent work",
      value: "home.safe.recent_work",
      category: "Home",
      onSelect: (dialog) => {
        dialog.clear()
        queueRecentWorkReview()
      },
    },
  ])

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
          <box width="100%" maxWidth={small() ? undefined : 72} alignItems="flex-start" gap={tiny() ? 0 : 1}>
            <box width="100%" flexDirection="column" gap={0}>
              <Show
                when={kv.get("animations_enabled", true)}
                fallback={
                  <box flexDirection="column" gap={0}>
                    <text fg={theme.text} attributes={TextAttributes.BOLD}>
                      {DAX_BRAND.name.toUpperCase()}
                    </text>
                    <text fg={theme.textMuted}>{DAX_BRAND.category}</text>
                  </box>
                }
              >
                <AnimatedHeader theme={theme} />
              </Show>
              <Show when={preferredName() && !tiny()}>
                <text fg={theme.textMuted}>Hi, {preferredName()}.</text>
              </Show>
              <Show when={!tiny()}>
                <text fg={theme.textMuted}>guided execution workspace</text>
              </Show>
            </box>

            <Show when={showStages()}>
              <StageIndicator stages={stages()} current={0} theme={theme} />
            </Show>

            <Show when={!tiny()}>
              <box width="100%" flexDirection="column" gap={1} backgroundColor={theme.backgroundPanel} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
                <box flexDirection="row" gap={2} flexWrap="wrap">
                  <For each={compactReadiness()}>
                    {(item) => (
                      <text fg={item.value === "connected" ? theme.success : item.value === "failed" ? theme.error : item.value === "blocked" ? theme.warning : theme.textMuted}>
                        {productStateIcon(item.value)} {item.label} {labelProductState(item.value)}
                      </text>
                    )}
                  </For>
                </box>
                <text fg={theme.textMuted} wrapMode="word">
                  <Switch fallback={sessionReadiness().summary}>
                    <Match when={providerReadiness().state !== "connected"}>{providerReadiness().summary}</Match>
                    <Match when={safeMcpReadiness().state === "failed" || safeMcpReadiness().state === "blocked"}>
                      {safeMcpReadiness().summary}
                    </Match>
                    <Match when={projectReadiness().state !== "connected"}>{projectReadiness().summary}</Match>
                    <Match when={sessionCount() > 0}>{sessionReadiness().summary}</Match>
                  </Switch>
                </text>
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

            <Show when={isFirstTimeUser() && !tiny()}>
              <box width="100%" maxWidth={small() ? undefined : 72} flexDirection="column" gap={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  START WITH
                </text>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <ReadinessAction
                    primary
                    label={connectedProviders() > 0 ? "Switch provider" : "Connect provider"}
                    onPress={openProviderConnect}
                    theme={theme}
                  />
                  <ReadinessAction label="Inspect MCP" onPress={openMcpInspect} theme={theme} />
                  <ReadinessAction
                    label={sessionCount() > 0 ? "Resume latest" : "Focus prompt"}
                    onPress={() => {
                      if (latestSession()) {
                        resumeLatest()
                        return
                      }
                      focusHomePrompt()
                    }}
                    theme={theme}
                  />
                </box>
              </box>
            </Show>

            <Show when={!tiny()}>
              <box width="100%" maxWidth={small() ? undefined : 72} flexDirection="column" gap={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  START WITH
                </text>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <QuickTask theme={theme} label="Summarize repo" onPress={queueRepoSummary} />
                  <QuickTask theme={theme} label="Safe next step" onPress={queueSafeNextStep} />
                  <QuickTask theme={theme} label="Check MCP" onPress={queueMcpCheck} />
                  <QuickTask
                    theme={theme}
                    label={preferredName() ? `Name: ${preferredName()}` : "Set your name"}
                    onPress={configurePreferredName}
                  />
                </box>
                <Show when={showActions()}>
                  <text fg={theme.textMuted}>
                    Press {keybind.print("command_list")} for more actions, including theme, environment, status, and recent work.
                  </text>
                </Show>
              </box>
            </Show>

            <Show when={!tiny() && homeFeedback()}>
              {(feedback) => (
                <box
                  width="100%"
                  maxWidth={small() ? undefined : 72}
                  flexDirection="column"
                  gap={0}
                  backgroundColor={theme.backgroundPanel}
                  paddingLeft={2}
                  paddingRight={2}
                  paddingTop={1}
                  paddingBottom={1}
                >
                  <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                    NEXT RELIABLE STEP
                  </text>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {feedback().title}
                  </text>
                  <text fg={theme.textMuted} wrapMode="word">
                    {feedback().detail}
                  </text>
                  <text fg={theme.success} wrapMode="word">
                    {feedback().outcome}
                  </text>
                </box>
              )}
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
              <box width="100%" alignItems="flex-start">
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
