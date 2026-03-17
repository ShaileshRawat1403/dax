import { createMemo, For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import type { AssistantMessage } from "@dax-ai/sdk/v2"
import { useTerminalDimensions } from "@opentui/solid"
import { classifyAssistantNarrativeIntensity } from "@/dax/assistant-narrative"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"
import { isEli12Mode } from "@/dax/intent"
import { deriveWorkstationState, type WorkstationState } from "@/dax/presentation/workstation"

function ContextBand(props: { state: WorkstationState }) {
  const { theme } = useTheme()
  const phases: Array<{ id: typeof props.state.phase; label: string; icon: string }> = [
    { id: "understand", label: "Understand", icon: "🔍" },
    { id: "plan", label: "Plan", icon: "📝" },
    { id: "execute", label: "Execute", icon: "🚀" },
    { id: "verify", label: "Verify", icon: "✅" },
  ]

  const activeIndex = () => phases.findIndex((p) => p.id === props.state.phase)

  return (
    <box flexDirection="column" gap={0} marginTop={1}>
      <box flexDirection="row" gap={2}>
        <For each={phases}>
          {(phase, index) => {
            const active = index() <= activeIndex()
            const current = phase.id === props.state.phase
            return (
              <box flexDirection="row" gap={1}>
                <text fg={current ? theme.primary : active ? theme.text : theme.textMuted}>
                  {current ? "●" : active ? "◉" : "○"} {phase.icon} {phase.label}
                </text>
                {index() < phases.length - 1 && <text fg={theme.textMuted}>→</text>}
              </box>
            )
          }}
        </For>
      </box>

      <Show when={props.state.planSummary.totalSteps > 0}>
        <box flexDirection="row" gap={1} marginTop={1}>
          <text fg={theme.textMuted}>
            Step {props.state.planSummary.currentStepIndex}/{props.state.planSummary.totalSteps}:
          </text>
          <text fg={theme.text}>
            <b>{props.state.currentStep}</b>
          </text>
        </box>
      </Show>
    </box>
  )
}

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
  const route = useRouteData("session")
  const sync = useSync()
  const kv = useKV()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(route.sessionID)!)
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])

  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const toggleEli12 = () => {
    kv.set(DAX_SETTING.explain_mode, explainMode() ? "normal" : "eli12")
  }

  const activeAgent = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant") as AssistantMessage | undefined
    if (!last) return "DAX"
    return last.agent.toUpperCase()
  })

  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTick((t) => (t + 1) % 10), 200)
    onCleanup(() => clearInterval(timer))
  })

  const lifecycleColor = createMemo(() => {
    const label = props.lifecycleLabel ?? ""
    if (/approval/i.test(label)) return theme.warning
    if (/blocked|failed/i.test(label)) return theme.error
    if (/completed|ready/i.test(label)) return theme.success
    return theme.accent
  })
  const sessionIntent = createMemo(() => {
    const s = session()
    if (!s) return "Loading..."
    const user = messages().find((x) => x.role === "user")
    if (!user) return s.title
    const part = (sync.data.part[user.id] ?? []).find((x) => x.type === "text" && "text" in x && x.text.trim())
    if (!part || !("text" in part)) return s.title
    const body = part.text
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[.!?].*$/, "")
    if (!body) return s.title
    const text = body[0].toUpperCase() + body.slice(1)
    if (text.length <= 44) return text
    return `${text.slice(0, 41)}...`
  })
  const title = createMemo(() => props.sessionLabel ?? sessionIntent())
  const shellIntensity = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant") as AssistantMessage | undefined
    if (!last) return "guided" as const
    const parent = last.parentID ? messages().find((x) => x.id === last.parentID && x.role === "user") : undefined
    const askedPart =
      parent && (sync.data.part[parent.id] ?? []).find((x) => x.type === "text" && "text" in x && x.text.trim())
    const asked = askedPart && "text" in askedPart ? askedPart.text : ""
    const parts = sync.data.part[last.id] ?? []
    return classifyAssistantNarrativeIntensity({
      asked,
      mode: last.mode,
      hasPendingTool: parts.some((part) => part.type === "tool" && part.state.status === "pending"),
      hasToolActivity: parts.some((part) => part.type === "tool"),
      toolCount: parts.filter((part) => part.type === "tool").length,
      hasExecuteTool: parts.some(
        (part) => part.type === "tool" && ["write", "edit", "apply_patch", "bash"].includes(part.tool),
      ),
      hasVerifyTool: parts.some((part) => part.type === "tool" && ["read", "grep", "list", "glob"].includes(part.tool)),
      hasReasoning: parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0),
      hasError: !!last.error,
      completed: !!last.time.completed,
      doing: "",
      next: "",
    })
  })

  const dimensions = useTerminalDimensions()
  const width = createMemo(() => dimensions().width)
  const tiny = createMemo(() => width() < 60)
  const wide = createMemo(() => width() >= 90)
  const showSessionTitle = createMemo(() => shellIntensity() === "operational" && wide())
  const showLifecycle = createMemo(
    () => shellIntensity() !== "light" || props.emphasis === "normal" || !!props.currentStep || !!props.trustLabel,
  )
  const detailColor = createMemo(() => (props.emphasis === "muted" ? theme.textMuted : theme.warning))
  const trustText = createMemo(() => (props.trustLabel ? `Trust ${props.trustLabel.toLowerCase()}` : undefined))

  return (
    <box flexShrink={0} backgroundColor={theme.backgroundPanel}>
      <box paddingTop={0} paddingBottom={0} paddingLeft={1} paddingRight={1} flexShrink={0}>
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.primary} attributes={TextAttributes.BOLD}>
              DAX
            </text>
            <Show when={props.busy}>
              <text fg={tick() % 2 === 0 ? theme.accent : theme.textMuted}>●</text>
            </Show>
            <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1} marginLeft={1}>
              <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                {activeAgent()}
              </text>
            </box>
            <Show when={showSessionTitle()}>
              <>
                <text fg={theme.textMuted}>{title()}</text>
                <text fg={theme.textMuted}>·</text>
              </>
            </Show>
            <Show when={explainMode()}>
              <box backgroundColor={theme.success} paddingLeft={1} paddingRight={1} marginRight={1}>
                <text fg={theme.background} attributes={TextAttributes.BOLD}>
                  ELI12
                </text>
              </box>
            </Show>
            <Show when={kv.get(DAX_SETTING.refine_mode, false)}>
              <box backgroundColor={theme.accent} paddingLeft={1} paddingRight={1} marginRight={1}>
                <text fg={theme.background} attributes={TextAttributes.BOLD}>
                  ✧ REFINE
                </text>
              </box>
            </Show>
            <Show when={showLifecycle()}>
              <text
                fg={shellIntensity() === "light" ? theme.textMuted : theme.text}
                attributes={props.emphasis === "normal" ? TextAttributes.BOLD : undefined}
              >
                {props.lifecycleLabel?.toUpperCase()}
              </text>
            </Show>
            <Show when={!!props.currentStep}>
              <text fg={theme.textMuted}>·</text>
              <text fg={lifecycleColor()}>{props.currentStep}</text>
            </Show>
            <Show when={!tiny() && props.trustLabel}>
              <text fg={theme.textMuted}>·</text>
              <text fg={detailColor()} attributes={props.emphasis === "normal" ? TextAttributes.BOLD : undefined}>
                {trustText()}
              </text>
            </Show>
          </box>

          <box flexDirection="row" gap={1} alignItems="center">
            <box 
              onMouseUp={toggleEli12} 
              flexDirection="row" 
              backgroundColor={theme.backgroundElement}
              paddingLeft={1} 
              paddingRight={1}
            >
              <text fg={!explainMode() ? theme.primary : theme.textMuted} attributes={!explainMode() ? TextAttributes.BOLD : undefined}>NORMAL</text>
              <text fg={theme.textMuted}>|</text>
              <text fg={explainMode() ? theme.primary : theme.textMuted} attributes={explainMode() ? TextAttributes.BOLD : undefined}>ELI12</text>
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
