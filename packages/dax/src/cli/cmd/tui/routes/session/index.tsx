import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  on,
  Show,
  ErrorBoundary,
  Switch,
  useContext,
} from "solid-js"
import {
  applyPersonaVoice,
  getPersona,
  PERSONAS,
  PERSONA_SWITCH_MESSAGES,
  type PersonaPack,
} from "@/dax/presentation/persona"
import { Dynamic } from "solid-js/web"
import path from "path"
import { useRoute, useRouteData } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { useTheme, tint } from "@tui/context/theme"
import {
  BoxRenderable,
  ScrollBoxRenderable,
  addDefaultParsers,
  MacOSScrollAccel,
  type ScrollAcceleration,
  TextAttributes,
  RGBA,
} from "@opentui/core"
import { Prompt, type PromptRef } from "@tui/component/prompt"
import type { AssistantMessage, Part, ToolPart, UserMessage, TextPart, ReasoningPart } from "@dax-ai/sdk/v2"
import { useLocal } from "@tui/context/local"
import { Locale } from "@/util/locale"
import type { Tool } from "@/tool/tool"
import { ShellTool } from "@/tool/shell"
import { TodoWriteTool } from "@/tool/todo"
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useKeybind } from "@tui/context/keybind"
import { Header } from "./header"
import { parsePatch } from "diff"
import { useDialog } from "../../ui/dialog"
import { DialogMessage } from "./dialog-message"
import type { PromptInfo } from "../../component/prompt/history"
import { DialogConfirm } from "@tui/ui/dialog-confirm"
import { DialogTimeline } from "./dialog-timeline"
import { DialogForkFromTimeline } from "./dialog-fork-from-timeline"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { DialogDiff } from "../../component/dialog-diff"
import { DialogStatus } from "../../component/dialog-status"
import { Flag } from "@/flag/flag"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import { Clipboard } from "@tui/util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { onGeminiReauthRequired, onGeminiThrottle } from "@/plugin/gemini"
import { useKV } from "../../context/kv.tsx"
import { Editor } from "../../util/editor"
import stripAnsi from "strip-ansi"
import { Footer } from "./footer.tsx"
import { usePromptRef } from "../../context/prompt"
import { useExit } from "../../context/exit"
import { useUIActivity } from "../../context/activity"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { Identifier } from "@/id/id"
import { Auth } from "@/auth"
import { Instance } from "@/project/instance"
import { PermissionPrompt } from "./permission"
import { RAOPane } from "./rao-pane"
import { AuditLogPane } from "../../component/prompt/audit-log"
import { RuntimePane } from "../../component/prompt/runtime-pane"
import { RefinePane } from "../../component/prompt/refine"
import { OperatorPane } from "../../component/prompt/operator-pane"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { formatTranscript } from "../../util/transcript"
import { UI } from "@/cli/ui.ts"
import { labelStage, type StreamStage } from "@/dax/workflow/stage"
import { PM } from "@/pm"
import { formatPMList, formatPMRules, parsePMList, parsePMRules } from "@/pm/format"
import {
  PANE_MODE,
  deriveActivePaneMode,
  deriveAutoPaneMode,
  paneCompactLabel,
  type PaneFollowMode,
  type PaneMode,
  type PaneVisibility,
  paneLabel as daxPaneLabel,
  paneTitle as daxPaneTitle,
} from "@/dax/presentation/pane"
import { sessionWorkflowModeKey } from "@/dax/settings"
import { deriveWorkstationState, type WorkstationState } from "@/dax/presentation/workstation"
import { buildEvidenceLedger } from "@/dax/presentation/evidence-ledger"
import {
  deriveAuditHistory,
  deriveLiveSessionStageState,
  deriveOperatorTraceLine,
} from "@/dax/presentation/session-surface"
import {
  hasMemoryContext,
  resolveDisplayDetailToggles,
  shouldShowWorkstationPane,
  shouldShowInterventionQueue,
  type DisplayMode,
} from "@/dax/presentation/session-display"
import { buildInterventionProjection, buildProposedChangesProjection } from "@/server/run-projections"
import type { ProposedChange as ProjectedProposedChange, RunEvent } from "@/server/run-contract"
import { VerificationReceipt } from "../../component/receipt"
import {
  buildStreamItems,
  deriveLiveNarrativeStatus,
  deriveToolNarrativeDescriptor,
  stripInlineMarkdown,
  getCurrentPhase,
  getActivePhases,
  type RenderableStreamItem,
} from "@/dax/presentation/session-stream"
import { StreamItem } from "../../component/stream"
import { TodoStreamBlock } from "../../component/stream/todo-stream-block"

const HIDDEN_TOOLS = new Set(["todowrite", "reflection"])
const COMPACT_TOOLS = new Set(["read", "glob", "grep", "list"])
const COMPACT_MIN = 3
type CompactGroup = {
  type: "tool.group"
  id: string
  toolName: string
  count: number
  parts: ToolPart[]
  representativePath?: string
}
import { isEli12Mode } from "@/dax/intent"
import { DAX_SETTING } from "@/dax/settings"
import {
  latestContextUsage,
  sessionCostTotal,
  sessionTokenTotal,
  sessionAssistantMessages,
} from "@/dax/session-metrics"
import { isGeminiSubscriptionLane } from "@/provider/gemini-subscription"
import { formatSessionExitMessage } from "./exit-message"
import { deriveFeatureBranchNudge } from "@/dax/presentation/vcs-guard"
import { deriveGitHubCINudge } from "@/dax/presentation/ci-guard"

addDefaultParsers(parsers.parsers)

type PMTab = "note" | "list" | "rules"
type WorkflowMode = "build" | "plan" | "explore" | "docs"
const WORKFLOW_MODES: WorkflowMode[] = ["plan", "build", "explore", "docs"]
const WORKFLOW_AGENT_MODES = new Set<WorkflowMode>(["plan", "build", "explore", "docs"])
const MUTATION_INTENT_RE =
  /\b(create|add|edit|update|change|fix|delete|remove|rename|move|install|run|execute|patch|write|commit|push|release|publish)\b/i
const LIVE_FOLLOW_FRAMES = ["●", "◉", "●", "◎"]
const STAGE_VERBS: Record<string, string[]> = {
  thinking: ["Brooding", "Thinking", "Scrying", "Sketching"],
  exploring: ["Surveying", "Tracing", "Mapping", "Delving"],
  planning: ["Planning", "Structuring", "Sequencing", "Framing"],
  executing: ["Working", "Forging", "Building", "Applying"],
  verifying: ["Checking", "Verifying", "Inspecting", "Confirming"],
  done: ["Ready"],
}

const NARRATIVE_FOLLOW_SLACK = 2
const FOLLOW_RESUME_THRESHOLD = 1

type ThemeShape = ReturnType<typeof useTheme>["theme"]

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

const context = createContext<{
  width: number
  wide: boolean
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
  showAssistantMetadata: () => boolean
  diffWrapMode: () => "word" | "none"
  sync: ReturnType<typeof useSync>
}>()

function use() {
  const ctx = useContext(context)
  if (!ctx) throw new Error("useContext must be used within a Session component")
  return ctx
}

function isLikelyMutationRequest(text: string | undefined) {
  if (!text) return false
  return MUTATION_INTENT_RE.test(text)
}

export function Session() {
  const local = useLocal()
  const PANE_MODES = PANE_MODE
  let narrativeScroll: ScrollBoxRenderable | undefined

  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  const sdk = useSDK()
  const command = useCommandDialog()
  const dialog = useDialog()

  const [personaId, setPersonaId] = kv.signal<string>(DAX_SETTING.session_persona, "mission")
  const activePersona = createMemo(() => getPersona(personaId()))
  const cyclePersona = () => {
    const ids = Object.keys(PERSONAS)
    const nextId = ids[(ids.indexOf(personaId()) + 1) % ids.length]!
    setPersonaId(() => nextId)

    // Inject switch notification
    const nextPersona = getPersona(nextId)
    const rawMessage = PERSONA_SWITCH_MESSAGES[nextId] || `Switched to ${nextPersona.label}`
    const voicedMessage = applyPersonaVoice(rawMessage, nextPersona)

    sdk.client.session
      .prompt({
        sessionID: route.sessionID,
        parts: [{ type: "text", text: voicedMessage }],
        noReply: true,
      })
      .catch(() => {})
  }
  const themeState = useTheme()
  const theme = new Proxy({} as any, {
    get: (_target, prop: string) => (themeState.theme as any)[prop],
  })
  const syntax = themeState.syntax
  const promptRef = usePromptRef()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const children = createMemo(() => {
    const s = session()
    if (!s) return []
    const parentID = s.parentID ?? s.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => (route.sessionID ? (sync.data.message[route.sessionID] ?? []) : []))
  const lifecycle = createMemo(() => (route.sessionID ? (sync.data.lifecycle[route.sessionID] ?? []) : []))

  const projectedRun = createMemo(() => sync.data.run[route.sessionID])

  const interventions = createMemo(() => projectedRun()?.interventions ?? [])

  const evidenceLedger = createMemo(() => buildEvidenceLedger(projectedRun()))

  const permissions = createMemo(() => {
    if (projectedRun()) {
      return (projectedRun()?.approvals ?? [])
        .filter((a) => a.type !== "question")
        .map((a) => ({
          id: a.approvalId,
          sessionID: a.runId,
          permission: a.type,
          patterns: [a.reason],
          always: [],
          createdAt: new Date(a.createdAt).getTime(),
          tool: a.context?.stepId ? { messageID: "", callID: a.context.stepId } : undefined,
          metadata: {
            command: a.context?.command,
            filePath: a.context?.filePath,
            diff: a.context?.diffPreview,
          },
        }))
    }
    if (!session() || session()?.parentID) return []
    const legacy = children().flatMap((x) => sync.data.permission[x.id] ?? [])
    return legacy
  })

  const proposedChanges = createMemo<ProjectedProposedChange[]>(() => {
    if (projectedRun()) return projectedRun()?.proposedChanges ?? []
    return []
  })

  const streamItems = createMemo((): RenderableStreamItem[] => {
    return buildStreamItems(projectedRun(), messages(), sync.data.part)
  })

  const lastMessageIndex = createMemo(() => {
    const items = streamItems()
    if (!items || items.length === 0) return -1
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item && (item.kind === "message.user" || item.kind === "message.assistant")) {
        return i
      }
    }
    return -1
  })

  const sessionTelemetry = createMemo(() => {
    const totalTokens = sessionTokenTotal(messages())
    const totalCost = sessionCostTotal(messages())
    const context = latestContextUsage(messages(), sync.data.provider)
    const lastAssistant = [...messages()]
      .reverse()
      .find(
        (m): m is Extract<typeof m, { role: "assistant" } & { providerID?: string }> =>
          m.role === "assistant" && "providerID" in m && !!m.providerID,
      )
    const modelName = lastAssistant?.providerID ? `${lastAssistant.providerID}/${lastAssistant.modelID}` : null
    const completedGeneratedTokens = (sessionAssistantMessages(messages()) as AssistantMessage[]).reduce(
      (sum, m) => sum + (m.tokens?.output ?? 0),
      0,
    )

    // For the currently streaming (incomplete) message, estimate live token count
    // from text part lengths since tokens.output isn't populated until completion.
    const streamingMsg = (sessionAssistantMessages(messages()) as AssistantMessage[]).find((m) => !m.time.completed)
    const streamingTokens = streamingMsg
      ? Math.round(
          (sync.data.part[streamingMsg.id] ?? [])
            .filter((p) => p.type === "text")
            .reduce((sum, p) => sum + ((p as { text?: string }).text?.length ?? 0), 0) / 4,
        )
      : 0

    const generatedTokens = completedGeneratedTokens + streamingTokens
    return {
      tokens: totalTokens,
      generatedTokens,
      cost: totalCost,
      contextPercent: context?.percentage ?? null,
      model: modelName,
    }
  })

  const currentRun = createMemo(() => {
    return projectedRun()?.header
  })

  const currentStep = createMemo(() => {
    if (projectedRun()) return projectedRun()?.header.currentStep
    const events = lifecycle()
    const stepEvent = events.findLast((e) => e.type === "plan.step_promoted")
    return stepEvent?.properties
  })

  const modernTrust = createMemo(() => {
    if (projectedRun()) {
      const summary = projectedRun()?.summary
      if (summary?.trust) return summary.trust
    }
    const events = lifecycle()
    const auditEvent = events.findLast((e) => e.type === "audit.posture_updated")
    return auditEvent?.properties?.trust
  })

  const questions = createMemo(() => {
    const legacy = !session() || session()?.parentID ? [] : children().flatMap((x) => sync.data.question[x.id] ?? [])

    if (projectedRun()) {
      const projectedQuestions = (projectedRun()?.approvals ?? [])
        .filter((a) => a.type === "question")
        .map((a) => ({
          id: a.approvalId,
          sessionID: a.runId,
          questions: [
            {
              question: a.reason,
              header: a.title,
              options: [],
              custom: true,
            },
          ],
        }))
      if (projectedQuestions.length > 0) return projectedQuestions
      return legacy
    }
    return legacy
  })

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const chatActive = createMemo(() => pending() !== undefined)

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const [conceal, setConceal] = createSignal(false)
  const [showThinking, setShowThinking] = kv.signal("thinking_visibility", true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", false)
  const [showAssistantMetadata, setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showEli12Summary, setShowEli12Summary] = kv.signal(DAX_SETTING.eli12_summary_visibility, false)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [animationsEnabled, setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [paneVisibility, setPaneVisibility] = kv.signal<PaneVisibility>(DAX_SETTING.session_pane_visibility, "auto")
  const [paneMode, setPaneMode] = kv.signal<PaneMode>(DAX_SETTING.session_pane_mode, "refine")
  const [paneFollowMode, setPaneFollowMode] = kv.signal<PaneFollowMode>(DAX_SETTING.session_pane_follow_mode, "smart")
  const normalizedPaneMode = createMemo<PaneMode>(() => {
    const mode = paneMode() as string
    return PANE_MODE.includes(mode as PaneMode) ? (mode as PaneMode) : "refine"
  })
  createEffect(() => {
    if (paneMode() !== normalizedPaneMode()) {
      setPaneMode(() => normalizedPaneMode())
    }
  })
  const workflowMode = createMemo<WorkflowMode>(() => kv.get(sessionWorkflowModeKey(route.sessionID), "plan"))
  const setWorkflowMode = (next: WorkflowMode) => kv.set(sessionWorkflowModeKey(route.sessionID), next)

  const [displayMode] = kv.signal<DisplayMode>(DAX_SETTING.display_mode, "operator")
  const [pmTab, setPmTab] = kv.signal<PMTab>(DAX_SETTING.session_pm_tab, "note")
  const [queueVisibleRaw, setQueueVisibleRaw] = kv.signal<string | boolean>(
    DAX_SETTING.intervention_queue_visible,
    true,
  )
  const [selectedProposedChangeId, setSelectedProposedChangeId] = createSignal<string>()
  const [memoryListText, setMemoryListText] = createSignal("")
  const [memoryRulesText, setMemoryRulesText] = createSignal("")
  const [memoryLoadError, setMemoryLoadError] = createSignal<string | undefined>(undefined)
  // Keep the refine draft reactive across pane visibility changes.
  const refinedPrompt = createMemo(() => {
    kv.store[DAX_SETTING.session_pane_mode]
    kv.store[DAX_SETTING.session_pane_visibility]
    kv.store[DAX_SETTING.session_refined_prompt]
    return (kv.get(DAX_SETTING.session_refined_prompt) as string) || ""
  })
  const refineSection = (heading: string) => {
    const match = refinedPrompt().match(new RegExp(`^##\\s+${heading}[\\s\\S]*?(?=^##\\s+|$)`, "m"))
    if (!match) return []
    return match[0]
      .split("\n")
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\s*(?:-|\d+\.)\s+/, "").trim())
      .filter(Boolean)
  }
  const refineExecutionProfile = createMemo(() => refineSection("Execution Profile"))
  const refineWrites = createMemo(() => refineSection("Likely Writes"))
  const refineApprovals = createMemo(() => refineSection("Approval Forecast"))
  const refineUnknowns = createMemo(() => refineSection("Unknowns & Assumptions"))
  const refineGovernance = createMemo(() => refineSection("Governance Hints"))
  const refineValidationPlan = createMemo(() => refineSection("Validation Plan"))

  useUIActivity()
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const toggleEli12 = () => kv.set(DAX_SETTING.explain_mode, explainMode() ? "normal" : "eli12")
  const promptDisabled = createMemo(() => !!session()?.parentID)
  createEffect(() => {
    const changes = proposedChanges()
    const selected = selectedProposedChangeId()
    if (changes.length === 0) {
      setSelectedProposedChangeId(undefined)
      return
    }
    if (!selected || !changes.some((change) => change.changeId === selected)) {
      setSelectedProposedChangeId(changes[0].changeId)
    }
  })
  createEffect(() => {
    const mode = workflowMode()
    if (!WORKFLOW_MODES.includes(mode)) return
    const local = useLocal()
    const availableAgents = local.agent.list()
    if (availableAgents.length === 0) return
    if (local.agent.current()?.name === mode) return
    if (!availableAgents.some((a) => a.name === mode)) return
    local.agent.set(mode)
  })
  onCleanup(() => {
    promptRef.set(undefined)
  })

  const toast = useToast()
  onMount(() => {
    const unsubReauth = onGeminiReauthRequired((url) => {
      toast.show({
        variant: "warning",
        message: `Gemini session expired — sign in to continue: ${url}`,
        duration: 30_000,
      })
    })
    const unsubThrottle = onGeminiThrottle(({ reason, retryInMs, attempt }) => {
      const secs = Math.ceil(retryInMs / 1000)
      const label =
        reason === "MODEL_CAPACITY_EXHAUSTED"
          ? "Gemini model at capacity"
          : "Gemini rate limited"
      toast.show({
        variant: "warning",
        message: `${label} — retrying in ${secs}s (attempt ${attempt})`,
        duration: Math.min(retryInMs, 8_000),
      })
    })
    onCleanup(() => {
      unsubReauth()
      unsubThrottle()
    })
  })

  const isThinking = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant")
    if (!last) return false
    if (!last.time.completed) return true
    const parts = sync.data.part[last.id] ?? []
    return parts.some((p) => p.type === "tool" && p.state.status === "pending")
  })

  const paneLabel = (mode: PaneMode) => daxPaneLabel(mode, explainMode())
  const paneTitle = (mode: PaneMode) => daxPaneTitle(mode, explainMode())
  const selectedProposedChange = createMemo(() => {
    const changes = proposedChanges()
    const selected = selectedProposedChangeId()
    return changes.find((change) => change.changeId === selected) ?? changes[0]
  })
  const activeInterventions = createMemo(() =>
    interventions().filter((item) => item.status === "requested" || item.status === "pending"),
  )
  const approvalQueueCount = createMemo(() => permissions().length + questions().length)
  const openApprovalsPane = () => {
    setPaneMode(() => "approvals")
    setPaneVisibility(() => "pinned")
    setPaneFollowMode(() => "smart")
    setFollowing(false)
  }
  const interventionKindLabel = (kind: string) => {
    switch (kind) {
      case "approval":
        return "Approval review"
      case "ambiguity":
        return "Needs direction"
      case "recovery":
        return "Needs recovery"
      case "policy_violation":
        return "Policy blocked"
      case "risk_escalation":
        return "Risk escalated"
      default:
        return kind.replace(/_/g, " ")
    }
  }
  const proposedChangeStatusLabel = (status: ProjectedProposedChange["status"]) => {
    switch (status) {
      case "pending":
        return "review needed"
      case "approved_not_applied":
        return "approved, ready to run"
      case "applied":
        return "applied"
      case "rejected":
        return "rejected"
      case "stale":
        return "superseded"
    }
  }
  const proposedChangeStatusColor = (status: ProjectedProposedChange["status"]) => {
    switch (status) {
      case "pending":
        return theme.warning
      case "approved_not_applied":
        return theme.primary
      case "applied":
        return theme.success
      case "rejected":
        return theme.error
      case "stale":
        return theme.textMuted
    }
  }
  const sessionStatusType = createMemo(() => sync.data.session_status?.[route.sessionID]?.type ?? "idle")
  const todo = createMemo(() => sync.data.todo[route.sessionID] ?? [])
  const stageState = createMemo<{ stage: StreamStage; reason: string }>(() =>
    deriveLiveSessionStageState({
      permissionsCount: permissions().length,
      questionsCount: questions().length,
      sessionStatusType: sessionStatusType(),
      pendingID: pending(),
      partsForMessage: (messageID) => sync.data.part[messageID] ?? [],
    }),
  )
  const STAGE_MIN_DWELL_MS = 600
  const [displayStageState, setDisplayStageState] = createSignal(stageState())
  const [stageLastChangedAt, setStageLastChangedAt] = createSignal(Date.now())
  createEffect(() => {
    const next = stageState()
    const current = displayStageState()

    if (next.stage === current.stage) {
      if (next.reason !== current.reason) {
        setDisplayStageState({ stage: current.stage, reason: next.reason })
      }
      return
    }

    if (next.stage === "done" || next.stage === "waiting") {
      setDisplayStageState(next)
      setStageLastChangedAt(Date.now())
      return
    }

    const elapsed = Date.now() - stageLastChangedAt()
    if (elapsed < STAGE_MIN_DWELL_MS) {
      const timer = setTimeout(() => {
        setDisplayStageState(stageState())
        setStageLastChangedAt(Date.now())
      }, STAGE_MIN_DWELL_MS - elapsed)
      onCleanup(() => clearTimeout(timer))
      return
    }

    setDisplayStageState(next)
    setStageLastChangedAt(Date.now())
  })

  const stageLabel = createMemo(() => labelStage(displayStageState().stage, explainMode()))
  const liveNarrativeStatus = createMemo(() =>
    deriveLiveNarrativeStatus({
      pendingID: pending(),
      partsForMessage: (messageID) => sync.data.part[messageID] ?? [],
    }),
  )
  const [following, setFollowing] = createSignal(true)
  const [motionTick, setMotionTick] = createSignal(0)
  const [verbTick, setVerbTick] = createSignal(0)

  const pendingStartedAt = createMemo(
    () => messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.time.created ?? 0,
  )
  const runElapsed = createMemo(() => {
    if (!chatActive()) return 0
    motionTick() // reactive dependency — updates every 480ms
    return Date.now() - pendingStartedAt()
  })

  createEffect(() => {
    if (!animationsEnabled()) return
    const timer = setInterval(() => setMotionTick((tick) => tick + 1), 480)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    if (!animationsEnabled()) return
    const timer = setInterval(() => setVerbTick((tick) => tick + 1), 1600)
    onCleanup(() => clearInterval(timer))
  })

  const whimsicalVerb = createMemo(() => {
    const stage = displayStageState().stage
    const verbs = STAGE_VERBS[stage] ?? STAGE_VERBS.thinking!
    return verbs[verbTick() % verbs.length]!
  })

  // whimsicalVerb must be declared before doing() so the closure resolves correctly
  const doing = createMemo(() => {
    const stage = displayStageState().stage
    if (stage === "done") return "Ready"
    if (stage === "waiting") return "Awaiting input"
    if (stage === "retrying") return "Retrying"
    return whimsicalVerb()
  })

  const detailToggles = createMemo(() =>
    resolveDisplayDetailToggles({
      displayMode: displayMode(),
      showThinking: showThinking(),
      showTimestamps: timestamps() === "show",
      showDetails: showDetails(),
      showAssistantMetadata: showAssistantMetadata(),
    }),
  )
  const showLiveStatusNote = createMemo(() => !chatActive() && displayStageState().stage !== "done")
  const modeLabel = createMemo(() => local.agent.current().name.toUpperCase())

  const wide = createMemo(() => dimensions().width > 120)
  const narrow = createMemo(() => dimensions().width < 80)
  const liveStacked = createMemo(() => !wide())

  const contentWidth = createMemo(() => dimensions().width - 4)

  const livePaneWidth = createMemo(() => {
    if (liveStacked()) return contentWidth()
    const base = Math.floor(contentWidth() * 0.35)
    return Math.max(42, Math.min(60, base))
  })

  const compactPaneTabs = createMemo(() => !liveStacked() && livePaneWidth() < 48)
  const mainPaneGrow = createMemo(() => (liveStacked() ? 1 : 7))
  const sidePaneGrow = createMemo(() => (liveStacked() ? 1 : 3))
  const paneDiffView = createMemo(() => {
    const availableWidth = liveStacked() ? contentWidth() : livePaneWidth()
    return availableWidth > 80 ? "side-by-side" : "unified"
  })
  const followEnabled = () => following()
  const followGlyph = createMemo(() => {
    if (!following()) return "○"
    if (!animationsEnabled()) return "●"
    const busy = sessionStatusType() === "busy" || !!pending()
    if (!busy) return "●"
    return LIVE_FOLLOW_FRAMES[motionTick() % LIVE_FOLLOW_FRAMES.length] ?? "●"
  })
  const followActionLabel = createMemo(() => {
    if (following()) {
      return sessionStatusType() === "busy" || pending() ? `${followGlyph()} FOLLOWING` : "FOLLOWING"
    }
    return "○ FOLLOW"
  })
  const liveBorderColor = createMemo(() => {
    if (!animationsEnabled() || !(sessionStatusType() === "busy" || pending())) return theme.borderSubtle
    return motionTick() % 4 < 2 ? theme.borderActive : tint(theme.borderSubtle, theme.primary, 0.45)
  })

  const recentTooling = createMemo(() => {
    const items: Array<{ label: string; status?: string }> = []
    const limit = 12
    for (const msg of messages().slice(-3)) {
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []
      for (const p of parts) {
        if (p.type === "tool") {
          const trace = deriveOperatorTraceLine(p)
          items.push({ label: trace?.summary ?? p.tool, status: p.state.status })
        }
      }
    }
    return items.slice(-limit).reverse()
  })

  /** Recent tool traces for the right panel evidence ledger — last 5 completed tools */
  const recentEvidenceTraces = createMemo(() => {
    const traces: Array<{ label: string; meta?: string; failed: boolean }> = []
    for (const msg of messages().slice(-3)) {
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []
      for (const p of parts) {
        if (p.type !== "tool" || p.state.status !== "completed") continue
        const trace = deriveOperatorTraceLine(p)
        if (!trace) continue
        const meta = extractResultMeta(trace.result)
        traces.push({
          label: describeNarrativeTrace(trace),
          meta,
          failed: trace.result.includes("failed"),
        })
      }
    }
    return traces.slice(-5)
  })

  const auditHistory = createMemo(() =>
    deriveAuditHistory({
      messages: messages(),
      messageText: (id) =>
        (sync.data.part[id] ?? [])
          .filter((p): p is Extract<(typeof sync.data.part)[string][number], { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join(""),
    }),
  )
  const latestAudit = createMemo(() => auditHistory().findLast((entry) => entry.result !== undefined))

  const workstationState = createMemo(() => {
    const s = session()
    const pr = projectedRun()
    const summary = pr?.summary
    const audit = latestAudit()?.result
    const art = (sync.data as any).session_artifact?.[route.sessionID] ?? []

    if (summary) {
      return deriveWorkstationState({
        sessionID: route.sessionID,
        stage: displayStageState().stage,
        stageReason: displayStageState().reason,
        sessionStatusType: summary.status === "running" ? "busy" : "idle",
        goal: summary.outcome?.summaryText || s?.title,
        todo: todo().map((t) => ({ content: t.content, status: t.status })),
        reflection: (s?.state_v2 as any)?.reflection,
        reflectionHistory: (s?.state_v2 as any)?.reflection_history ?? [],
        approvals: (pr.approvals as any[]).map((p: any) => ({
          label: p.title || p.permission,
          reason: p.reason || (p.metadata?.reason as string | undefined),
        })),
        questions: questions().length,
        artifacts: pr.artifacts.map((a: any) => ({ label: a.title || a.path || a.id, kind: a.type })),
        diffCount: pr.proposedChanges.length,
        audit: summary.trust
          ? {
              status: summary.trust.posture as any,
              blockerCount: summary.trust.blocked ? 1 : 0, // Simplified for now
              warningCount: 0,
              infoCount: 0,
            }
          : undefined,
        planQuality: (s?.state_v2 as any)?.plan_quality,
        completionProof: (s?.state_v2 as any)?.completion_proof,
        blastRadius: (s?.state_v2 as any)?.blast_radius,
        recentTooling: recentTooling(),
        alert: undefined,
      })
    }

    return deriveWorkstationState({
      sessionID: route.sessionID,
      stage: displayStageState().stage,
      stageReason: displayStageState().reason,
      sessionStatusType: sessionStatusType() as any,
      goal: s?.title,
      todo: todo().map((t) => ({ content: t.content, status: t.status })),
      reflection: (s?.state_v2 as any)?.reflection,
      reflectionHistory: (s?.state_v2 as any)?.reflection_history ?? [],
      approvals: (permissions() as any[]).map((p: any) => ({
        label: p.permission,
        reason: p.metadata?.reason as string | undefined,
      })),
      questions: questions().length,
      artifacts: art.map((a: any) => ({ label: a.path || a.id, kind: a.kind })),
      diffCount: proposedChanges().length,
      audit: audit
        ? {
            status: audit.status,
            blockerCount: audit.summary.blocker_count,
            warningCount: audit.summary.warning_count,
            infoCount: audit.summary.info_count,
          }
        : undefined,
      planQuality: (s?.state_v2 as any)?.plan_quality,
      completionProof: (s?.state_v2 as any)?.completion_proof,
      recentTooling: recentTooling(),
      alert: undefined,
    })
  })

  const hasLivePaneContext = createMemo(() => {
    if (activeInterventions().length > 0) return true
    if (proposedChanges().length > 0) return true
    if (workstationState().planSummary.totalSteps > 0) return true
    return false
  })

  const memoryList = createMemo(() => parsePMList(memoryListText()))
  const memoryRules = createMemo(() => parsePMRules(memoryRulesText()))
  const memoryNote = createMemo(() => {
    const current = workstationState().reflection
    const previous = workstationState().reflectionHistory[0]
    if (current?.goal) {
      return current.goal
    }
    if (previous?.goal) {
      return previous.goal
    }
    return workstationState().goal
  })
  const memoryHasContext = createMemo(() =>
    hasMemoryContext({
      reflectionPresent: !!workstationState().reflection,
      reflectionHistoryCount: workstationState().reflectionHistory.length,
      pmListCount: memoryList().rows.length,
      pmRuleCount: memoryRules().rows.length,
    }),
  )
  const memoryState = createMemo(() => {
    const error = memoryLoadError()
    if (error && /no context found for instance/i.test(error)) {
      return {
        tone: "empty" as const,
        title: "Memory snapshot not available yet",
        detail: "Use /pm rules to add durable context, or let the current run build more working memory.",
      }
    }
    if (error) {
      return {
        tone: "error" as const,
        title: "Memory load error",
        detail: error,
      }
    }
    return undefined
  })

  const hasDiffNeed = createMemo(() => proposedChanges().length > 0 || workstationState().artifactSummary.count > 0)
  const hasApprovalsNeed = createMemo(() => activeInterventions().length > 0 || approvalQueueCount() > 0)
  const hasAuditNeed = createMemo(() => workstationState().auditSummary.posture !== "clear")
  const hasRefineNeed = createMemo(() => workstationState().planQuality?.decision === "pause")

  const recentTools = createMemo(() => {
    const items: Array<{ tool: string; status: string; label: string; command?: string; output?: string }> = []
    for (const msg of messages().slice(-5)) {
      if (msg.role !== "assistant") continue
      const parts = sync.data.part[msg.id] ?? []
      for (const part of parts) {
        if (part.type !== "tool") continue
        const trace = deriveOperatorTraceLine(part)
        const metadata =
          "metadata" in part.state
            ? ((part.state.metadata ?? {}) as Record<string, unknown>)
            : ({} as Record<string, unknown>)
        const input = (part.state.input ?? {}) as Record<string, unknown>
        const output =
          typeof metadata.output === "string"
            ? metadata.output
            : typeof metadata.result === "string"
              ? metadata.result
              : undefined
        items.push({
          tool: part.tool,
          status: part.state.status,
          label: trace?.summary ?? part.tool,
          command: typeof input.command === "string" ? input.command : undefined,
          output,
        })
      }
    }
    return items.slice(-20).reverse()
  })

  const sessionSafeguards = createMemo(() => {
    const ciNudge = deriveGitHubCINudge({
      recentTools: recentTools(),
      branch: sync.data.vcs?.branch,
    })
    const branchNudge = deriveFeatureBranchNudge({
      branch: sync.data.vcs?.branch,
      workflowMode: workflowMode(),
      hasConcreteChanges: hasDiffNeed(),
    })
    return { ciNudge, branchNudge }
  })

  const voice = (text: string) => {
    try {
      return applyPersonaVoice(text, activePersona())
    } catch {
      return text
    }
  }

  const operatorNextMove = createMemo(() => {
    const fallback = {
      tone: "muted" as const,
      title: "Standing by",
      detail: voice("Ready for your next direction."),
    }
    try {
      const stageState = displayStageState()
      const stage = stageState?.stage ?? "ready"
      const mode = workstationState().lifecycle
      const current = workstationState()
      const ciNudge = deriveGitHubCINudge({
        recentTools: recentTools(),
        branch: sync.data.vcs?.branch,
      })
      const branchNudge = deriveFeatureBranchNudge({
        branch: sync.data.vcs?.branch,
        workflowMode: workflowMode(),
        hasConcreteChanges: hasDiffNeed(),
      })
      const latestUserMessage = [...messages()].reverse().find((msg) => msg.role === "user")
      const latestUserText = latestUserMessage
        ? (sync.data.part[latestUserMessage.id] ?? [])
            .filter((part) => part.type === "text")
            .map((part: any) => String(part.text ?? ""))
            .join(" ")
            .trim()
        : ""
      const liveNext = liveNarrativeStatus().next

      if (mode === "awaiting_approval") {
        return {
          tone: "warning" as const,
          title: "Review required",
          detail: voice(current.approvalSummary.topReason ?? "Review the pending request to proceed."),
        }
      }

      if (mode === "blocked") {
        return {
          tone: "error" as const,
          title: "Execution blocked",
          detail: voice("A policy or error is preventing progress. Check the details below."),
        }
      }

      if (workflowMode() !== "build" && isLikelyMutationRequest(latestUserText)) {
        const currentMode = workflowMode().toUpperCase()
        return {
          tone: "warning" as const,
          title: "Promote to Build mode",
          detail: voice(
            `${currentMode} mode is read-first. Switch to Build for file edits or command execution, then approve any risky action.`,
          ),
        }
      }

      if (current.completionProof && !current.completionProof.ready) {
        return {
          tone: "warning" as const,
          title: "Completion evidence missing",
          detail: voice(
            `Resolve: ${current.completionProof.missing.slice(0, 2).join(", ") || "verification evidence"}.`,
          ),
        }
      }

      if (current.planQuality?.decision === "pause") {
        return {
          tone: "warning" as const,
          title: "Refine execution contract",
          detail: voice(
            "Plan quality is paused. Use refine to add scope, validation, and rollback detail before edits.",
          ),
        }
      }

      if (ciNudge) {
        return {
          tone: ciNudge.tone,
          title: ciNudge.title,
          detail: voice(ciNudge.detail),
        }
      }

      if (branchNudge && (workflowMode() === "build" || hasDiffNeed())) {
        return {
          tone: branchNudge.tone,
          title: branchNudge.title,
          detail: voice(branchNudge.detail),
        }
      }

      if (stage === "verifying" && hasAuditNeed()) {
        return {
          tone: "accent" as const,
          title: "Inspect validation findings",
          detail: voice("Review the audit pane before treating this run as complete."),
        }
      }

      if ((stage === "verifying" || stage === "done") && hasDiffNeed()) {
        return {
          tone: "primary" as const,
          title: "Review concrete changes",
          detail: voice("Open changes to inspect the diff and confirm workspace outcome."),
        }
      }

      if (mode === "completed") {
        return {
          tone: "success" as const,
          title: "Run finished",
          detail: voice("The execution goal has been reached. Review results or start a new task."),
        }
      }

      if (pending() && liveNext) {
        return {
          tone: stage === "executing" ? ("accent" as const) : ("primary" as const),
          title:
            stage === "planning"
              ? "Planning next move"
              : stage === "verifying"
                ? "Carrying verification forward"
                : "Following live step",
          detail: voice(liveNext),
        }
      }

      if (stage === "thinking" || stage === "exploring") {
        return {
          tone: "primary" as const,
          title: "Analyzing request",
          detail: voice(current.currentStep ?? "Collecting context for the next governed step."),
        }
      }

      if (stage === "planning") {
        return {
          tone: "primary" as const,
          title: "Drafting plan",
          detail: voice(current.currentStep ?? "Structuring the next step with scope and verification."),
        }
      }

      if (stage === "executing") {
        return {
          tone: "accent" as const,
          title: "Applying changes",
          detail: voice(current.currentStep ?? "Running the current tool action in scoped mode."),
        }
      }

      if (stage === "verifying") {
        return {
          tone: "success" as const,
          title: "Verifying result",
          detail: voice(current.currentStep ?? "Collecting verification evidence before completion."),
        }
      }
      return fallback
    } catch {
      return fallback
    }
  })

  const operatorNextMoveSafe = createMemo(() => {
    const nextMove = operatorNextMove()
    if (nextMove?.title) return nextMove
    return {
      tone: "muted" as const,
      title: "Standing by",
      detail: voice("Ready for your next direction."),
    }
  })

  function cyclePaneVisibility() {
    const next = paneVisibility() === "auto" ? "pinned" : paneVisibility() === "pinned" ? "hidden" : "auto"
    setPaneVisibility(() => next)
  }

  const scrollAcceleration = () => (process.platform === "darwin" ? new MacOSScrollAccel() : new CustomSpeedScroll(1))

  const narrativeBottomOffset = () => {
    if (!narrativeScroll) return 0
    return narrativeScroll.scrollHeight - (narrativeScroll.scrollTop + narrativeScroll.height)
  }

  const isNarrativeNearBottom = () => narrativeBottomOffset() <= NARRATIVE_FOLLOW_SLACK
  const wasNarrativeNearBottom = (scrollTop: number, scrollHeight: number, viewportHeight: number) =>
    scrollHeight - (scrollTop + viewportHeight) <= FOLLOW_RESUME_THRESHOLD

  const scrollNarrative = (options?: { force?: boolean }) => {
    if (!narrativeScroll) return
    if (!options?.force && !followEnabled()) return
    try {
      setLastProgrammaticScrollAt(Date.now())
      narrativeScroll.scrollTo(narrativeScroll.scrollHeight)
    } catch {
      // Keep rendering resilient if scrollbox metrics are transiently unavailable.
    }
  }

  const toggleNarrativeFollow = () => {
    setFollowing((f) => {
      const next = !f
      if (next) setTimeout(() => scrollNarrative({ force: true }), 0)
      return next
    })
  }

  const [lastMessageCount, setLastMessageCount] = createSignal(0)
  createEffect(() => {
    const count = streamItems().length
    if (count !== lastMessageCount()) {
      setLastMessageCount(count)
      scrollNarrative()
    }
  })

  const [lastPartCount, setLastPartCount] = createSignal(0)
  createEffect(() => {
    let total = 0
    for (const msg of messages()) {
      total += (sync.data.part[msg.id] ?? []).length
    }
    if (total !== lastPartCount()) {
      setLastPartCount(total)
      scrollNarrative()
    }
  })

  const [lastNarrativeHeight, setLastNarrativeHeight] = createSignal(0)
  const [lastNarrativeScrollTop, setLastNarrativeScrollTop] = createSignal(0)
  const [lastProgrammaticScrollAt, setLastProgrammaticScrollAt] = createSignal(0)
  createEffect(() => {
    const timer = setInterval(
      () => {
        const scroll = narrativeScroll
        if (!scroll) return
        const previousTop = lastNarrativeScrollTop()
        const previousHeight = lastNarrativeHeight()
        const currentTop = scroll.scrollTop
        const nextHeight = scroll.scrollHeight
        const viewportHeight = scroll.height
        const topChanged = currentTop !== previousTop
        const heightChanged = nextHeight !== lastNarrativeHeight()
        const nearBottomBefore = wasNarrativeNearBottom(previousTop, previousHeight, viewportHeight)
        const userMovedAway =
          topChanged &&
          Date.now() - lastProgrammaticScrollAt() > 120 &&
          !isNarrativeNearBottom() &&
          currentTop < previousTop

        if (userMovedAway && following()) {
          setFollowing(false)
        }

        if (!following() && isNarrativeNearBottom()) {
          setFollowing(true)
        }

        if (heightChanged && followEnabled() && nearBottomBefore) {
          scrollNarrative({ force: true })
        }
        setLastNarrativeScrollTop(scroll.scrollTop)
        setLastNarrativeHeight(scroll.scrollHeight)
      },
      animationsEnabled() ? 220 : 280,
    )
    onCleanup(() => clearInterval(timer))
  })

  const renderer = useRenderer()
  // Stream-level keyboard parity: keys only fire when the prompt textarea is NOT focused,
  // so they don't intercept normal typing. These mirror mouse-only affordances on inline
  // alerts and reasoning blocks for keyboard-first TUI users.
  useKeyboard((evt) => {
    if (promptRef.current?.focused) return
    if (evt.ctrl || evt.meta || evt.shift) return
    if (evt.name === "r" && hasApprovalsNeed()) {
      openApprovalsPane()
      return
    }
    if (evt.name === "t") {
      setShowThinking((v) => !v)
      return
    }
  })

  const openPmPane = () => {
    setPaneMode(() => "memory")
    setPaneVisibility(() => "pinned")
  }

  const operatorControls = createMemo(() => ({
    speed: kv.get(DAX_SETTING.operator_speed, "balanced"),
    verbosity: kv.get(DAX_SETTING.operator_verbosity, "balanced"),
    risk: kv.get(DAX_SETTING.operator_risk, "balanced"),
    approval: kv.get(DAX_SETTING.operator_approval, "normal"),
  }))

  const applyOperatorInstructionOnce = () => {
    const instruction = kv.get(DAX_SETTING.operator_instruction, "").trim()
    const prompt = promptRef.current
    if (!instruction) {
      toast.show({ variant: "warning", message: "Add an instruction first.", duration: 2000 })
      return
    }
    if (!prompt?.alive) {
      toast.show({ variant: "warning", message: "Prompt is not ready yet.", duration: 2000 })
      return
    }
    const current = prompt.current.input.trimEnd()
    const next = current
      ? `${current}\n\nOperator instruction for this turn: ${instruction}`
      : `Operator instruction for this turn: ${instruction}`
    prompt.set({ input: next, parts: prompt.current.parts })
    prompt.focus()
    toast.show({ variant: "success", message: "Instruction added to the next prompt.", duration: 2200 })
  }

  const applyOperatorInstructionSession = () => {
    const instruction = kv.get(DAX_SETTING.operator_instruction, "").trim()
    if (!instruction) {
      toast.show({ variant: "warning", message: "Add an instruction first.", duration: 2000 })
      return
    }
    toast.show({ variant: "success", message: "Instruction will apply to future prompts.", duration: 2200 })
  }

  const exportSessionTranscript = async () => {
    const info = session()
    if (!info) {
      toast.show({ variant: "error", message: "Session data is not available.", duration: 2500 })
      return
    }
    const options = await DialogExportOptions.show(
      dialog,
      `${info.title.replace(/[^\w.-]+/g, "_") || route.sessionID}.md`,
      detailToggles().showThinking,
      true,
      detailToggles().showAssistantMetadata,
      false,
    )
    if (!options) return

    const transcript = formatTranscript(
      info,
      messages().map((message) => ({
        info: message,
        parts: sync.data.part[message.id] ?? [],
      })),
      {
        thinking: options.thinking,
        toolDetails: options.toolDetails,
        assistantMetadata: options.assistantMetadata,
      },
    )

    if (options.openWithoutSaving) {
      const editorResult = await Editor.open({ value: transcript, renderer })
      if (editorResult === undefined) {
        await Clipboard.copy(transcript).catch(() => {})
        toast.show({ variant: "info", message: "Transcript copied to clipboard.", duration: 2500 })
        return
      }
      toast.show({ variant: "success", message: "Transcript opened in your editor.", duration: 2500 })
      return
    }

    const filename = options.filename.trim() || `${route.sessionID}.md`
    const outputPath = path.resolve(process.cwd(), filename)
    await Bun.write(outputPath, transcript)
    toast.show({ variant: "success", message: `Transcript saved to ${filename}.`, duration: 3000 })
  }

  const forkCurrentSession = async () => {
    const result = await sdk.client.session.fork({ sessionID: route.sessionID })
    if (!result.data?.id) {
      toast.show({ variant: "error", message: "Failed to fork session.", duration: 2500 })
      return
    }
    navigate({
      type: "session",
      sessionID: result.data.id,
      initialPrompt: promptRef.current?.current,
    })
    toast.show({ variant: "success", message: "Forked into a new session.", duration: 2200 })
  }

  const runOperatorCommand = async (name: "/clear" | "/export" | "/fork" | "/help") => {
    if (name === "/clear") {
      promptRef.current?.reset()
      toast.show({ variant: "info", message: "Prompt cleared.", duration: 1800 })
      return
    }
    if (name === "/export") {
      await exportSessionTranscript()
      return
    }
    if (name === "/fork") {
      await forkCurrentSession()
      return
    }
    if (name === "/help") {
      command.trigger("help.show")
    }
  }

  const openRefinePane = () => {
    setPaneMode(() => "refine")
    setPaneVisibility(() => "pinned")
  }

  const selectPaneMode = (mode: PaneMode) => {
    setPaneMode(() => mode)
    setPaneVisibility(() => "pinned")
    setFollowing(false)
  }

  const showPane = createMemo(() => {
    return shouldShowWorkstationPane({
      displayMode: displayMode(),
      paneVisibility: paneVisibility(),
      hasCriticalIntervention: hasApprovalsNeed(),
      hasAuditNeed: hasAuditNeed(),
      hasRefineNeed: hasRefineNeed(),
    })
  })

  const priorityPaneMode = createMemo<PaneMode>(() => {
    if (hasApprovalsNeed()) return "approvals"
    if (hasAuditNeed()) return "audit"
    return "refine"
  })

  const activePaneMode = createMemo<PaneMode>(() =>
    deriveActivePaneMode({
      hasApprovals: hasApprovalsNeed(),
      hasRefineDraft: hasRefineNeed(),
      hasAuditAttention: hasAuditNeed(),
      hasDiffContext: proposedChanges().length > 0,
      hasLiveContext: hasLivePaneContext(),
      hasMemoryContext: memoryHasContext(),
      hasPlanContext: workstationState().planSummary.totalSteps > 0,
      liveStage: displayStageState().stage,
      fallback: priorityPaneMode(),
      paneMode: normalizedPaneMode(),
      paneVisibility: paneVisibility(),
      paneFollowMode: paneFollowMode(),
      following: following(),
    }),
  )

  const refreshMemorySnapshot = async () => {
    try {
      const project_id = Instance.project.id
      const [notes, rules] = await Promise.all([
        PM.list_dsr({ project_id, limit: 20 }),
        PM.list_constraints({ project_id, limit: 30 }),
      ])
      const listText = formatPMList(notes.map((x) => ({ day: x.day, title: x.title, tags: x.tags })))
      const rulesText = formatPMRules(
        rules.map((x) => ({
          ruleType: x.rule_type,
          pattern: x.pattern,
          action: x.action,
          source: x.source,
        })),
      )
      setMemoryListText(listText)
      setMemoryRulesText(rulesText)
      setMemoryLoadError(undefined)
    } catch (error) {
      setMemoryLoadError(error instanceof Error ? error.message : "Unable to load memory snapshot")
    }
  }

  createEffect(
    on(
      () => route.sessionID,
      (sessionID) => {
        if (!sessionID) return
        void sync.session.sync(sessionID)
        void refreshMemorySnapshot()
      },
      { defer: false },
    ),
  )
  createEffect(() => {
    if (activePaneMode() === "memory") void refreshMemorySnapshot()
  })

  const paneBadge = (mode: PaneMode): string | undefined => {
    switch (mode) {
      case "approvals":
        return workstationState().approvalSummary.pendingCount > 0
          ? String(workstationState().approvalSummary.pendingCount)
          : undefined
      case "audit":
        return workstationState().auditSummary.findingsCount > 0
          ? String(workstationState().auditSummary.findingsCount)
          : undefined
      default:
        return undefined
    }
  }

  const paneDiffFiletype = createMemo(() => {
    const change = selectedProposedChange()
    if (!change) return "text"
    const ext = path.extname(change.filePath).toLowerCase()
    return LANGUAGE_EXTENSIONS[ext] ?? "text"
  })

  const refineStatus = createMemo(() => {
    const quality = workstationState().planQuality
    if (!quality) return undefined
    if (quality.decision === "pause") {
      return {
        tone: "warning" as const,
        label: `${quality.score}/100`,
        reason: voice("The execution plan needs more detail before I can safely mutate the workspace."),
      }
    }
    return {
      tone: "success" as const,
      label: `${quality.score}/100`,
      reason: voice("The plan is concrete and ready for execution."),
    }
  })

  const todoSummary = createMemo(() => {
    const steps = workstationState().planSummary.steps
    return {
      total: steps.length,
      completed: steps.filter((step) => step.status === "done").length,
      active: steps.filter((step) => step.status === "active").length,
      pending: steps.filter((step) => step.status === "pending").length,
    }
  })

  const trustSurface = createMemo(() => ({
    label: workstationState().trustLabel.toLowerCase(),
    color:
      workstationState().trustPosture === "blocked"
        ? theme.error
        : workstationState().trustPosture === "review_needed"
          ? theme.warning
          : theme.success,
  }))

  return (
    <context.Provider
      value={{
        width: contentWidth(),
        wide: wide(),
        sessionID: route.sessionID,
        conceal: () => conceal(),
        showThinking: () => detailToggles().showThinking,
        showTimestamps: () => detailToggles().showTimestamps,
        showDetails: () => detailToggles().showDetails,
        showAssistantMetadata: () => detailToggles().showAssistantMetadata,
        diffWrapMode: () => diffWrapMode(),
        sync,
      }}
    >
      <box id="session-root" height="100%" flexDirection="column" backgroundColor={theme.background}>
        <Header
          persona={activePersona()}
          onCyclePersona={cyclePersona}
          sessionLabel={session()?.title}
          lifecycle={workstationState().lifecycle}
          lifecycleLabel={workstationState().lifecycleLabel}
          decisionState={stageLabel()}
          trustLabel={workstationState().trustLabel}
          trustPosture={workstationState().trustPosture}
          pendingApprovals={workstationState().approvalSummary.pendingCount}
          verificationStatus={
            workstationState().completionProof?.ready ? "PASS" : workstationState().completionProof ? "FAIL" : undefined
          }
          emphasis={showPane() ? "muted" : "normal"}
          busy={sessionStatusType() === "busy" || sessionStatusType() === "retry" || sessionStatusType() === "delayed"}
          contextPercent={sessionTelemetry().contextPercent ?? undefined}
          actions={[
            {
              label: followActionLabel(),
              onPress: toggleNarrativeFollow,
              primary: followEnabled(),
            },
            {
              label: paneVisibility() === "hidden" ? "Show Workstation" : `Workstation: ${paneVisibility()}`,
              onPress: cyclePaneVisibility,
            },
          ]}
        />

        <box flexGrow={1} flexDirection={liveStacked() ? "column" : "row"} minHeight={0}>
          {/* Main Narrative Stream */}
          <scrollbox
            id="narrative-scroll"
            ref={narrativeScroll}
            flexGrow={mainPaneGrow()}
            width={liveStacked() ? "100%" : Math.max(48, contentWidth() - livePaneWidth() - 3)}
            minHeight={0}
            scrollAcceleration={scrollAcceleration()}
            paddingBottom={1}
          >
            <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} gap={0}>
              <Show when={!followEnabled() && streamItems().length > 0}>
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  paddingTop={0}
                  paddingBottom={0}
                  borderStyle="round"
                  borderColor={theme.warning}
                  backgroundColor={tint(theme.backgroundElement, theme.warning, 0.08)}
                  flexDirection="row"
                  justifyContent="space-between"
                  alignItems="center"
                  gap={1}
                  onMouseUp={() => {
                    setFollowing(true)
                    scrollNarrative({ force: true })
                  }}
                >
                  <text fg={theme.warning} attributes={TextAttributes.BOLD}>
                    Follow paused
                  </text>
                  <text fg={theme.textMuted} wrapMode="truncate-end">
                    Click to resume · scroll to bottom resumes automatically
                  </text>
                </box>
              </Show>
              <Show when={todo().length > 0}>
                <TodoStreamBlock todos={todo()} />
              </Show>
              <For each={streamItems()}>
                {(item, index) => (
                  <>
                    <StreamItem
                      item={item}
                      index={index()}
                      isLast={index() === lastMessageIndex()}
                      previousItem={index() > 0 ? streamItems()[index() - 1] : undefined}
                      allItems={streamItems()}
                      onNavigateToApprovals={openApprovalsPane}
                      MessageComponent={Message}
                    />
                  </>
                )}
              </For>
              <Show when={sessionStatusType() === "retry" || sessionStatusType() === "delayed"}>
                <box
                  flexDirection="row"
                  gap={1}
                  paddingLeft={2}
                  paddingRight={2}
                  paddingTop={1}
                  paddingBottom={1}
                  marginTop={1}
                  backgroundColor={tint(theme.background, theme.warning, 0.08)}
                  alignItems="center"
                >
                  <Spinner color={theme.warning} />
                  <text fg={theme.warning} wrapMode="word">
                    {sessionStatusType() === "delayed"
                      ? "Provider delayed — waiting for response…"
                      : "Connection interrupted — retrying…"}
                  </text>
                </box>
              </Show>
            </box>
          </scrollbox>

          {/* Right Side Context Pane */}
          <Show when={showPane()}>
            <box
              width={liveStacked() ? "100%" : 1}
              height={liveStacked() ? 1 : "100%"}
              backgroundColor={theme.borderSubtle}
            />
            <scrollbox
              flexGrow={sidePaneGrow()}
              width={liveStacked() ? "100%" : livePaneWidth()}
              minHeight={0}
              backgroundColor="transparent"
              scrollAcceleration={scrollAcceleration()}
            >
              <box padding={1} gap={1} backgroundColor={theme.background} flexDirection="column">
                <box
                  flexDirection="column"
                  gap={1}
                  border={["bottom"]}
                  borderColor={theme.borderSubtle}
                  paddingBottom={1}
                >
                  <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                    <For each={PANE_MODES}>
                      {(mode) => (
                        <box
                          flexShrink={0}
                          onMouseUp={() => selectPaneMode(mode)}
                          paddingLeft={1}
                          paddingRight={1}
                          paddingTop={0}
                          paddingBottom={0}
                          backgroundColor={
                            activePaneMode() === mode
                              ? tint(theme.backgroundElement, theme.primary, 0.18)
                              : tint(theme.background, theme.textMuted, 0.04)
                          }
                          border={["round"]}
                          borderColor={activePaneMode() === mode ? theme.borderActive : theme.borderSubtle}
                        >
                          <text
                            fg={activePaneMode() === mode ? theme.primary : theme.textMuted}
                            attributes={activePaneMode() === mode ? TextAttributes.BOLD : undefined}
                            wrapMode="none"
                          >
                            {compactPaneTabs() ? paneCompactLabel(mode, explainMode()) : paneLabel(mode)}
                            <Show when={paneBadge(mode)}>
                              <span style={{ fg: activePaneMode() === mode ? theme.primary : theme.textMuted }}>
                                {" "}
                                {paneBadge(mode)}
                              </span>
                            </Show>
                          </text>
                        </box>
                      )}
                    </For>
                  </box>
                </box>

                <Switch>
                  <Match when={activePaneMode() === "approvals"}>
                    <box flexGrow={1} minHeight={0}>
                      <RAOPane permissions={permissions()} questions={questions()} sessionID={route.sessionID} />
                    </box>
                  </Match>

                  <Match when={activePaneMode() === "audit"}>
                    <AuditLogPane history={auditHistory()} latest={latestAudit()} ledger={evidenceLedger()} />
                  </Match>

                  <Match when={activePaneMode() === "runtime"}>
                    <RuntimePane />
                  </Match>

                  <Match when={activePaneMode() === "refine"}>
                    <RefinePane
                      initialPrompt={refinedPrompt()}
                      onUpdate={(prompt) => {
                        promptRef.current?.set({ ...promptRef.current!.current, input: prompt })
                        kv.set(DAX_SETTING.session_refined_prompt, prompt)
                      }}
                      onSubmit={() => {
                        promptRef.current?.submit()
                        setPaneMode(() => "refine")
                        setPaneVisibility(() => "pinned")
                        setFollowing(true)
                      }}
                    />
                  </Match>

                  <Match when={activePaneMode() === "memory"}>
                    <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
                      <box
                        flexDirection="row"
                        gap={1}
                        alignItems="center"
                        border={["bottom"]}
                        borderColor={theme.borderSubtle}
                        paddingBottom={1}
                      >
                        <For each={["note", "list", "rules"] as PMTab[]}>
                          {(tab) => (
                            <box
                              onMouseUp={() => setPmTab(() => tab)}
                              paddingLeft={1}
                              paddingRight={1}
                              border={["round"]}
                              borderColor={pmTab() === tab ? theme.borderActive : theme.borderSubtle}
                              backgroundColor={
                                pmTab() === tab
                                  ? tint(theme.backgroundElement, theme.primary, 0.16)
                                  : theme.backgroundElement
                              }
                            >
                              <text
                                fg={pmTab() === tab ? theme.primary : theme.textMuted}
                                attributes={pmTab() === tab ? TextAttributes.BOLD : undefined}
                              >
                                {tab}
                              </text>
                            </box>
                          )}
                        </For>
                      </box>

                      <Show when={memoryLoadError()}>
                        <box
                          flexDirection="column"
                          gap={0}
                          padding={1}
                          border={["round"]}
                          borderColor={memoryState()?.tone === "error" ? theme.error : theme.borderSubtle}
                          backgroundColor={
                            memoryState()?.tone === "error"
                              ? tint(theme.backgroundElement, theme.error, 0.08)
                              : tint(theme.backgroundElement, theme.primary, 0.04)
                          }
                        >
                          <text fg={memoryState()?.tone === "error" ? theme.error : theme.text} bold>
                            {memoryState()?.title}
                          </text>
                          <text fg={theme.textMuted} wrapMode="word">
                            {memoryState()?.detail}
                          </text>
                        </box>
                      </Show>

                      <Switch>
                        <Match when={pmTab() === "note"}>
                          <box
                            flexDirection="column"
                            gap={1}
                            padding={1}
                            border={["round"]}
                            borderColor={theme.borderSubtle}
                            backgroundColor={theme.backgroundElement}
                          >
                            <Show
                              when={memoryNote()}
                              fallback={<text fg={theme.textMuted}>No memory note yet. Add one with `/pm note`.</text>}
                            >
                              <text fg={theme.text} wrapMode="word">
                                {memoryNote()}
                              </text>
                            </Show>
                            <Show when={(workstationState().reflection?.verificationPlan?.length ?? 0) > 0}>
                              <box flexDirection="column" gap={0}>
                                <text fg={theme.accent} bold>
                                  Verification plan
                                </text>
                                <For each={workstationState().reflection?.verificationPlan ?? []}>
                                  {(item) => <text fg={theme.text}>- {item}</text>}
                                </For>
                              </box>
                            </Show>
                            <Show when={workstationState().reflectionHistory.length > 0}>
                              <box flexDirection="column" gap={0}>
                                <text fg={theme.textMuted} bold>
                                  Recent reflections
                                </text>
                                <For each={workstationState().reflectionHistory.slice(0, 3)}>
                                  {(item) => (
                                    <text fg={theme.textMuted}>- {summarize(item.goal, 56) ?? item.goal}</text>
                                  )}
                                </For>
                              </box>
                            </Show>
                          </box>
                        </Match>

                        <Match when={pmTab() === "list"}>
                          <box flexDirection="column" gap={0}>
                            <Show
                              when={memoryList().rows.length > 0}
                              fallback={<text fg={theme.textMuted}>{memoryList().info ?? "No PM notes found."}</text>}
                            >
                              <box
                                flexDirection="row"
                                gap={1}
                                border={["bottom"]}
                                borderColor={theme.borderSubtle}
                                paddingBottom={0}
                              >
                                <text fg={theme.textMuted} width={12}>
                                  DAY
                                </text>
                                <text fg={theme.textMuted} flexGrow={1}>
                                  TITLE
                                </text>
                                <text fg={theme.textMuted} width={22}>
                                  TAGS
                                </text>
                              </box>
                              <For each={memoryList().rows}>
                                {(row) => (
                                  <box flexDirection="row" gap={1} paddingTop={0} paddingBottom={0}>
                                    <text fg={theme.text} width={12}>
                                      {row.day}
                                    </text>
                                    <text fg={theme.text} flexGrow={1} wrapMode="truncate-end">
                                      {row.title}
                                    </text>
                                    <text fg={theme.textMuted} width={22} wrapMode="truncate-end">
                                      {row.tags.join(", ")}
                                    </text>
                                  </box>
                                )}
                              </For>
                            </Show>
                          </box>
                        </Match>

                        <Match when={pmTab() === "rules"}>
                          <box flexDirection="column" gap={0}>
                            <Show
                              when={memoryRules().rows.length > 0}
                              fallback={<text fg={theme.textMuted}>{memoryRules().info ?? "No PM rules set."}</text>}
                            >
                              <box
                                flexDirection="row"
                                gap={1}
                                border={["bottom"]}
                                borderColor={theme.borderSubtle}
                                paddingBottom={0}
                              >
                                <text fg={theme.textMuted} width={18}>
                                  RULE
                                </text>
                                <text fg={theme.textMuted} flexGrow={1}>
                                  PATTERN
                                </text>
                                <text fg={theme.textMuted} width={8}>
                                  ACTION
                                </text>
                              </box>
                              <For each={memoryRules().rows}>
                                {(row) => (
                                  <box flexDirection="row" gap={1} paddingTop={0} paddingBottom={0}>
                                    <text fg={theme.text} width={18} wrapMode="truncate-end">
                                      {row.ruleType}
                                    </text>
                                    <text fg={theme.text} flexGrow={1} wrapMode="truncate-end">
                                      {row.pattern}
                                    </text>
                                    <text fg={theme.primary} width={8}>
                                      {row.action}
                                    </text>
                                  </box>
                                )}
                              </For>
                            </Show>
                          </box>
                        </Match>
                      </Switch>
                    </box>
                  </Match>

                  <Match when={activePaneMode() === "operator"}>
                    <OperatorPane
                      instruction={kv.get(DAX_SETTING.operator_instruction, "")}
                      onInstructionChange={(value) => kv.set(DAX_SETTING.operator_instruction, value)}
                      onApplyOnce={applyOperatorInstructionOnce}
                      onApplySession={applyOperatorInstructionSession}
                      onClear={() => kv.set(DAX_SETTING.operator_instruction, "")}
                      controls={operatorControls()}
                      onControlChange={(key, value) => kv.set(DAX_SETTING[`operator_${key}`], value)}
                      contextUsage={sessionTelemetry().contextPercent ?? 0}
                      stepsUsed={workstationState().planSummary.steps.filter((s) => s.status === "done").length}
                      stepsTotal={workstationState().planSummary.totalSteps || undefined}
                      pmRulesCount={memoryRules().rows.length}
                      sessionTag={kv.get(DAX_SETTING.operator_session_tag, "")}
                      onSessionTagChange={(value) => kv.set(DAX_SETTING.operator_session_tag, value)}
                      onCommand={(name) => {
                        runOperatorCommand(name).catch((error) => {
                          toast.show({
                            variant: "error",
                            message: String(error instanceof Error ? error.message : error),
                            duration: 3000,
                          })
                        })
                      }}
                    />
                  </Match>
                </Switch>
              </box>
            </scrollbox>
          </Show>
        </box>

        {/* Live Status Line — fixed between stream and prompt, always visible during active runs */}
        <Show when={(chatActive() || showLiveStatusNote()) && !showPane()}>
          <box
            flexShrink={0}
            paddingLeft={3}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={0}
            flexDirection="row"
            gap={1}
            alignItems="center"
          >
            <Spinner color={theme.primary} />
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {doing()}…
            </text>
            <Show when={sessionTelemetry().generatedTokens > 0 || runElapsed() > 2000}>
              <text fg={theme.textMuted} dim>
                {(() => {
                  const elapsed = runElapsed()
                  const tokens = sessionTelemetry().generatedTokens
                  const timePart = elapsed > 1000 ? formatElapsed(elapsed) : ""
                  if (tokens > 0 && timePart) return `(${timePart} · ↑ ${formatTokenCount(tokens)} tokens)`
                  if (tokens > 0) return `(↑ ${formatTokenCount(tokens)} tokens)`
                  return `(${timePart})`
                })()}
              </text>
            </Show>
          </box>
        </Show>

        {/* Footer Area */}
        <box flexShrink={0} paddingLeft={1} paddingRight={1} paddingBottom={0}>
          <Prompt
            ref={promptRef.set}
            disabled={promptDisabled()}
            panePinned={paneVisibility() === "pinned"}
            activePaneMode={activePaneMode()}
            approvalAttentionCount={permissions().length}
            questionAttentionCount={questions().length}
            onRefineReady={() => {
              openRefinePane()
            }}
            onSubmit={() => {
              setFollowing(true)
            }}
            sessionID={route.sessionID}
          />
        </box>
        <Footer
          lifecycleLabel={workstationState().lifecycleLabel}
          workflowMode={workflowMode()}
          onCycleWorkflowMode={() => {
            const modes: WorkflowMode[] = ["plan", "build", "explore", "docs"]
            const idx = modes.indexOf(workflowMode())
            setWorkflowMode(modes[(idx + 1) % modes.length]!)
          }}
        />
        <Toast />
      </box>
    </context.Provider>
  )
}

function Message(props: {
  message: AssistantMessage | UserMessage
  last: boolean
  partsOverride?: Part[]
  suppressHeader?: boolean
}) {
  const ctx = use()
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()

  // Fade-in: start at dim step 2, step down to 0 (normal) over ~200ms
  const [fadeStep, setFadeStep] = createSignal(2)
  onMount(() => {
    const t1 = setTimeout(() => setFadeStep(1), 80)
    const t2 = setTimeout(() => setFadeStep(0), 180)
    onCleanup(() => {
      clearTimeout(t1)
      clearTimeout(t2)
    })
  })
  const fadeFg = createMemo(() => {
    const step = fadeStep()
    if (step === 0) return undefined // use natural fg
    return step === 1 ? theme.textMuted : theme.borderSubtle
  })

  const final = createMemo(() => {
    if (props.message.role === "user") return true
    return (props.message as AssistantMessage).time.completed !== undefined
  })
  const duration = createMemo(() => {
    if (props.message.role === "user") return undefined
    const completed = (props.message as AssistantMessage).time.completed
    if (!completed) return undefined
    return completed - props.message.time.created
  })

  if (props.message.role === "user") {
    return (
      <box
        paddingLeft={1}
        paddingRight={1}
        marginTop={1}
        marginBottom={0}
        paddingTop={0}
        paddingBottom={1}
        border={["left"]}
        borderColor={fadeFg() ?? tint(theme.borderSubtle, theme.primary, 0.4)}
      >
        <box flexDirection="row" gap={1} alignItems="center" marginLeft={1}>
          <text fg={fadeFg() ?? theme.primary} attributes={TextAttributes.BOLD}>
            you
          </text>
          <Show when={ctx.showTimestamps()}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              {Locale.todayTimeOrDateTime(props.message.time.created)}
            </text>
          </Show>
        </box>
        <box marginLeft={1} marginTop={0}>
          <text fg={fadeFg() ?? theme.text} wrapMode="word">
            {(props.partsOverride ?? sync.data.part[props.message.id] ?? [])
              .filter((p): p is TextPart => p.type === "text" && !p.synthetic)
              .map((p) => p.text)
              .join("")}
          </text>
        </box>
      </box>
    )
  }

  const parts = createMemo(() => props.partsOverride ?? sync.data.part[props.message.id] ?? [])
  const showMetadata = createMemo(() => ctx.showAssistantMetadata())

  const roleLabel = createMemo(() => {
    if (props.message.role === "user") return "user"
    const agent = (props.message as AssistantMessage).agent.toLowerCase()
    switch (agent) {
      case "dax":
        return "dax"
      case "explore":
        return "explorer"
      case "plan":
      case "planner":
        return "planner"
      case "review":
        return "reviewer"
      case "verify":
      case "verifier":
        return "verifier"
      case "audit":
      case "auditor":
        return "auditor"
      default:
        return agent
    }
  })

  const roleColor = createMemo(() => {
    if (props.message.role === "user") return theme.primary
    const agent = (props.message as AssistantMessage).agent.toLowerCase()
    switch (agent) {
      case "dax":
        return theme.primary
      case "explore":
        return theme.secondary
      case "plan":
      case "planner":
        return theme.accent
      case "review":
        return theme.warning
      case "verify":
      case "verifier":
        return theme.success
      case "audit":
      case "auditor":
        return theme.error
      default:
        return theme.primary
    }
  })

  // Flat sequential parts with compaction: consecutive same-type read-like tools collapse into one row.
  const renderableParts = createMemo((): (Part | CompactGroup)[] => {
    const visible = parts().filter((part) => {
      if (part.type === "tool") return !HIDDEN_TOOLS.has((part as ToolPart).tool)
      return true
    })
    const result: (Part | CompactGroup)[] = []
    let i = 0
    while (i < visible.length) {
      const part = visible[i]!
      if (part.type === "tool") {
        const toolName = (part as ToolPart).tool.toLowerCase()
        if (COMPACT_TOOLS.has(toolName)) {
          let j = i + 1
          while (
            j < visible.length &&
            visible[j]!.type === "tool" &&
            (visible[j] as ToolPart).tool.toLowerCase() === toolName
          ) {
            j++
          }
          const count = j - i
          if (count >= COMPACT_MIN) {
            const groupParts = visible.slice(i, j) as ToolPart[]
            result.push({
              type: "tool.group",
              id: `group-${(part as ToolPart).id}`,
              toolName,
              count,
              parts: groupParts,
              representativePath: extractGroupPath(toolName, groupParts),
            })
            i = j
            continue
          }
        }
      }
      result.push(part)
      i++
    }
    return result
  })

  const isPendingEmpty = createMemo(
    () => props.message.role === "assistant" && !final() && renderableParts().length === 0,
  )

  // When a message has NO text parts at all (pure tool block), synthesise a leading
  // sentence so the block doesn't feel mechanical and context-free.
  const autoBlockNarration = createMemo(() => {
    if (props.message.role !== "assistant") return ""
    const rp = renderableParts()
    const hasText = rp.some((p) => (p as any).type === "text" && (p as any).text?.trim())
    if (hasText) return ""
    const toolNames = rp
      .map((p) => {
        if ((p as any).type === "tool") return ((p as ToolPart).tool ?? "").toLowerCase()
        if ((p as any).type === "tool.group") return (p as CompactGroup).toolName
        return ""
      })
      .filter(Boolean)
    if (toolNames.length === 0) return ""
    const allRead = toolNames.every((t) => t === "read" || t === "glob" || t === "list" || t === "grep")
    const allWrite = toolNames.every((t) => t === "write" || t === "edit" || t === "apply_patch")
    const allShell = toolNames.every((t) => t === "shell")
    const hasWrite = toolNames.some((t) => t === "write" || t === "edit" || t === "apply_patch")
    const hasRead = toolNames.some((t) => t === "read" || t === "glob" || t === "grep")
    const hasShell = toolNames.some((t) => t === "shell")
    if (allRead) return "Scanning the codebase to gather the relevant context."
    if (allWrite) return "Applying the targeted changes to the workspace."
    if (allShell) return "Running the required checks."
    if (hasWrite && hasRead) return "Reading and updating the relevant files."
    if (hasWrite && hasShell) return "Applying changes and verifying the result."
    if (hasRead && hasShell) return "Gathering context and running the checks."
    return "Working through the required steps."
  })

  const baseTextColor = () => (props.last ? theme.text : theme.textMuted)

  return (
    <Show when={renderableParts().length > 0 || !!props.message.error || isPendingEmpty()}>
      <box>
        {/* Pre-token loading state: role header + thinking spinner */}
        <Show when={isPendingEmpty()}>
          <box flexDirection="column" marginTop={1} marginBottom={0}>
            <Show when={!props.suppressHeader}>
              <box flexDirection="row" gap={1} alignItems="center" paddingLeft={1} paddingRight={1} marginBottom={0}>
                <text fg={roleColor()}>◇</text>
                <text fg={roleColor()} attributes={TextAttributes.BOLD}>
                  {roleLabel()}
                </text>
              </box>
            </Show>
            <box flexDirection="row" gap={2} paddingLeft={3} alignItems="center" marginBottom={1}>
              <Spinner color={tint(theme.textMuted, roleColor(), 0.35)} />
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                thinking...
              </text>
            </box>
          </box>
        </Show>
        <Show when={renderableParts().length > 0}>
          <box
            paddingLeft={0}
            paddingRight={0}
            flexDirection="column"
            borderStyle="none"
            borderColor={theme.borderSubtle}
            backgroundColor="transparent"
            marginTop={props.suppressHeader ? 0 : 1}
            marginBottom={0}
          >
            <Show when={!props.suppressHeader}>
              <box
                flexDirection="row"
                gap={1}
                alignItems="center"
                paddingTop={0}
                paddingBottom={0}
                marginBottom={0}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={roleColor()}>◇</text>
                <text fg={roleColor()} attributes={TextAttributes.BOLD}>
                  {roleLabel()}
                </text>
                <Show when={ctx.showTimestamps()}>
                  <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                    {Locale.todayTimeOrDateTime(props.message.time.created)}
                  </text>
                </Show>
              </box>
            </Show>
            <box paddingLeft={3} paddingRight={2} paddingBottom={0} flexDirection="column" gap={0}>
              <Show when={autoBlockNarration()}>
                <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="word" marginBottom={1}>
                  {autoBlockNarration()}
                </text>
              </Show>
              <For each={renderableParts()}>
                {(part, index) => {
                  const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
                  return (
                    <Show when={component()}>
                      <Dynamic
                        last={index() === renderableParts().length - 1}
                        component={component()}
                        part={part as any}
                        message={props.message as AssistantMessage}
                        baseTextColor={baseTextColor()}
                      />
                    </Show>
                  )
                }}
              </For>
            </box>
          </box>
        </Show>
        <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
          <box
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            marginTop={1}
            backgroundColor={tint(theme.background, theme.error, 0.15)}
          >
            <text fg={theme.error} wrapMode="word">
              {textValue(
                props.message.error?.data.message ?? props.message.error?.name,
                "Session error — check logs for details",
              )}
            </text>
          </box>
        </Show>
      </box>
    </Show>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  "tool.group": CompactedToolGroup,
  reasoning: ReasoningPart,
}

function relativizePath(absPath: string, workspaceDir: string): string {
  if (!absPath || !workspaceDir) return absPath
  const normalized = workspaceDir.endsWith("/") ? workspaceDir : workspaceDir + "/"
  return absPath.startsWith(normalized) ? absPath.slice(normalized.length) : absPath
}

function extractResultMeta(result: string | undefined): string | undefined {
  if (!result) return undefined
  if (result === "completed" || result === "in progress") return undefined
  const m = result.match(/\((.+)\)/)
  return m?.[1]
}

function describeNarrativeTrace(trace: NonNullable<ReturnType<typeof deriveOperatorTraceLine>>) {
  switch (trace.action) {
    case "READ":
      return `Read \`${trace.target}\` to gather the needed context.`
    case "GLOB":
    case "LIST":
      return `Scanned \`${trace.target}\` to map the relevant files.`
    case "GREP":
      return `Searched \`${trace.target}\` to isolate the relevant matches.`
    case "SHELL":
      return `Ran \`${trace.target}\` to check the current state.`
    case "WRITE":
      return `Wrote \`${trace.target}\` to land the scoped change.`
    case "EDIT":
      return `Edited \`${trace.target}\` to refine the scoped change.`
    case "PATCH":
      return `Patched \`${trace.target}\` to update the workspace precisely.`
    case "TASK":
      return `Structured \`${trace.target}\` so the next move stays clear.`
    case "TODO":
      return `Updated \`${trace.target}\` so progress stays visible.`
    case "QUESTION":
      return `Raised \`${trace.target}\` to unblock the next decision.`
    case "SKILL":
      return `Loaded \`${trace.target}\` to bring the right workflow into the run.`
    case "REFLECTION":
      return `Captured \`${trace.target}\` to keep the run grounded.`
    default:
      return `${trace.summary}.`
  }
}

function cleanReasoningText(text: string) {
  return text
    .replace(/\[REDACTED\]/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .trim()
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage; marginTop?: number }) {
  const { syntax, theme } = useTheme()
  const ctx = use()
  const content = createMemo(() => cleanReasoningText(props.part.text))
  const reasoningFg = createMemo(() => tint(theme.textMuted, theme.text, 0.35))
  const lineCount = createMemo(
    () =>
      content()
        ?.split("\n")
        .filter((l) => l.trim()).length ?? 0,
  )
  const reasoningDuration = createMemo(() => {
    const completed = props.message.time.completed ?? Date.now()
    const created = props.message.time.created
    const dur = completed - created
    if (dur < 1000) return ""
    return formatElapsed(dur)
  })
  const isStreaming = createMemo(() => !props.message.time.completed)
  const [collapsed, setCollapsed] = createSignal(false)

  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"reasoning-" + props.part.id}
        flexDirection="column"
        gap={0}
        marginTop={props.marginTop ?? 1}
        marginBottom={0}
        paddingLeft={1}
      >
        <box flexDirection="row" gap={1} alignItems="center" onMouseUp={() => setCollapsed((c) => !c)}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} flexShrink={0}>
            {collapsed() ? "▸" : "▾"}
          </text>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            thinking
          </text>
          <Show when={collapsed() && lineCount() > 0}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              · {lineCount()} line{lineCount() === 1 ? "" : "s"}
            </text>
          </Show>
          <Show when={collapsed() && reasoningDuration()}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              · {reasoningDuration()}
            </text>
          </Show>
          <Show when={!collapsed()}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              · click or press t to hide
            </text>
          </Show>
        </box>
        <Show when={!collapsed()}>
          <box paddingTop={1} paddingRight={2}>
            <markdown
              syntaxStyle={syntax()}
              streaming={isStreaming()}
              content={content()!}
              conceal={ctx.conceal()}
              fg={reasoningFg()}
            />
          </box>
        </Show>
      </box>
    </Show>
  )
}

// Sub-task agents whose text output is suppressed entirely from the main stream.
// These are also filtered at the session-stream layer; this is a belt-and-suspenders guard.
const SUB_TASK_AGENTS_UI = new Set([
  "explore",
  "explorer",
  "review",
  "reviewer",
  "verify",
  "verifier",
  "audit",
  "auditor",
])

function TextPart(props: {
  last: boolean
  part: TextPart
  message: AssistantMessage | UserMessage
  marginTop?: number
  baseTextColor?: RGBA
}) {
  const ctx = use()
  const { syntax, theme } = useTheme()
  const isStreaming = createMemo(() => props.last && !(props.message.time as any).completed)
  const agentName = createMemo(() => (props.message as AssistantMessage).agent?.toLowerCase() ?? "")
  // Sub-task agent text is suppressed entirely — their output is not meaningful to the user
  const isSubTaskAgent = createMemo(() => SUB_TASK_AGENTS_UI.has(agentName()))
  const [cursorOn, setCursorOn] = createSignal(true)
  createEffect(() => {
    if (!isStreaming()) {
      setCursorOn(true)
      return
    }
    const timer = setInterval(() => setCursorOn((v) => !v), 530)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={props.part.text.trim() && !isSubTaskAgent()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={0}
        paddingRight={2}
        paddingBottom={1}
        marginTop={props.marginTop ?? 1}
        flexShrink={0}
      >
        <markdown
          syntaxStyle={syntax()}
          streaming={isStreaming()}
          content={props.part.text.trim()}
          conceal={ctx.conceal()}
          fg={props.baseTextColor}
        />
        <Show when={isStreaming()}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            {cursorOn() ? "▋" : " "}
          </text>
        </Show>
      </box>
    </Show>
  )
}

function toolDisplayName(tool: string): string {
  switch (tool.toLowerCase()) {
    case "shell":
      return "Bash"
    case "read":
      return "Read"
    case "write":
      return "Write"
    case "edit":
      return "Edit"
    case "apply_patch":
      return "Patch"
    case "glob":
      return "Glob"
    case "grep":
      return "Grep"
    case "list":
      return "List"
    case "webfetch":
      return "Fetch"
    case "websearch":
    case "codesearch":
      return "Search"
    case "task":
      return "Task"
    case "reflection":
      return "Checkpoint"
    case "question":
      return "Question"
    case "skill":
      return "Skill"
    default:
      return tool
  }
}

function toolArgPreview(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => textValue((input as any)[k])
  const p = (k: string) => normalizePath(s(k))
  const clip = (v: string, max = 56) => (v.length > max ? v.slice(0, max - 1) + "…" : v)
  switch (tool.toLowerCase()) {
    case "shell":
      return s("command")
    case "read":
      return shortPath(p("filePath") || p("path"))
    case "write":
      return shortPath(p("filePath"))
    case "edit":
      return shortPath(p("filePath"))
    case "apply_patch": {
      const n = Object.keys((input.changes as any) ?? {}).length
      return `${n} file${n === 1 ? "" : "s"}`
    }
    case "glob":
      return s("pattern")
    case "grep": {
      const pattern = s("pattern")
      const path = p("path") || p("glob")
      return path ? clip(`${pattern}, ${path}`) : clip(pattern)
    }
    case "list":
      return p("path")
    case "webfetch":
      return clip(s("url"))
    case "websearch":
    case "codesearch":
      return clip(s("query"))
    case "task": {
      const agent = s("subagent_type") || "task"
      const desc = s("description")
      return desc ? clip(`${agent} — ${desc}`) : agent
    }
    case "reflection":
      return clip(s("goal") || s("summary") || "checkpoint")
    case "question":
      return clip(s("question"))
    case "skill":
      return s("name") || "skill"
    default:
      return ""
  }
}

function extractGroupPath(toolName: string, parts: ToolPart[]): string | undefined {
  const paths: string[] = []
  for (const part of parts) {
    if (part.state.status === "pending") continue
    const input = (part.state.input ?? {}) as Record<string, unknown>
    const fp = String(input.filePath || input.path || "")
    if (fp) paths.push(normalizePath(fp))
  }
  if (paths.length === 0) return undefined
  const segs0 = paths[0]!.split("/")
  let common = segs0.slice(0, -1)
  for (const p of paths.slice(1)) {
    const segs = p.split("/")
    const limit = Math.min(common.length, segs.length - 1)
    let k = 0
    while (k < limit && common[k] === segs[k]) k++
    common = common.slice(0, k)
  }
  if (common.length === 0) return shortPath(paths[0]!)
  return common.slice(-2).join("/") + "/…"
}

function compactGroupNarration(toolName: string, count: number, isRunning: boolean): string {
  const n = count
  switch (toolName) {
    case "read":
      return isRunning
        ? `Reading ${n} files to gather the relevant context.`
        : `Read ${n} files to gather the relevant context.`
    case "glob":
    case "list":
      return isRunning
        ? `Scanning ${n} paths to map the workspace shape.`
        : `Scanned ${n} paths to map the workspace shape.`
    case "grep":
      return isRunning
        ? `Searching ${n} patterns to isolate the key signals.`
        : `Searched ${n} patterns to isolate the key signals.`
    default:
      return isRunning ? `Running ${n} operations.` : `Completed ${n} operations.`
  }
}

function CompactedToolGroup(props: {
  part: CompactGroup
  last: boolean
  message: AssistantMessage
  marginTop?: number
  baseTextColor?: RGBA
}) {
  const { theme } = useTheme()
  const anyRunning = () => props.part.parts.some((p) => p.state.status === "pending" || p.state.status === "running")
  const narration = () => compactGroupNarration(props.part.toolName, props.part.count, anyRunning())

  return (
    <box flexDirection="column" gap={0} marginTop={1} paddingLeft={2}>
      <box flexDirection="row" gap={1} alignItems="center">
        <Show when={!anyRunning()} fallback={<Spinner color={theme.info} />}>
          <text fg={theme.success}>✓</text>
        </Show>
        <text fg={anyRunning() ? theme.info : theme.text} attributes={TextAttributes.BOLD}>
          {toolDisplayName(props.part.toolName)}
        </text>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          {" "}
          ×{props.part.count}
        </text>
        <Show when={props.part.representativePath}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            {" "}
            ({props.part.representativePath})
          </text>
        </Show>
      </box>
      <box paddingLeft={2} border={["left"]} borderColor={theme.borderSubtle} marginLeft={0.5}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="word">
          {narration()}
        </text>
      </box>
    </box>
  )
}

function ToolPart(props: {
  last: boolean
  part: ToolPart
  message: AssistantMessage
  marginTop?: number
  baseTextColor?: RGBA
}) {
  const sync = useSync()
  const toolName = createMemo(() => props.part.tool.toLowerCase())
  // Always use the real input so arg preview and narration work from the moment
  // the tool call appears, even while status is still "pending".
  const input = createMemo(
    () => (("input" in props.part.state ? props.part.state.input : undefined) ?? {}) as Record<string, unknown>,
  )
  const output = createMemo(() => (props.part.state.status === "completed" ? props.part.state.output : undefined))
  const metadata = createMemo(() => (props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})))
  const permission = createMemo(() => {
    const perms = sync.data.permission[props.message.sessionID] ?? []
    const i = perms.findIndex((x) => x.tool?.callID === props.part.callID)
    return perms[i]
  })

  // Reflection is internal model grounding — already surfaces as intent.created prose.
  if (toolName() === "reflection") return null

  return (
    <Show
      when={toolName() === "shell"}
      fallback={
        <ToolLine part={props.part} toolName={toolName()} input={input()} baseTextColor={props.baseTextColor} />
      }
    >
      <Bash
        part={props.part}
        input={input() as any}
        output={output() as any}
        metadata={metadata() as any}
        permission={permission() as any}
        tool={props.part.tool}
        baseTextColor={props.baseTextColor}
      />
    </Show>
  )
}

function ToolLine(props: { part: ToolPart; toolName: string; input: Record<string, unknown>; baseTextColor?: RGBA }) {
  const { theme } = useTheme()
  const status = createMemo(() => props.part.state.status)
  const isRunning = createMemo(() => status() === "running" || status() === "pending")
  const hasError = createMemo(() => status() === "error")
  const timing = createMemo<Record<string, unknown> | undefined>(() =>
    "time" in props.part.state ? ((props.part.state.time ?? {}) as Record<string, unknown>) : undefined,
  )
  const displayName = createMemo(() => toolDisplayName(props.toolName))
  const argPreview = createMemo(() => toolArgPreview(props.toolName, props.input))
  // Only show narration when we have a real target — suppresses "runtime target" placeholder.
  const narration = createMemo(() => {
    if (!argPreview()) return ""
    const n = deriveToolNarrativeDescriptor(props.part)
    if (!n) return ""
    return stripInlineMarkdown(n.sentence)
  })

  return (
    <box flexDirection="column" gap={0} marginTop={1} paddingLeft={2}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.info} attributes={TextAttributes.BOLD}>
          [exec]
        </text>
        <text fg={hasError() ? theme.error : isRunning() ? theme.info : theme.text} flexShrink={0}>
          {displayName()}
        </text>
        <Show when={argPreview()}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="truncate-end" flexShrink={1}>
            {" "}
            ({argPreview()})
          </text>
        </Show>
      </box>

      <box
        flexDirection="column"
        border={["left"]}
        borderColor={theme.borderSubtle}
        paddingLeft={2}
        marginLeft={0.5}
        marginTop={0}
      >
        <Show when={narration()}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="word">
            {narration()}
          </text>
        </Show>
        <Show when={!isRunning()}>
          <box flexDirection="row" gap={1} alignItems="center" marginTop={0}>
            <text fg={hasError() ? theme.error : theme.success}>{hasError() ? "╰─ ✗" : "╰─ ✓"}</text>
            <Show when={timing()?.end}>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                {formatElapsed((timing()!.end as number) - (timing()!.start as number))}
              </text>
            </Show>
          </box>
        </Show>
        <Show when={isRunning()}>
          <box flexDirection="row" gap={1} alignItems="center" marginTop={0}>
            <text fg={theme.borderSubtle}>╰─</text>
            <Spinner color={theme.textMuted} />
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              running...
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}

function Bash(props: ToolProps<typeof ShellTool>) {
  const { theme } = useTheme()
  const status = createMemo(() => props.part.state.status)
  const isRunning = createMemo(() => status() === "running" || status() === "pending")
  const hasError = createMemo(() => status() === "error")
  const timing = createMemo<Record<string, unknown> | undefined>(() =>
    "time" in props.part.state ? ((props.part.state.time ?? {}) as Record<string, unknown>) : undefined,
  )
  const narration = createMemo(() => {
    const cmd = String((props.input as any)?.command ?? "")
    if (!cmd) return ""
    const n = deriveToolNarrativeDescriptor(props.part)
    if (!n) return ""
    return stripInlineMarkdown(n.sentence)
  })

  const rawOutput = createMemo(() => {
    const raw =
      typeof props.output === "string"
        ? props.output
        : typeof props.metadata.output === "string"
          ? props.metadata.output
          : ""
    return stripAnsi(raw.trim())
  })

  const outputLines = createMemo(() =>
    rawOutput()
      .split("\n")
      .filter((l) => l.trim() !== ""),
  )

  const command = createMemo(() => String((props.input as any).command ?? ""))
  const displayCommand = createMemo(() => {
    const cmd = command()
    return cmd.length > 72 ? cmd.slice(0, 69) + "…" : cmd
  })
  const exitCode = createMemo(() => {
    const metadata = props.metadata as Record<string, unknown>
    if (typeof metadata.exitCode === "number") return metadata.exitCode
    if (typeof metadata.exit === "number") return metadata.exit
    return undefined
  })
  const duration = createMemo(() => {
    const start = timing()?.start
    const end = timing()?.end
    if (typeof start === "number" && typeof end === "number" && end >= start) {
      return formatElapsed(end - start)
    }
    return undefined
  })
  const isNonZeroExit = createMemo(() => exitCode() !== undefined && exitCode() !== 0)

  const [expanded, setExpanded] = createSignal(false)
  const TAIL = 3
  const liveTail = createMemo(() => outputLines().slice(-TAIL))
  const filteredLines = createMemo(() => {
    const lines = outputLines()
    if (isNonZeroExit()) return lines.filter((l) => !/^(INFO|DEBUG)\s/.test(l))
    return lines
  })
  const previewLines = createMemo(() => {
    const lines = filteredLines()
    if (expanded() || lines.length <= TAIL) return lines
    return lines.slice(-TAIL)
  })
  const hiddenCount = createMemo(() => {
    if (expanded()) return 0
    return Math.max(0, filteredLines().length - TAIL)
  })

  return (
    <box flexDirection="column" gap={0} marginTop={1} paddingLeft={2}>
      <box flexDirection="row" gap={1} alignItems="center">
        <text fg={theme.info} attributes={TextAttributes.BOLD}>
          [exec]
        </text>
        <text
          fg={hasError() || isNonZeroExit() ? theme.error : isRunning() ? theme.info : theme.text}
          attributes={isRunning() ? TextAttributes.BOLD : undefined}
        >
          Bash
        </text>
        <Show when={displayCommand()}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="truncate-end" flexShrink={1}>
            {" "}
            ({displayCommand()})
          </text>
        </Show>
      </box>

      <box
        flexDirection="column"
        border={["left"]}
        borderColor={theme.borderSubtle}
        paddingLeft={2}
        marginLeft={0.5}
        marginTop={0}
      >
        <Show when={narration()}>
          <text
            fg={theme.textMuted}
            attributes={TextAttributes.DIM}
            wrapMode="word"
            marginBottom={isRunning() || isNonZeroExit() ? 1 : 0}
          >
            {narration()}
          </text>
        </Show>

        {/* ── Live output while running ── */}
        <Show when={isRunning() && liveTail().length > 0}>
          <box flexDirection="column" gap={0} marginBottom={1}>
            <For each={liveTail()}>
              {(line) => (
                <text fg={theme.textMuted} attributes={TextAttributes.DIM} wrapMode="truncate-end">
                  {line}
                </text>
              )}
            </For>
          </box>
        </Show>

        {/* ── Failed/Error output ── */}
        <Show when={!isRunning() && (hasError() || isNonZeroExit()) && previewLines().length > 0}>
          <box flexDirection="column" gap={0} marginBottom={1}>
            <Show when={hiddenCount() > 0}>
              <text fg={theme.primary} attributes={TextAttributes.DIM} onMouseUp={() => setExpanded((v) => !v)}>
                ↕ {expanded() ? "click to collapse" : `+${hiddenCount()} lines — click to expand`}
              </text>
            </Show>
            <For each={previewLines()}>
              {(line) => (
                <text fg={theme.error} wrapMode="truncate-end">
                  {line}
                </text>
              )}
            </For>
          </box>
        </Show>

        {/* ── Footer ── */}
        <Show when={!isRunning()}>
          <box flexDirection="row" gap={1} alignItems="center" marginTop={0}>
            <text fg={hasError() || isNonZeroExit() ? theme.error : theme.success}>
              {hasError() || isNonZeroExit() ? "╰─ ✗" : "╰─ ✓"}
            </text>
            <Show when={duration()}>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                {duration()}
              </text>
            </Show>
            <Show when={isNonZeroExit()}>
              <text fg={theme.error} attributes={TextAttributes.DIM}>
                exit {exitCode()}
              </text>
            </Show>
          </box>
        </Show>
        <Show when={isRunning()}>
          <box flexDirection="row" gap={1} alignItems="center" marginTop={0}>
            <text fg={theme.borderSubtle}>╰─</text>
            <Spinner color={theme.textMuted} />
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              running...
            </text>
          </box>
        </Show>
      </box>
    </box>
  )
}

function normalizePath(filePath: string) {
  if (!filePath) return ""
  return filePath.replace(/\\/g, "/")
}

// For display in tool arg previews: if path is long, show dir/basename only
function shortPath(filePath: string): string {
  if (!filePath) return ""
  const normalized = normalizePath(filePath)
  if (normalized.length <= 40) return normalized
  const parts = normalized.split("/")
  if (parts.length <= 2) return normalized
  return parts.at(-2) + "/" + parts.at(-1)
}

function textValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) {
    const joined = value
      .map((item) => textValue(item))
      .filter(Boolean)
      .join(", ")
    return summarize(joined || undefined, 140) ?? fallback
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    if (typeof record.title === "string") return record.title
    try {
      return summarize(JSON.stringify(value), 140) ?? fallback
    } catch {
      return fallback
    }
  }
  return fallback
}

function filetype(filePath?: string) {
  if (!filePath) return "text"
  const ext = path.extname(filePath).toLowerCase()
  return LANGUAGE_EXTENSIONS[ext] ?? "text"
}

function summarize(value: string | undefined, max: number) {
  if (!value) return value
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

type ToolProps<T extends Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  permission: Record<string, any>
  tool: string
  output?: string
  part: ToolPart
  marginTop?: number
  baseTextColor?: RGBA
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(1, ms)}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
