import { Prompt, type PromptRef } from "@tui/component/prompt"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { tint, useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { Tips } from "../component/tips"
import { Locale } from "@/util/locale"
import { useSync } from "../context/sync"
import { Toast } from "../ui/toast"
import { useToast } from "../ui/toast"
import { useArgs } from "../context/args"
import { useDirectory } from "../context/directory"
import { useRoute, useRouteData } from "@tui/context/route"
import { usePromptRef } from "../context/prompt"
import { Installation } from "@/installation"
import { useKV } from "../context/kv"
import { useCommandDialog } from "../component/dialog-command"
import { useTerminalDimensions } from "@opentui/solid"
import { isEli12Mode, nextIntentMode } from "@/dax/intent"
import { DAX_BRAND } from "@/dax/brand"
import { DAX_SETTING } from "@/dax/settings"
import { useLocal } from "../context/local"
import { isMcpStatusAttention, isMcpStatusBlocked } from "@/dax/status"
import { deriveHomeLayout } from "./home-layout"
import { deriveFeatureBranchNudge } from "@/dax/presentation/vcs-guard"

const HOME_WORKFLOW_MODES = ["plan", "build", "explore", "docs", "audit"] as const
type HomeWorkflowMode = (typeof HOME_WORKFLOW_MODES)[number]

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(ms / 3600000)
  const days = Math.floor(ms / 86400000)
  if (minutes < 1) return "now"
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

let once = false

function BrandHeader(props: { theme: any }) {
  const [tick, setTick] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => {
      setTick((value) => value + 1)
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
    const phase = (tick() + index * 4) % 8
    return phase < 2
  }

  return (
    <box flexDirection="column" alignItems="center" gap={0}>
      <box flexDirection="row" height={1} alignItems="center" justifyContent="center">
        <For each={letters}>
          {(letter, index) => (
            <text fg={letterColor(index())} attributes={letterBlink(index()) ? TextAttributes.BOLD : undefined}>
              {letter}
            </text>
          )}
        </For>
      </box>
      <box flexDirection="row" height={1} alignItems="center" justifyContent="center">
        <text fg={props.theme.textMuted}>Run · Audit · Override</text>
      </box>
    </box>
  )
}

function PromptStarter(props: { label: string; onPress: () => void; theme: any }) {
  return (
    <box
      onMouseUp={props.onPress}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.theme.backgroundElement}
      border={["round"]}
      borderColor={props.theme.borderSubtle}
    >
      <text fg={props.theme.text}>{props.label}</text>
    </box>
  )
}

function HomeInfoCard(props: { title: string; body: string; theme: any; tone?: "default" | "accent" | "warning" }) {
  const borderColor =
    props.tone === "accent"
      ? props.theme.borderActive
      : props.tone === "warning"
        ? props.theme.warning
        : props.theme.border
  const backgroundColor =
    props.tone === "accent"
      ? tint(props.theme.backgroundElement, props.theme.primary, 0.06)
      : props.tone === "warning"
        ? tint(props.theme.backgroundElement, props.theme.warning, 0.07)
        : props.theme.backgroundElement

  return (
    <box
      flexDirection="column"
      gap={0}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={1}
      backgroundColor={backgroundColor}
      border={["round"]}
      borderColor={borderColor}
      flexGrow={1}
      minWidth={20}
    >
      <text fg={props.tone === "warning" ? props.theme.warning : props.theme.text} attributes={TextAttributes.BOLD}>
        {props.title}
      </text>
      <text fg={props.theme.textMuted} wrapMode="word">
        {props.body}
      </text>
    </box>
  )
}

function DaxMascot(props: { theme: any }) {
  const [tick, setTick] = createSignal(0)

  onMount(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 480)
    onCleanup(() => clearInterval(timer))
  })

  const EYE_FRAMES = ["◎", "◉", "◎", "◉", "●", "◉", "◎"]
  const eyeL = createMemo(() => EYE_FRAMES[tick() % EYE_FRAMES.length])
  const eyeR = createMemo(() => EYE_FRAMES[(tick() + 3) % EYE_FRAMES.length])
  const scan = createMemo(() => {
    const s = ["─", "═", "─", "·"]
    return s[Math.floor(tick() / 2) % s.length]
  })
  const eyeColor = createMemo(() => {
    const colors = [props.theme.primary, props.theme.accent, props.theme.secondary]
    return colors[Math.floor(tick() / 3) % colors.length]
  })

  return (
    <box flexDirection="column" alignItems="center" gap={0}>
      <text fg={props.theme.borderSubtle}>┌───┐</text>
      <box flexDirection="row" alignItems="center">
        <text fg={props.theme.borderSubtle}>│</text>
        <text fg={eyeColor()}>{eyeL()}</text>
        <text fg={scan() === "═" ? props.theme.primary : props.theme.textMuted}>{scan()}</text>
        <text fg={eyeColor()}>{eyeR()}</text>
        <text fg={props.theme.borderSubtle}>│</text>
      </box>
      <text fg={props.theme.borderSubtle}>└───┘</text>
      <text fg={props.theme.textMuted} attributes={TextAttributes.DIM}>
        operative · online
      </text>
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
  const mcpAttention = createMemo(() => Object.values(sync.data.mcp).some((x) => isMcpStatusAttention(x as any)))
  const mcpBlocked = createMemo(() => Object.values(sync.data.mcp).some((x) => isMcpStatusBlocked(x as any)))

  const connectedMcpCount = createMemo(() => {
    return Object.values(sync.data.mcp).filter((x) => x.status === "connected").length
  })

  const isFirstTimeUser = createMemo(
    () => (sync.data.overview?.recentRuns.length ?? 0) === 0 && (sync.data.overview?.activeRuns.length ?? 0) === 0,
  )
  const sessionCount = createMemo(
    () => (sync.data.overview?.recentRuns.length ?? 0) + (sync.data.overview?.activeRuns.length ?? 0),
  )
  const tipsHidden = createMemo(() => kv.get("tips_hidden", true))
  const showTips = createMemo(() => {
    if (isFirstTimeUser()) return false
    return !tipsHidden()
  })

  onCleanup(() => {
    promptRef.set(undefined)
  })
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))

  const workflowModes = createMemo(() =>
    local.agent.list().filter((agent) => HOME_WORKFLOW_MODES.includes(agent.name as HomeWorkflowMode)),
  )
  const activeWorkflowMode = createMemo<HomeWorkflowMode>(() => {
    const current = local.agent.current()?.name as HomeWorkflowMode | undefined
    if (current && HOME_WORKFLOW_MODES.includes(current)) return current
    return "plan"
  })

  function promptText(kind: HomeWorkflowMode) {
    if (explainMode()) {
      return {
        build: "Build the next safe improvement for this project in simple language.",
        explore: "Explore this repository and explain the main parts in simple language.",
        plan: "Plan the safest next steps for this project in simple language.",
        audit: "Audit this repository for the most important release, policy, and quality risks in simple language.",
        docs: "Read the docs and explain what this project does in simple language.",
      }[kind]
    }

    return {
      build: "Build the next safe improvement for this project and explain the implementation clearly.",
      explore:
        "Explore this repository. Map the entry points, execution flow, key files, unknowns, and next reading targets.",
      plan: "Plan the next safe implementation steps for this project.",
      audit: "Audit this repository for the most important release, policy, test, and documentation risks.",
      docs: "Read the documentation and summarize the product surface, architecture, and operator flow.",
    }[kind]
  }

  function setPromptDraft(text: string, submit = false, mode?: HomeWorkflowMode) {
    if (mode) {
      local.agent.set(mode)
      kv.set(DAX_SETTING.session_workflow_mode, mode)
    }
    prompt.set({ input: text, parts: [] })
    prompt.focus()
    if (submit) prompt.submit()
  }

  function selectWorkflowMode(mode: HomeWorkflowMode) {
    local.agent.set(mode)
    kv.set(DAX_SETTING.session_workflow_mode, mode)
    prompt.focus()
  }

  function cycleWorkflowMode(step: 1 | -1) {
    const idx = HOME_WORKFLOW_MODES.indexOf(activeWorkflowMode())
    const next = HOME_WORKFLOW_MODES[(idx + step + HOME_WORKFLOW_MODES.length) % HOME_WORKFLOW_MODES.length]
    selectWorkflowMode(next)
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
            <Match when={mcpAttention()}>
              <text fg={mcpBlocked() ? theme.warning : theme.error}>!</text>
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

  const layout = createMemo(() =>
    deriveHomeLayout({
      width: width(),
      height: height(),
      sessionCount: sessionCount(),
      tipsVisible: showTips(),
    }),
  )

  const tiny = createMemo(() => layout().size === "tiny")
  const small = createMemo(() => layout().size === "small")
  const showInput = createMemo(() => layout().showInput)
  const showMascot = createMemo(() => layout().showMascot && !isFirstTimeUser())
  const showActions = createMemo(() => layout().showActions)
  const showFirstRunGuide = createMemo(() => !tiny() && layout().showFirstRunGuide)
  const showSessions = createMemo(() => !tiny() && layout().showSessions)
  const showHomeTips = createMemo(() => !tiny() && layout().showTips)
  const firstRunIntent = createMemo(() =>
    explainMode()
      ? "Explore this repository and explain the main parts in simple language."
      : "Explore this repository. Map the entry points, execution flow, key files, unknowns, and next reading targets.",
  )
  const doctorSummary = createMemo(() => {
    if (!mcp()) return "Core DAX is ready. Add MCP later if you need extra tools."
    if (mcpBlocked()) return "Some MCP servers need authentication or client registration before they can connect."
    if (mcpAttention()) return "Optional MCP setup needs attention. Run dax doctor if anything feels unclear."
    if (connectedMcpCount() > 0) return "MCP is connected and ready for richer repository context."
    return "No MCP servers are connected yet. DAX still works without MCP."
  })
  const welcomeSummary = createMemo(() => {
    if (mcpBlocked()) return "Check MCP server config and credentials."
    return "Type a prompt or click Explore to begin."
  })
  const branchNudge = createMemo(() =>
    deriveFeatureBranchNudge({
      branch: sync.data.vcs?.branch,
      workflowMode: activeWorkflowMode(),
      hasConcreteChanges: false,
    }),
  )

  const bg = createMemo(() => theme.background)
  const inputBg = createMemo(() => theme.backgroundPanel)

  return (
    <>
      <box
        flexGrow={1}
        justifyContent={layout().outerJustify}
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
          <box width="100%" maxWidth={layout().maxWidth} alignItems="center" gap={tiny() ? 0 : 1}>
            <BrandHeader theme={theme} />

            <Show when={showMascot()}>
              <DaxMascot theme={theme} />
            </Show>

            <box
              width="100%"
              backgroundColor={inputBg()}
              border={["round"]}
              borderColor={theme.borderActive}
              padding={tiny() ? 0 : 1}
            >
              <Prompt
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                }}
                hint={Hint}
              />
            </box>

            <Show when={showActions() && !tiny()}>
              <box width="100%" flexDirection="row" justifyContent="center" gap={1} flexWrap="wrap" alignItems="center">
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
              </box>
            </Show>

            <Show when={showFirstRunGuide()}>
              <box width="100%" flexDirection="column" gap={1}>
                <box width="100%" flexDirection="row" gap={1} flexWrap="wrap">
                  <HomeInfoCard title="Quick Start" body={welcomeSummary()} theme={theme} tone="accent" />
                  <HomeInfoCard
                    title="DAX Modes"
                    body="Plan: Safe steps · Build: Implement changes · Explore: Learn codebase · Audit: Find risks"
                    theme={theme}
                    tone="default"
                  />
                </box>
                <box width="100%" flexDirection="row" gap={1} flexWrap="wrap">
                  <HomeInfoCard
                    title="Safety First"
                    body="DAX pauses for review before risky actions. Approve, deny, or allow patterns."
                    theme={theme}
                    tone="default"
                  />
                  <HomeInfoCard
                    title="Setup Status"
                    body={doctorSummary()}
                    theme={theme}
                    tone={mcpAttention() || mcpBlocked() ? "warning" : "default"}
                  />
                </box>
                <box width="100%" flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
                  <PromptStarter
                    label="Explore repo"
                    theme={theme}
                    onPress={() => setPromptDraft(firstRunIntent(), false, "explore")}
                  />
                  <PromptStarter
                    label="Plan next steps"
                    theme={theme}
                    onPress={() => setPromptDraft(promptText("plan"), false, "plan")}
                  />
                  <Show when={mcpAttention() || mcpBlocked()}>
                    <PromptStarter
                      label="dax doctor"
                      theme={theme}
                      onPress={() =>
                        setPromptDraft(
                          "Explain what `dax doctor` checks, what is optional, and how to fix the current setup issues.",
                          false,
                          "docs",
                        )
                      }
                    />
                  </Show>
                </box>
              </box>
            </Show>

            <Show when={showSessions()}>
              <box width="100%" marginTop={1} flexDirection="column" gap={0}>
                <Show when={(sync.data.overview?.pendingApprovals.length ?? 0) > 0}>
                  <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                    {"  "}PENDING APPROVALS
                  </text>
                  <box flexDirection="column" gap={0} marginBottom={1}>
                    <For each={sync.data.overview?.pendingApprovals.slice(0, 2)}>
                      {(approval) => {
                        const ageMs = Date.now() - new Date(approval.createdAt).getTime()
                        const ageLabel = formatAge(ageMs)
                        const isStale = ageMs > 7 * 24 * 60 * 60 * 1000
                        return (
                          <box
                            onMouseUp={() => {
                              navigate({ type: "session", sessionID: approval.runId })
                            }}
                            paddingLeft={2}
                            paddingRight={2}
                            paddingTop={0}
                            paddingBottom={0}
                            flexDirection="row"
                            justifyContent="space-between"
                          >
                            <text fg={theme.warning}>
                              ⚠ {approval.title.length > 35 ? approval.title.slice(0, 32) + "..." : approval.title}
                            </text>
                            <box flexDirection="row" gap={1}>
                              <text fg={isStale ? theme.warning : theme.textMuted} dim={!isStale}>
                                {ageLabel}
                              </text>
                              <text fg={theme.textMuted}>{approval.risk}</text>
                            </box>
                          </box>
                        )
                      }}
                    </For>
                  </box>
                </Show>

                <Show when={(sync.data.overview?.activeRuns.length ?? 0) > 0}>
                  <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                    {"  "}ACTIVE RUNS
                  </text>
                  <box flexDirection="column" gap={0} marginBottom={1}>
                    <For each={sync.data.overview?.activeRuns.slice(0, 3)}>
                      {(r) => (
                        <box
                          onMouseUp={() => {
                            navigate({ type: "session", sessionID: r.runId })
                          }}
                          paddingLeft={2}
                          paddingRight={2}
                          paddingTop={0}
                          paddingBottom={0}
                          flexDirection="row"
                          justifyContent="space-between"
                        >
                          <box flexDirection="column" gap={0}>
                            <text fg={theme.primary}>
                              ▸{" "}
                              {r.title
                                ? r.title.length > 45
                                  ? r.title.slice(0, 42) + "..."
                                  : r.title
                                : r.runId.slice(0, 8)}
                            </text>
                            <Show when={r.currentStep}>
                              <text fg={theme.textMuted} dim>
                                {r.currentStep?.title?.slice(0, 35) ?? "in progress"}
                              </text>
                            </Show>
                          </box>
                          <box flexDirection="column" gap={0} alignItems="flex-end">
                            <text fg={theme.textMuted}>{r.status}</text>
                            <Show when={r.pendingApprovalCount > 0}>
                              <text fg={theme.warning} dim>
                                ⚠ {r.pendingApprovalCount}
                              </text>
                            </Show>
                          </box>
                        </box>
                      )}
                    </For>
                  </box>
                </Show>

                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  {"  "}RECENT RUNS
                </text>
                <box flexDirection="column" gap={0}>
                  <For each={sync.data.overview?.recentRuns.slice(0, 3)}>
                    {(r) => (
                      <box
                        onMouseUp={() => {
                          navigate({ type: "session", sessionID: r.runId })
                        }}
                        paddingLeft={2}
                        paddingRight={2}
                        paddingTop={0}
                        paddingBottom={0}
                        flexDirection="row"
                        justifyContent="space-between"
                      >
                        <text fg={theme.text}>
                          ▸{" "}
                          {r.title
                            ? r.title.length > 50
                              ? r.title.slice(0, 47) + "..."
                              : r.title
                            : r.runId.slice(0, 8)}
                        </text>
                        <text fg={theme.textMuted}>{new Date(r.updatedAt).toLocaleDateString()}</text>
                      </box>
                    )}
                  </For>
                </box>
              </box>
            </Show>

            <Show when={showHomeTips()}>
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
                <Match when={mcpAttention()}>
                  <text fg={mcpBlocked() ? theme.warning : theme.error}>!</text>
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
