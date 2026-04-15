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
import { useSDK } from "../context/sdk"
import { isMcpStatusAttention, isMcpStatusBlocked } from "@/dax/status"
import { deriveHomeLayout } from "./home-layout"
import { deriveFeatureBranchNudge } from "@/dax/presentation/vcs-guard"
import { DAX_GUIDE_SESSION_FOOTER, DAX_GUIDE_SESSION_PROMPT, DAX_GUIDE_SESSION_TITLE } from "../util/guide-session"
import os from "os"
import path from "path"
import { Header } from "./session/header"
import { Footer } from "./session/footer"
import { MacOSScrollAccel } from "@opentui/core"

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

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 17) return "Good afternoon"
  return "Good evening"
}

let once = false

// ── Brand letters with animated cycling colors ────────────────────────────────
function BrandLetters(props: { theme: any; small?: boolean }) {
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const t = setInterval(() => setTick((v) => v + 1), 80)
    onCleanup(() => clearInterval(t))
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
    <box flexDirection="row" gap={0} height={1}>
      <For each={letters}>
        {(letter, index) => (
          <text fg={letterColor(index())} attributes={letterBlink(index()) ? TextAttributes.BOLD : undefined}>
            {letter}
          </text>
        )}
      </For>
    </box>
  )
}

// ── Mascot — unchanged animation, repositioned to top-right ──────────────────
function DaxMascot(props: { theme: any }) {
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const t = setInterval(() => setTick((v) => v + 1), 480)
    onCleanup(() => clearInterval(t))
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
    <box flexDirection="column" gap={0} paddingRight={1}>
      <box flexDirection="row" gap={0}>
        <text fg={eyeColor()}>{eyeL()}</text>
        <text fg={props.theme.textMuted}>{scan()}</text>
        <text fg={eyeColor()}>{eyeR()}</text>
      </box>
      <text fg={props.theme.borderSubtle}> ┴ </text>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main Home view
// ──────────────────────────────────────────────────────────────────────────────
export function Home() {
  const themeState = useTheme()
  const theme = new Proxy({} as any, {
    get: (_target, prop: string) => (themeState.theme as any)[prop],
  })
  const dimensions = useTerminalDimensions()
  const sync = useSync()
  const { navigate } = useRoute()
  const route = useRouteData("home")
  const kv = useKV()
  const local = useLocal()
  const command = useCommandDialog()
  const promptRef = usePromptRef()
  const sdk = useSDK()
  const toast = useToast()
  const directory = useDirectory()
  const args = useArgs()
  const width = createMemo(() => dimensions().width)
  const height = createMemo(() => dimensions().height)
  let prompt: PromptRef

  const [tipsHidden] = kv.signal("tips_hidden", false)
  const [showTips] = kv.signal("tips_visibility", true)
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const showHomeTips = createMemo(() => showTips() && !tipsHidden() && height() > 30)

  const activeWorkflowMode = createMemo<HomeWorkflowMode>(() =>
    kv.get(DAX_SETTING.session_workflow_mode, "plan") as HomeWorkflowMode
  )

  const dirName = createMemo(() => path.basename(directory()))
  const branch = createMemo(() => sync.data.vcs?.branch)
  const modelName = createMemo(() => {
    const m = local.model.current()
    if (!m) return "no model"
    return `${m.providerID}/${m.modelID}`
  })

  const sessionCount = createMemo(() => sync.data.session.length)
  const visibleActiveRuns = createMemo(() => sync.data.overview?.activeRuns ?? [])
  const visibleRecentRuns = createMemo(() => sync.data.overview?.recentRuns ?? [])

  const connectedMcpCount = createMemo(
    () => Object.values(sync.data.mcp).filter((x) => x.status === "connected").length,
  )
  const mcpAttention = createMemo(() => Object.values(sync.data.mcp).some((x) => isMcpStatusAttention(x as any)))
  const mcpBlocked = createMemo(() => Object.values(sync.data.mcp).some((x) => isMcpStatusBlocked(x as any)))

  const isFirstTimeUser = createMemo(() => sessionCount() === 0)

  async function openGuideSession() {
    const result = await sdk.client.session.create({
      title: DAX_GUIDE_SESSION_TITLE,
      directory: directory(),
    })
    if (result.data?.id) {
      await sdk.client.session.prompt({
        sessionID: result.data.id,
        parts: [{ type: "text", text: DAX_GUIDE_SESSION_PROMPT }],
      })
      navigate({ type: "session", sessionID: result.data.id })
    }
  }

  const greeting = getGreeting()
  const displayName = os.userInfo().username || "operator"


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
      explore: "Explore this repository. Map the entry points, execution flow, key files, unknowns, and next reading targets.",
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
    if (!text) return
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
    </Show>
  )

  const layout = createMemo(() =>
    deriveHomeLayout({
      width: width(),
      height: height(),
      sessionCount: sessionCount(),
      tipsVisible: showTips(),
    }),
  )

  const tiny = createMemo(() => width() < 60)
  const small = createMemo(() => width() < 90)
  const showMascot = createMemo(() => width() > 70 && height() > 24)
  const showActions = createMemo(() => height() > 20)
  const showSessions = createMemo(() => height() > 28)

  const smartChips = createMemo(() => [
    { label: "Plan fix", tone: "accent" as const, prompt: promptText("plan"), mode: "plan" as const },
    { label: "Explore repo", tone: "primary" as const, prompt: promptText("explore"), mode: "explore" as const },
    { label: "Audit risks", tone: "warning" as const, prompt: promptText("audit"), mode: "audit" as const },
    { label: "Read docs", tone: "muted" as const, prompt: promptText("docs"), mode: "docs" as const },
  ])

  return (
    <box height="100%" flexDirection="column" backgroundColor={theme.background}>
      <Header
        busy={sync.status === "loading"}
        emphasis="normal"
        onCyclePersona={() => {}}
      />

      <scrollbox flexGrow={1} width="100%" scrollAcceleration={process.platform === "darwin" ? new MacOSScrollAccel() : undefined}>
        <box
          flexDirection="column"
          alignItems="center"
          paddingTop={2}
          paddingBottom={4}
          gap={tiny() ? 1 : 2}
        >
          <box width="100%" maxWidth={layout().maxWidth} alignItems="center" gap={tiny() ? 0 : 1}>

            {/* ── Greeting row: text left, mascot right ── */}
            <box width="100%" flexDirection="row" justifyContent="space-between" alignItems="flex-start">
              <box flexDirection="column" gap={0} flexGrow={1}>
                {/* Time-aware greeting with username */}
                <Show when={!tiny()}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {greeting}, {displayName}.
                  </text>
                </Show>
                {/* Animated D A X letters + tagline */}
                <box flexDirection="row" gap={1} alignItems="center">
                  <BrandLetters theme={theme} />
                  <Show when={!tiny()}>
                    <text fg={theme.textMuted} dim>
                      ·  operative · online
                    </text>
                  </Show>
                </box>
              </box>
              <Show when={showMascot()}>
                <DaxMascot theme={theme} />
              </Show>
            </box>

            {/* ── Workspace context card ── */}
            <Show when={!tiny() && !small()}>
              <WorkspaceCard
                dirName={dirName()}
                branch={branch()}
                modelName={modelName()}
                theme={theme}
              />
            </Show>

            {/* ── Prompt input ── */}
            <box width="100%">
              <Prompt
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                }}
                hint={Hint}
              />
            </box>

            {/* ── Smart chips ── */}
            <Show when={showActions() && !tiny()}>
              <box width="100%" flexDirection="column" gap={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD} dim>QUICK START</text>
                <box flexDirection="row" gap={1} flexWrap="wrap" alignItems="flex-start">
                  <For each={smartChips()}>
                    {(chip) => (
                      <SmartChip
                        label={chip.label}
                        tone={chip.tone}
                        theme={theme}
                        onPress={() => setPromptDraft(chip.prompt, false, chip.mode)}
                      />
                    )}
                  </For>
                </box>
              </box>
            </Show>

            {/* ── Sessions list ── */}
            <Show when={showSessions()}>
              <box
                width="100%"
                flexDirection="column"
                gap={0}
                backgroundColor={theme.backgroundPanel}
                borderStyle="round"
                borderColor={theme.borderSubtle}
                paddingTop={1}
                paddingBottom={1}
              >

                {/* First-time guide */}
                <Show when={isFirstTimeUser()}>
                  <SectionDivider label="START HERE" theme={theme} />
                  <box
                    flexDirection="row"
                    justifyContent="space-between"
                    paddingLeft={2}
                    paddingRight={2}
                    onMouseUp={() => { openGuideSession().catch(() => {}) }}
                  >
                    <box flexDirection="row" gap={1}>
                      <PulseArrow theme={theme} />
                      <text fg={theme.text} attributes={TextAttributes.BOLD}>
                        {DAX_GUIDE_SESSION_TITLE}
                      </text>
                    </box>
                    <text fg={theme.textMuted}>{DAX_GUIDE_SESSION_FOOTER}</text>
                  </box>
                </Show>

                {/* Active runs */}
                <Show when={visibleActiveRuns().length > 0}>
                  <SectionDivider label="ACTIVE" theme={theme} />
                  <box flexDirection="column" gap={0}>
                    <For each={visibleActiveRuns().slice(0, 3)}>
                      {(r) => (
                        <box
                          onMouseUp={() => { navigate({ type: "session", sessionID: r.runId }) }}
                          paddingLeft={2}
                          paddingRight={2}
                          flexDirection="row"
                          justifyContent="space-between"
                        >
                          <box flexDirection="column" gap={0}>
                            <text fg={theme.primary}>
                              ▸{" "}
                              {r.title
                                ? r.title.length > 45 ? r.title.slice(0, 42) + "..." : r.title
                                : r.runId.slice(0, 8)}
                            </text>
                            <Show when={r.currentStep}>
                              <text fg={theme.textMuted} dim>
                                {"  "}{r.currentStep?.title?.slice(0, 40) ?? "in progress"}
                              </text>
                            </Show>
                          </box>
                          <box flexDirection="column" gap={0} alignItems="flex-end">
                            <text fg={theme.textMuted}>{r.status}</text>
                            <Show when={r.status === "waiting_approval" && r.pendingApprovalCount > 0}>
                              <text fg={theme.warning} dim>⚠ {r.pendingApprovalCount}</text>
                            </Show>
                          </box>
                        </box>
                      )}
                    </For>
                  </box>
                </Show>

                {/* Recent runs */}
                <Show when={visibleRecentRuns().length > 0}>
                  <SectionDivider label="RECENT" theme={theme} />
                  <box flexDirection="column" gap={0}>
                    <For each={visibleRecentRuns().slice(0, 5)}>
                      {(r) => (
                        <RecentRunRow
                          title={r.title ?? r.runId.slice(0, 8)}
                          status={r.status}
                          ageMs={Date.now() - new Date(r.updatedAt).getTime()}
                          theme={theme}
                          onOpen={() => navigate({ type: "session", sessionID: r.runId })}
                        />
                      )}
                    </For>
                  </box>
                </Show>

              </box>
            </Show>

            {/* Tips */}
            <Show when={showHomeTips()}>
              <box width="100%" maxWidth={56} alignItems="center">
                <Tips />
              </box>
            </Show>

          </box>
        </box>
      </scrollbox>

      <Footer
        workflowMode={activeWorkflowMode()}
        onCycleWorkflowMode={() => cycleWorkflowMode(1)}
      />
      <Toast />
    </box>
  )
}

function SectionDivider(props: { label: string; theme: any }) {
  return (
    <box flexDirection="row" gap={1} alignItems="center" marginTop={1} marginBottom={1} paddingLeft={1}>
      <text fg={props.theme.border}>──</text>
      <text fg={props.theme.textMuted} attributes={TextAttributes.BOLD}>
        {props.label}
      </text>
      <box flexGrow={1} height={1} border={["bottom"]} borderColor={props.theme.border} marginBottom={0.5} />
    </box>
  )
}

function WorkspaceCard(props: { dirName: string; branch?: string; modelName: string; theme: any }) {
  return (
    <box
      width="100%"
      flexDirection="row"
      gap={2}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={tint(props.theme.background, props.theme.textMuted, 0.02)}
      borderStyle="round"
      borderColor={props.theme.borderSubtle}
    >
      <box flexDirection="column" gap={0}>
        <text fg={props.theme.textMuted} dim>
          PROJECT
        </text>
        <text fg={props.theme.text} attributes={TextAttributes.BOLD}>
          {props.dirName}
        </text>
      </box>
      <Show when={props.branch}>
        <box flexDirection="column" gap={0}>
          <text fg={props.theme.textMuted} dim>
            BRANCH
          </text>
          <text fg={props.theme.accent}>{props.branch}</text>
        </box>
      </Show>
      <box flexDirection="column" gap={0}>
        <text fg={props.theme.textMuted} dim>
          MODEL
        </text>
        <text fg={props.theme.secondary}>{props.modelName}</text>
      </box>
    </box>
  )
}

function SmartChip(props: { label: string; tone: "primary" | "accent" | "warning" | "muted"; theme: any; onPress: () => void }) {
  const color = () => {
    if (props.tone === "primary") return props.theme.primary
    if (props.tone === "accent") return props.theme.accent
    if (props.tone === "warning") return props.theme.warning
    return props.theme.textMuted
  }
  return (
    <box
      onMouseUp={props.onPress}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={tint(props.theme.background, color(), 0.08)}
      borderStyle="round"
      borderColor={tint(color(), props.theme.background, 0.4)}
    >
      <text fg={color()}>{props.label}</text>
    </box>
  )
}

function RecentRunRow(props: { title: string; status: string; ageMs: number; theme: any; onOpen: () => void }) {
  return (
    <box
      onMouseUp={props.onOpen}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      justifyContent="space-between"
    >
      <box flexDirection="row" gap={1}>
        <text fg={props.theme.textMuted} dim>
          ·
        </text>
        <text fg={props.theme.text}>{props.title}</text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={props.theme.textMuted} dim>
          {props.status}
        </text>
        <text fg={props.theme.textMuted} dim>
          {formatAge(props.ageMs)}
        </text>
      </box>
    </box>
  )
}

function PulseArrow(props: { theme: any }) {
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const t = setInterval(() => setTick((v) => v + 1), 600)
    onCleanup(() => clearInterval(t))
  })
  return <text fg={tick() % 2 === 0 ? props.theme.primary : props.theme.textMuted}>▶</text>
}
