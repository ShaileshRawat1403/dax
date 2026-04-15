import {
  batch,
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
import type { ReadTool } from "@/tool/read"
import type { WriteTool } from "@/tool/write"
import { ShellTool } from "@/tool/shell"
import type { GlobTool } from "@/tool/glob"
import { TodoWriteTool } from "@/tool/todo"
import type { GrepTool } from "@/tool/grep"
import type { ListTool } from "@/tool/ls"
import type { EditTool } from "@/tool/edit"
import type { ApplyPatchTool } from "@/tool/apply_patch"
import type { WebFetchTool } from "@/tool/webfetch"
import type { TaskTool } from "@/tool/task"
import type { QuestionTool } from "@/tool/question"
import type { SkillTool } from "@/tool/skill"
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
import { Sidebar } from "./sidebar"
import { Flag } from "@/flag/flag"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import parsers from "../../../../../../parsers-config.ts"
import { Clipboard } from "@tui/util/clipboard"
import { Toast, useToast } from "../../ui/toast"
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
import { QuestionPrompt } from "./question"
import { RAOPane } from "./rao-pane"
import { AuditLogPane } from "../../component/prompt/audit-log"
import { RefinePane } from "../../component/prompt/refine"
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
import {
  deriveAuditHistory,
  deriveLiveSessionStageState,
  deriveLiveStreamStatus,
  deriveOperatorTraceLine,
} from "@/dax/presentation/session-surface"
import {
  hasMemoryContext,
  resolveSessionSidebarVisibility,
  resolveDisplayDetailToggles,
  shouldShowWorkstationPane,
  shouldAutoOpenSidebar,
  shouldShowInterventionQueue,
  type DisplayMode,
} from "@/dax/presentation/session-display"
import { buildInterventionProjection, buildProposedChangesProjection } from "@/server/run-projections"
import type { ProposedChange as ProjectedProposedChange, RunEvent } from "@/server/run-contract"
import { VerificationReceipt } from "../../component/receipt"
import {
  buildStreamItems,
  getCurrentPhase,
  getActivePhases,
  type RenderableStreamItem,
  type RunPhase,
} from "@/dax/presentation/session-stream"
import { StreamItem } from "../../component/stream"

type GroupedPart = Part | { type: "activity-cluster"; tools: ToolPart[] } | { type: "context-group"; tools: ToolPart[] }

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list", "webfetch", "websearch", "codesearch"])
const HIDDEN_TOOLS = new Set(["todowrite"])
import { isEli12Mode } from "@/dax/intent"
import { DAX_SETTING } from "@/dax/settings"
import { latestContextUsage, sessionCostTotal, sessionTokenTotal } from "@/dax/session-metrics"
import { isGeminiSubscriptionLane } from "@/provider/gemini-subscription"
import { formatSessionExitMessage } from "./exit-message"
import { deriveFeatureBranchNudge } from "@/dax/presentation/vcs-guard"
import { deriveGitHubCINudge } from "@/dax/presentation/ci-guard"

addDefaultParsers(parsers.parsers)

const EXPLORE_TOOLS = new Set(["read", "glob", "grep", "list", "webfetch", "websearch", "codesearch"])
const PLAN_TOOLS = new Set(["task", "todowrite", "question", "skill", "reflection"])
const EXECUTE_TOOLS = new Set(["write", "edit", "apply_patch", "shell"])
const VERIFY_TOOLS = new Set(["read", "grep", "list", "glob"])
const PRIMARY_STAGE_FLOW: StreamStage[] = ["thinking", "exploring", "planning", "executing", "verifying", "done"]
type PMTab = "note" | "list" | "rules"
type WorkflowMode = "build" | "plan" | "explore" | "docs" | "audit"
const WORKFLOW_MODES: WorkflowMode[] = ["plan", "build", "explore", "docs", "audit"]
const WORKFLOW_AGENT_MODES = new Set<WorkflowMode>(["plan", "build", "explore", "docs", "audit"])
const MUTATION_INTENT_RE =
  /\b(create|add|edit|update|change|fix|delete|remove|rename|move|install|run|execute|patch|write|commit|push|release|publish)\b/i
const LIVE_FOLLOW_FRAMES = ["●", "◉", "●", "◎"]

const STAGE_VERBS: Record<string, string[]> = {
  thinking:  ["Thinking", "Reasoning", "Analyzing", "Considering", "Reflecting", "Evaluating", "Pondering", "Processing", "Synthesizing", "Deliberating", "Connecting", "Formulating", "Weighing", "Interpreting", "Deriving", "Clarifying", "Assessing", "Inferring", "Understanding", "Contemplating"],
  exploring: ["Exploring", "Searching", "Scanning", "Reading", "Surveying", "Mapping", "Tracing", "Reviewing", "Navigating", "Examining", "Inspecting", "Probing", "Investigating", "Traversing", "Discovering", "Gathering", "Cataloging", "Parsing", "Indexing", "Browsing"],
  planning:  ["Planning", "Organizing", "Structuring", "Designing", "Outlining", "Prioritizing", "Sequencing", "Strategizing", "Architecting", "Drafting", "Scoping", "Preparing", "Aligning", "Coordinating", "Framing", "Defining", "Decomposing", "Modeling", "Scheduling", "Mapping"],
  executing: ["Executing", "Building", "Writing", "Implementing", "Running", "Applying", "Creating", "Constructing", "Coding", "Editing", "Patching", "Updating", "Generating", "Configuring", "Deploying", "Installing", "Processing", "Compiling", "Completing", "Resolving"],
  verifying: ["Verifying", "Checking", "Testing", "Validating", "Confirming", "Reviewing", "Auditing", "Inspecting", "Comparing", "Diagnosing", "Debugging", "Scanning", "Ensuring", "Proofing", "Assessing", "Monitoring", "Evaluating", "Reconciling", "Linting", "Analyzing"],
  done:      ["Done"],
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

  const [collapsedPhases, setCollapsedPhases] = createSignal<Set<RunPhase>>(new Set())

  const togglePhase = (phase: RunPhase) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev)
      next.has(phase) ? next.delete(phase) : next.add(phase)
      return next
    })
  }

  const isPhaseExpanded = (phase: RunPhase | undefined): boolean => {
    if (!phase) return true
    const activePhases = getActivePhases(streamItems())
    if (activePhases.has(phase)) return true
    return !collapsedPhases().has(phase)
  }

  const streamItems = createMemo((): RenderableStreamItem[] => {
    return buildStreamItems(projectedRun(), messages(), sync.data.part)
  })

  const lastMessageIndex = createMemo(() => {
    const items = streamItems()
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === "message.user" || items[i].kind === "message.assistant") {
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
    return {
      tokens: totalTokens,
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
    if (projectedRun()) {
      return (projectedRun()?.approvals ?? [])
        .filter((a) => a.type === "question")
        .map((a) => ({
          id: a.approvalId,
          sessionID: a.runId,
          questions: [
            {
              question: a.reason,
              header: a.title,
              options: [],
            },
          ],
        }))
    }
    if (!session() || session()?.parentID) return []
    const legacy = children().flatMap((x) => sync.data.question[x.id] ?? [])
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
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "auto")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
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
  createEffect(() => {
    if (!session()?.parentID && shouldAutoOpenSidebar(displayMode())) {
      setSidebarOpen(true)
    }
  })
  onCleanup(() => {
    promptRef.set(undefined)
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
        return theme.danger
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
  const streamStatus = createMemo(() =>
    deriveLiveStreamStatus({
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
    const timer = setInterval(() => setVerbTick((tick) => tick + 1), 1400)
    onCleanup(() => clearInterval(timer))
  })

  // whimsicalVerb must be declared before doing() so the closure resolves correctly
  const whimsicalVerb = createMemo(() => {
    const stage = displayStageState().stage
    const verbs = STAGE_VERBS[stage] ?? STAGE_VERBS.thinking!
    return verbs[verbTick() % verbs.length]!
  })

  const doing = createMemo(() => {
    const stage = displayStageState().stage
    const reason = displayStageState().reason
    if (stage === "done") return "Ascending"
    if (stage === "waiting") return "Awaiting input"
    if (stage === "retrying") return "Retrying"
    if (!reason || isLowSignalStageReason(reason)) return whimsicalVerb()
    return reason
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

  const sidebarVisible = createMemo(() => {
    if (narrow()) return false
    return resolveSessionSidebarVisibility({
      hasParentSession: !!session()?.parentID,
      sidebarOpen: sidebarOpen(),
      displayMode: displayMode(),
    })
  })

  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() && wide() ? 42 : 0) - 4)

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
      return sessionStatusType() === "busy" || pending()
        ? `${followGlyph()} FOLLOWING`
        : "FOLLOWING"
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
  const hasRefineNeed = createMemo(() => !!refinedPrompt() || workstationState().planQuality?.decision === "pause")

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
    const timer = setInterval(() => {
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
    }, animationsEnabled() ? 220 : 280)
    onCleanup(() => clearInterval(timer))
  })

  const renderer = useRenderer()
  const keyboard = useKeyboard(() => {})

  const openPmPane = () => {
    setPaneMode(() => "memory")
    setPaneVisibility(() => "pinned")
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

  const paneBadge = (mode: PaneMode) => {
    switch (mode) {
      case "approvals":
        return workstationState().approvalSummary.pendingCount || undefined
      case "audit":
        return workstationState().auditSummary.findingsCount || undefined
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
            <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
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
              <Show when={streamItems().length === 0}>
                <box
                  paddingLeft={2}
                  paddingRight={2}
                  paddingTop={1}
                  paddingBottom={1}
                  borderStyle="round"
                  borderColor={liveBorderColor()}
                  backgroundColor={tint(theme.background, theme.backgroundElement, 0.22)}
                  flexDirection="column"
                  gap={0}
                >
                  <text fg={theme.text}>No activity in this session yet.</text>
                  <text fg={theme.textMuted}>
                    Send a prompt to start a governed run and stream live execution context.
                  </text>
                </box>
              </Show>
              <For each={streamItems()}>
                {(item, index) => (
                  <StreamItem
                    item={item}
                    expanded={isPhaseExpanded(item.phase)}
                    isLast={index() === lastMessageIndex()}
                    onTogglePhase={() => item.phase && togglePhase(item.phase)}
                    onNavigateToApprovals={openApprovalsPane}
                    MessageComponent={Message}
                  />
                )}
              </For>

              <Show when={(chatActive() || showLiveStatusNote()) && !showPane()}>
                <box paddingLeft={2} paddingRight={2} marginTop={1}>
                  <box
                    flexDirection="row"
                    gap={1}
                    alignItems="center"
                    paddingLeft={1}
                    paddingRight={1}
                    paddingTop={0}
                    paddingBottom={0}
                  >
                    <Spinner color={theme.primary} />
                    <text fg={theme.text}>{doing()}</text>
                    <Show when={runElapsed() > 1000}>
                      <text fg={theme.textMuted} dim>
                        {(() => {
                          const t = sessionTelemetry().tokens
                          const base = formatElapsed(runElapsed())
                          return t > 0 ? `(${base} · ↓ ${formatTokenCount(t)})` : `(${base})`
                        })()}
                      </text>
                    </Show>
                  </box>
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
              backgroundColor={theme.backgroundPanel}
              scrollAcceleration={scrollAcceleration()}
            >
              <box padding={1} gap={1} backgroundColor={theme.backgroundPanel} flexDirection="column">
                <box flexDirection="column" gap={1} border={["bottom"]} borderColor={theme.border} paddingBottom={1}>
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
                              : tint(theme.backgroundPanel, theme.textMuted, 0.04)
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
                    <AuditLogPane history={auditHistory()} latest={latestAudit()} />
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
                </Switch>
              </box>
            </scrollbox>
          </Show>
        </box>

        {/* Footer Area */}
        <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <Prompt
            ref={promptRef.set}
            disabled={promptDisabled()}
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
            const modes: WorkflowMode[] = ["plan", "build", "explore", "docs", "audit"]
            const idx = modes.indexOf(workflowMode())
            setWorkflowMode(modes[(idx + 1) % modes.length]!)
          }}
        />
        <Toast />
      </box>
    </context.Provider>
  )
}

function Message(props: { message: AssistantMessage | UserMessage; last: boolean; partsOverride?: Part[] }) {
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

  const modeLabel = createMemo(() => {
    if (props.message.role === "user") return "USER"
    return (props.message as AssistantMessage).agent.toUpperCase()
  })

  if (props.message.role === "user") {
    return (
      <box paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={1}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={fadeFg() ?? tint(theme.textMuted, theme.primary, 0.5)} dim>
            ● user
          </text>
          <Show when={ctx.showTimestamps()}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              {Locale.todayTimeOrDateTime(props.message.time.created)}
            </text>
          </Show>
        </box>
        <box paddingLeft={2} marginTop={0}>
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

  const daxSpeaking = createMemo(() => props.message.agent === "dax")

  const roleLabel = createMemo(() => {
    if (props.message.role === "user") return "USER"
    const agent = (props.message as AssistantMessage).agent.toLowerCase()
    switch (agent) {
      case "dax":
        return "EXECUTOR"
      case "explore":
        return "EXPLORER"
      case "plan":
      case "planner":
        return "PLANNER"
      case "review":
        return "REVIEWER"
      case "verify":
      case "verifier":
        return "VERIFIER"
      case "audit":
      case "auditor":
        return "AUDITOR"
      default:
        return agent.toUpperCase()
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

  const reasoningParts = createMemo(() => parts().filter((p): p is ReasoningPart => p.type === "reasoning"))
  const toolParts = createMemo(() => parts().filter((p): p is ToolPart => p.type === "tool"))
  const textParts = createMemo(() => parts().filter((p): p is TextPart => p.type === "text"))

  const renderableParts = createMemo(() => {
    const result: GroupedPart[] = []
    let currentCluster: ToolPart[] = []
    let contextGroup: ToolPart[] = []

    const flushContextGroup = () => {
      if (contextGroup.length > 0) {
        result.push({ type: "context-group", tools: contextGroup })
        contextGroup = []
      }
    }
    const flushCluster = () => {
      if (currentCluster.length > 0) {
        result.push({ type: "activity-cluster", tools: currentCluster })
        currentCluster = []
      }
    }

    for (const part of parts()) {
      if (part.type === "tool") {
        if (HIDDEN_TOOLS.has(part.tool)) continue
        if (CONTEXT_GROUP_TOOLS.has(part.tool)) {
          flushCluster()
          contextGroup.push(part)
        } else {
          flushContextGroup()
          currentCluster.push(part)
        }
      } else {
        flushContextGroup()
        flushCluster()
        result.push(part)
      }
    }
    flushContextGroup()
    flushCluster()
    return result
  })

  return (
    <Show when={renderableParts().length > 0 || !!props.message.error}>
      <Show when={renderableParts().length > 0}>
        <box
          paddingLeft={0}
          paddingRight={0}
          flexDirection="column"
          borderStyle="none"
          borderColor={theme.borderSubtle}
          backgroundColor="transparent"
          marginTop={0}
          marginBottom={0}
        >
          <box
            flexDirection="row"
            gap={1}
            alignItems="center"
            paddingTop={0}
            paddingBottom={0}
            marginBottom={1}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={tint(theme.textMuted, roleColor(), 0.5)} dim>
              ● {roleLabel().toLowerCase()}
            </text>
            <Show when={ctx.showTimestamps()}>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                {Locale.todayTimeOrDateTime(props.message.time.created)}
              </text>
            </Show>
          </box>
          <box paddingLeft={1} paddingRight={1} paddingBottom={0} flexDirection="column" gap={0}>
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
                      marginTop={0}
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
          <text fg={theme.error}>{props.message.error?.data.message}</text>
        </box>
      </Show>
    </Show>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
  "activity-cluster": ActivityClusterPart,
  "context-group": ContextGroupPart,
}

function ContextGroupPart(props: { part: { type: "context-group"; tools: ToolPart[] } }) {
  const { theme } = useTheme()
  const tools = props.part.tools
  const allCompleted = createMemo(() => tools.every((t) => t.state.status === "completed"))
  const hasActive = createMemo(() => tools.some((t) => t.state.status === "pending" || t.state.status === "running"))

  const counts = createMemo(() => {
    const c: Record<string, number> = {}
    for (const t of tools) {
      const label =
        t.tool === "webfetch"
          ? "fetches"
          : t.tool === "websearch"
            ? "searches"
            : t.tool === "codesearch"
              ? "code searches"
              : t.tool === "list"
                ? "listings"
                : t.tool === "read"
                  ? "files read"
                  : t.tool === "glob"
                    ? "globs"
                    : t.tool === "grep"
                      ? "greps"
                      : t.tool + "s"
      c[label] = (c[label] ?? 0) + 1
    }
    return Object.entries(c)
      .map(([label, count]) => `${count} ${label}`)
      .join(", ")
  })

  const evidenceSummary = createMemo(() => {
    const labels = tools
      .map((tool) => {
        const trace = deriveOperatorTraceLine(tool)
        return trimPunctuation(trace?.target ?? tool.tool)
      })
      .filter((label): label is string => !!label)

    if (labels.length === 0) return undefined
    const head = labels.slice(0, 3).map((label) => formatInlineCode(label))
    const suffix = labels.length > 3 ? ` + ${labels.length - 3} more` : ""
    return `${head.join(", ")}${suffix}`
  })

  const evidencePaths = createMemo(() => {
    return props.part.tools
      .map((p) => {
        const input = (p.state.status !== "pending" ? p.state.input : {}) as any
        return input?.filePath || input?.path || input?.pattern || input?.query || ""
      })
      .filter(Boolean)
  })

  return (
    <box
      flexDirection="column"
      gap={0}
      marginTop={1}
      marginBottom={0}
      marginLeft={1}
      marginRight={1}
      paddingLeft={1}
      paddingRight={1}
      borderStyle="rounded"
      borderColor={hasActive() ? theme.warning : theme.borderSubtle}
      backgroundColor={theme.backgroundPanel}
    >
      <box flexDirection="row" gap={1} alignItems="center" paddingBottom={allCompleted() ? 0 : 1}>
        <box flexDirection="row" gap={0.5} marginRight={1}>
          <text fg={theme.error}>●</text>
          <text fg={theme.warning}>●</text>
          <text fg={theme.success}>●</text>
        </box>
        <Show when={hasActive()} fallback={<text fg={theme.success}>✓</text>}>
          <Spinner color={theme.warning} />
        </Show>
        <text
          fg={hasActive() ? theme.warning : theme.textMuted}
          attributes={hasActive() ? TextAttributes.BOLD : undefined}
        >
          {hasActive() ? "Gathering context" : "Gathered context"}
        </text>
      </box>
      <Show when={allCompleted() && evidencePaths().length > 0}>
        <box flexDirection="column" gap={0} paddingTop={0} paddingLeft={1} paddingBottom={1}>
          <For each={evidencePaths()}>
            {(path) => (
              <text fg={theme.textMuted} dim wrapMode="word">
                · {path}
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function ActivityClusterPart(props: { part: { type: "activity-cluster"; tools: ToolPart[] } }) {
  return <ActivityCluster tools={props.part.tools} />
}

function formatInlineCode(value: string) {
  return `\`${value}\``
}

function trimPunctuation(value: string | undefined) {
  if (!value) return undefined
  return value.replace(/[.:]+$/g, "").trim()
}

function describeNarrativeTrace(trace: NonNullable<ReturnType<typeof deriveOperatorTraceLine>>) {
  switch (trace.action) {
    case "READ":
      return `Read through ${formatInlineCode(trace.target)}.`
    case "GLOB":
      return `Swept the workspace for ${formatInlineCode(trace.target)}.`
    case "GREP":
      return `Dug into ${formatInlineCode(trace.target)} across the repo.`
    case "LIST":
      return `Mapped out ${formatInlineCode(trace.target)}.`
    case "SKILL":
      return `Pulled in ${formatInlineCode(trace.target)}.`
    case "REFLECTION":
      return `Locked in a checkpoint for ${formatInlineCode(trace.target)}.`
    case "SHELL":
      return `Ran ${formatInlineCode(trace.target)} and checked the result.`
    case "WRITE":
      return `Wrote ${formatInlineCode(trace.target)}.`
    case "EDIT":
      return `Made the edit to ${formatInlineCode(trace.target)}.`
    case "PATCH":
      return `Patched ${formatInlineCode(trace.target)}.`
    case "TASK":
      return `Handed off ${formatInlineCode(trace.target)} to the next step.`
    case "TODO":
      return `Ticked off ${formatInlineCode(trace.target)} on the checklist.`
    case "QUESTION":
      return `Flagged a question about ${formatInlineCode(trace.target)}.`
    default:
      return `${trace.action} ${formatInlineCode(trace.target)}.`
  }
}

function describeTraceIntent(traces: Array<NonNullable<ReturnType<typeof deriveOperatorTraceLine>>>) {
  const actions = new Set(traces.map((trace) => trace.action))
  if (actions.has("READ") || actions.has("GLOB") || actions.has("GREP") || actions.has("LIST")) {
    return "Mapping the territory — pulling context before the next move."
  }
  if (actions.has("SHELL")) {
    return "Running checks — building confidence before committing."
  }
  if (actions.has("SKILL") || actions.has("REFLECTION") || actions.has("TASK") || actions.has("TODO")) {
    return "Thinking ahead — lining up what comes next."
  }
  if (actions.has("WRITE") || actions.has("EDIT") || actions.has("PATCH")) {
    return "Making the move — applying changes where it counts."
  }
  return "Pressing forward."
}

function describeNarrativeNext(next: string | undefined) {
  const normalized = trimPunctuation(next)?.toLowerCase()
  if (!normalized) return undefined
  switch (normalized) {
    case "continue plan execution":
      return "Pressing forward through the plan."
    case "capture evidence and verify":
      return "Using this to lock in the next checkpoint."
    case "decide next operation":
      return "Using the result to pick the next move."
    case "wait for tool completion":
    case "wait for command completion":
      return "Waiting on the current step."
    case "wait for planning step":
      return "Holding for the planning step."
    case "run verification":
      return "Checking the result before moving on."
    case "continue governed run":
      return "Continuing under governance."
    default:
      return trimPunctuation(next)
  }
}

function extractResultMeta(result: string | undefined): string | undefined {
  if (!result) return undefined
  if (result === "completed" || result === "in progress") return undefined
  const m = result.match(/\((.+)\)/)
  return m?.[1]
}

function describeTraceRollup(traces: Array<NonNullable<ReturnType<typeof deriveOperatorTraceLine>>>, completed: number) {
  if (traces.length === 0) return undefined
  if (traces.length === 1) return describeNarrativeTrace(traces[0]!)

  const actions = new Map<string, number>()
  for (const trace of traces) {
    const key = trace.action.toLowerCase()
    actions.set(key, (actions.get(key) ?? 0) + 1)
  }

  const summary = Array.from(actions.entries())
    .map(([action, count]) => `${count} ${action}${count === 1 ? "" : "s"}`)
    .slice(0, 3)
    .join(", ")

  return `${describeTraceIntent(traces)} ${completed}/${traces.length} checks complete (${summary}).`
}

function NarrativeToolList(props: { tools: ToolPart[]; showNext?: boolean }) {
  const { theme } = useTheme()
  const ctx = use()
  const traces = createMemo(() =>
    props.tools.map((tool) => ({ tool, trace: deriveOperatorTraceLine(tool) })),
  )
  const completed = createMemo(() => traces().filter((item) => item.tool.state.status === "completed").length)
  const narrativeTraces = createMemo(() =>
    traces()
      .map((item) => item.trace)
      .filter((trace): trace is NonNullable<typeof trace> => !!trace),
  )
  const lastTrace = createMemo(() => traces()[traces().length - 1])
  const traceSummary = createMemo(() => {
    const all = narrativeTraces()
    if (all.length === 0) return undefined
    return describeTraceRollup(all, completed())
  })
  const visibleTraces = createMemo(() =>
    traces()
      .filter((item) => !!item.trace)
      .slice(Math.max(0, traces().length - 3)),
  )
  const nextHint = createMemo(() => (props.showNext ? describeNarrativeNext(lastTrace()?.trace?.next) : undefined))

  return (
    <box flexDirection="column" gap={0} paddingLeft={1}>
      <Show when={traceSummary()}>
        <box flexDirection="column" gap={0} paddingBottom={nextHint() ? 1 : 1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="word">
            {traceSummary()!}
          </text>
        </box>
      </Show>
      <Show when={nextHint()}>
        <box flexDirection="row" gap={1} paddingBottom={1} alignItems="flex-start">
          <text fg={theme.accent} dim>
            →
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {nextHint()}
          </text>
        </box>
      </Show>
      <Show when={visibleTraces().length > 0}>
        <box flexDirection="column" gap={0} paddingTop={traceSummary() ? 0 : 1}>
          <For each={visibleTraces()}>
            {(item) => {
              const toolName = createMemo(() => item.tool.tool.toLowerCase())
              const isSignificant = createMemo(() => toolName() === "shell" || EXECUTE_TOOLS.has(toolName()) || PLAN_TOOLS.has(toolName()))
              
              // Extract target (filePath, pattern, etc) for visibility
              const target = createMemo(() => {
                const input = (item.tool.state.status !== "pending" ? item.tool.state.input : {}) as any
                return input?.filePath || input?.pattern || input?.path || input?.url || input?.query || ""
              })

              return (
                <Switch>
                  <Match when={isSignificant()}>
                    <box marginTop={0} marginBottom={1} marginRight={1}>
                       <ToolPart part={item.tool} last={false} message={null as any} />
                    </box>
                  </Match>
                  <Match when={true}>
                    <box flexDirection="row" gap={1} alignItems="flex-start" marginBottom={0.5}>
                      <text fg={item.tool.state.status === "completed" ? theme.textMuted : theme.primary}>·</text>
                      <box flexDirection="column" gap={0}>
                        <text
                          fg={item.tool.state.status === "completed" ? theme.textMuted : theme.text}
                          wrapMode="word"
                        >
                          {item.trace ? describeNarrativeTrace(item.trace) : item.tool.tool}
                        </text>
                        <Show when={target()}>
                          <text fg={theme.textMuted} dim paddingLeft={1}>
                            └ {target()}
                          </text>
                        </Show>
                      </box>
                    </box>
                  </Match>
                </Switch>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}

function ActivityCluster(props: { tools: ToolPart[] }) {
  return <NarrativeToolList tools={props.tools} showNext />
}

function cleanReasoningText(text: string) {
  return text
    .replace("[REDACTED]", "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .trim()
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage; marginTop?: number }) {
  const { theme, syntax } = useTheme()
  const ctx = use()
  const content = createMemo(() => cleanReasoningText(props.part.text))
  const reasoningFg = createMemo(() => tint(theme.textMuted, theme.text, 0.35))

  return (
    <Show when={content() && ctx.showThinking()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={1}
        paddingRight={0}
        marginTop={props.marginTop ?? 1}
        flexDirection="column"
        border={["left"]}
        borderColor={theme.primary}
        backgroundColor={tint(theme.background, theme.primary, 0.02)}
      >
        <box paddingBottom={1} flexDirection="column" gap={0}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            Checking
          </text>
          <code
            filetype="markdown"
            drawUnstyledText={false}
            streaming={true}
            syntaxStyle={syntax()}
            content={content()!}
            conceal={ctx.conceal()}
            fg={reasoningFg()}
          />
        </box>
      </box>
    </Show>
  )
}

const INTERNAL_AGENTS = new Set(["planner", "plan", "explore", "explorer", "review", "reviewer", "verify", "verifier", "audit", "auditor"])

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage; marginTop?: number }) {
  const ctx = use()
  const { syntax, theme } = useTheme()
  const isStreaming = createMemo(() => props.last && !props.message.time.completed)
  const isInternalAgent = createMemo(() => INTERNAL_AGENTS.has((props.message as AssistantMessage).agent?.toLowerCase() ?? ""))
  const [cursorOn, setCursorOn] = createSignal(true)
  onMount(() => {
    const timer = setInterval(() => setCursorOn((v) => !v), 530)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={props.part.text.trim()}>
      {/* Internal agent monologue (planner, explorer, etc.) — visible but clearly secondary */}
      <Show
        when={isInternalAgent()}
        fallback={
          /* Main executor response — full weight */
          <box
            id={"text-" + props.part.id}
            paddingLeft={2}
            paddingRight={2}
            paddingBottom={1}
            marginTop={props.marginTop ?? 1}
            flexShrink={0}
          >
            <markdown syntaxStyle={syntax()} streaming={true} content={props.part.text.trim()} conceal={ctx.conceal()} />
            <Show when={isStreaming()}>
              <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                {cursorOn() ? "▋" : " "}
              </text>
            </Show>
          </box>
        }
      >
        <box
          id={"text-" + props.part.id}
          paddingLeft={2}
          paddingRight={2}
          paddingBottom={1}
          paddingTop={1}
          marginTop={props.marginTop ?? 1}
          marginLeft={1}
          marginRight={1}
          flexShrink={0}
          border={["left"]}
          borderColor={tint(theme.borderSubtle, theme.background, 0.4)}
        >
          <markdown
            syntaxStyle={syntax()}
            streaming={true}
            content={props.part.text.trim()}
            conceal={ctx.conceal()}
            fg={tint(theme.textMuted, theme.text, 0.3)}
          />
          <Show when={isStreaming()}>
            <text fg={tint(theme.textMuted, theme.primary, 0.4)} attributes={TextAttributes.BOLD}>
              {cursorOn() ? "▋" : " "}
            </text>
          </Show>
        </box>
      </Show>
    </Show>
  )
}

const BLOCK_TOOLS = new Set(["shell", "edit", "write", "apply_patch", "task", "question", "reflection"])

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage; marginTop?: number }) {
  const ctx = use()
  const sync = useSync()
  const { theme } = useTheme()

  const toolprops = {
    get metadata() {
      return props.part.state.status === "pending" ? {} : (props.part.state.metadata ?? {})
    },
    get input() {
      return props.part.state.input ?? {}
    },
    get output() {
      return props.part.state.status === "completed" ? props.part.state.output : undefined
    },
    get permission() {
      const permissions = sync.data.permission[props.message.sessionID] ?? []
      const permissionIndex = permissions.findIndex((x) => x.tool?.callID === props.part.callID)
      return permissions[permissionIndex]
    },
    get tool() {
      return props.part.tool
    },
    get part() {
      return props.part
    },
    get marginTop() {
      return props.marginTop
    },
  }

  const toolName = createMemo(() => props.part.tool.toLowerCase())
  const isBlock = createMemo(() => BLOCK_TOOLS.has(toolName()))
  const isRunning = createMemo(() => props.part.state.status === "running" || props.part.state.status === "pending")

  return (
    <Switch>
      <Match when={toolName() === "shell"}>
        <Bash {...toolprops} />
      </Match>
      <Match when={toolName() === "write"}>
        <Write {...toolprops} />
      </Match>
      <Match when={toolName() === "edit"}>
        <Edit {...toolprops} />
      </Match>
      <Match when={isBlock()}>
        <BlockTool
          title={props.part.tool}
          isRunning={isRunning()}
          part={props.part}
          input={toolprops.input}
          output={toolprops.output}
        >
          <Switch>
            <Match when={toolName() === "task"}>
              <text fg={theme.text}>
                {(toolprops.input as any).subagent_type ?? "Task"}: {(toolprops.input as any).description ?? ""}
              </text>
            </Match>
            <Match when={toolName() === "question"}>
              <text fg={theme.text}>{(toolprops.input as any).question ?? ""}</text>
            </Match>
            <Match when={toolName() === "apply_patch"}>
              <text fg={theme.text}>
                {(() => { const n = Object.keys((toolprops.input as any).changes ?? {}).length; return `${n} file${n === 1 ? "" : "s"} patched` })()}
              </text>
            </Match>
            <Match when={toolName() === "reflection"}>
              <text fg={theme.text}>{(toolprops.input as any).goal ?? (toolprops.input as any).summary ?? "Locking in checkpoint"}</text>
            </Match>
          </Switch>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          icon={props.part.state.status === "completed" ? "✓" : "◌"}
          complete={props.part.state.status === "completed"}
          pending={`Running ${props.part.tool}...`}
          part={props.part}
        >
          <text fg={theme.textMuted}>{props.part.tool}</text>
          <Show when={props.part.state.status === "completed" && (toolprops.input as any).filePath}>
            <text fg={theme.textMuted}> {(toolprops.input as any).filePath}</text>
          </Show>
          <Show when={props.part.state.status === "completed" && (toolprops.input as any).pattern}>
            <text fg={theme.textMuted}> {(toolprops.input as any).pattern}</text>
          </Show>
          <Show when={props.part.state.status === "completed" && (toolprops.input as any).url}>
            <text fg={theme.textMuted}> {(toolprops.input as any).url}</text>
          </Show>
          <Show when={props.part.state.status === "completed" && (toolprops.input as any).query}>
            <text fg={theme.textMuted}> {(toolprops.input as any).query}</text>
          </Show>
        </InlineTool>
      </Match>
    </Switch>
  )
}

function InlineTool(props: {
  icon: string
  complete: boolean
  pending: string
  children: JSX.Element
  part: ToolPart
}) {
  const { theme } = useTheme()
  const isRunning = createMemo(() => props.part.state.status === "running" || props.part.state.status === "pending")

  return (
    <box flexDirection="row" gap={1} alignItems="center" paddingLeft={1}>
      <Show
        when={isRunning() && !props.complete}
        fallback={
          <text fg={props.complete ? theme.textMuted : theme.textMuted}>
            {props.complete ? "⎿" : props.icon}
          </text>
        }
      >
        <Spinner color={theme.primary} />
      </Show>
      <Show
        when={props.complete}
        fallback={
          <text fg={theme.textMuted} dim>
            {props.pending}
          </text>
        }
      >
        {props.children}
      </Show>
    </box>
  )
}

function BlockTool(props: {
  title: string
  isRunning: boolean
  part: ToolPart
  input: Record<string, unknown>
  output?: unknown
  children?: JSX.Element
}) {
  const { theme } = useTheme()
  const isCompleted = createMemo(() => props.part.state.status === "completed")
  const hasError = createMemo(() => props.part.state.status === "error")
  const accentColor = createMemo(() =>
    hasError() ? theme.error : isCompleted() ? theme.borderSubtle : theme.primary,
  )

  return (
    <box
      flexDirection="column"
      gap={0}
      marginTop={1}
      marginBottom={0}
      marginLeft={1}
      marginRight={1}
      paddingLeft={1}
      paddingRight={1}
      borderStyle="rounded"
      borderColor={accentColor()}
      backgroundColor={theme.backgroundPanel}
    >
      <box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between">
        <box flexDirection="row" gap={1} alignItems="center">
          <box flexDirection="row" gap={0.5} marginRight={1}>
            <text fg={theme.error}>●</text>
            <text fg={theme.warning}>●</text>
            <text fg={theme.success}>●</text>
          </box>
          <Show
            when={!hasError() && !isCompleted()}
            fallback={<text fg={hasError() ? theme.error : theme.success}>{hasError() ? "✗" : "✓"}</text>}
          >
            <Spinner color={theme.primary} />
          </Show>
          <text
            fg={hasError() ? theme.error : isCompleted() ? theme.textMuted : theme.primary}
            attributes={props.isRunning ? TextAttributes.BOLD : undefined}
          >
            {props.title}
          </text>
          <Show when={props.children}>
            <box flexDirection="row" gap={1} alignItems="center">
              <text fg={theme.textMuted} dim>—</text>
              {props.children}
            </box>
          </Show>
        </box>
      </box>
    </box>
  )
}

function Bash(props: ToolProps<typeof ShellTool>) {
  const { theme } = useTheme()
  const status = createMemo(() => props.part.state.status)
  const isRunning = createMemo(() => status() === "running" || status() === "pending")
  const hasError = createMemo(() => status() === "error")

  const rawOutput = createMemo(() => {
    const raw =
      typeof props.output === "string"
        ? props.output
        : typeof props.metadata.output === "string"
          ? props.metadata.output
          : ""
    return stripAnsi(raw.trim())
  })

  const outputLines = createMemo(() => rawOutput().split("\n").filter((l) => l.trim() !== ""))
  // Show the last 3 non-empty lines while streaming
  const liveLines = createMemo(() => outputLines().slice(-3))

  const command = createMemo(() => String((props.input as any).command ?? ""))
  const description = createMemo(() => String((props.input as any).description ?? ""))
  const displayCommand = createMemo(() => {
    const cmd = command()
    return cmd.length > 58 ? cmd.slice(0, 55) + "…" : cmd
  })

  return (
    <Switch>
      {/* ── Running or errored: rounded terminal block ── */}
      <Match when={isRunning() || hasError()}>
        <box
          flexDirection="column"
          gap={0}
          marginTop={1}
          marginLeft={1}
          marginRight={1}
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={liveLines().length > 0 ? 0 : 1}
          borderStyle="rounded"
          borderColor={hasError() ? theme.error : theme.accent}
          backgroundColor={theme.backgroundPanel}
        >
          {/* Header: ❯ command + spinner/error */}
          <box flexDirection="row" gap={1} justifyContent="space-between" alignItems="center">
            <box flexDirection="row" gap={1} alignItems="center">
              <box flexDirection="row" gap={0.5} marginRight={1}>
                <text fg={theme.error}>●</text>
                <text fg={theme.warning}>●</text>
                <text fg={theme.success}>●</text>
              </box>
              <text fg={hasError() ? theme.error : theme.accent} attributes={TextAttributes.BOLD}>
                ❯
              </text>
              <text
                fg={hasError() ? theme.error : theme.text}
                attributes={isRunning() ? TextAttributes.BOLD : undefined}
                wrapMode="none"
              >
                {displayCommand()}
              </text>
              <Show when={description()}>
                <text fg={theme.textMuted} dim>
                  — {description()}
                </text>
              </Show>
            </box>
            <Show when={isRunning()}>
              <Spinner color={theme.accent} />
            </Show>
            <Show when={hasError()}>
              <text fg={theme.error} attributes={TextAttributes.BOLD}>
                ✗
              </text>
            </Show>
          </box>

          {/* Separator + live output lines */}
          <Show when={liveLines().length > 0}>
            <box
              flexDirection="column"
              gap={0}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={1}
              border={["top"]}
              borderColor={hasError() ? theme.error : tint(theme.borderSubtle, theme.background, 0.5)}
            >
              <For each={liveLines()}>
                {(line) => (
                  <text fg={hasError() ? theme.error : theme.textMuted} wrapMode="word">
                    {line}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </box>
      </Match>

      {/* ── Completed: compact single line ── */}
      <Match when={true}>
        <box flexDirection="row" gap={1} alignItems="center" paddingLeft={1}>
          <text fg={theme.textMuted}>⎿</text>
          <text fg={theme.textMuted}>$</text>
          <text fg={theme.textMuted}>{description() || displayCommand()}</text>
          <Show when={description() && command()}>
            <text fg={theme.textMuted} dim>
              ({displayCommand()})
            </text>
          </Show>
          <Show when={outputLines().length > 0}>
            <text fg={theme.textMuted} dim>
              · {String(outputLines().length)} lines
            </text>
          </Show>
        </box>
      </Match>
    </Switch>
  )
}

function Write(props: ToolProps<typeof WriteTool>) {
  const { theme } = useTheme()
  return (
    <InlineTool icon="✓" pending="Writing file..." complete={props.part.state.status === "completed"} part={props.part}>
      <text fg={theme.textMuted}>Wrote {normalizePath((props.input as any).filePath!)}</text>
    </InlineTool>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const { theme } = useTheme()
  return (
    <InlineTool icon="✓" pending="Editing file..." complete={props.part.state.status === "completed"} part={props.part}>
      <text fg={theme.textMuted}>Edited {normalizePath((props.input as any).filePath!)}</text>
    </InlineTool>
  )
}

function normalizePath(filePath: string) {
  if (!filePath) return ""
  return filePath.replace(/\\/g, "/")
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
}

function formatElapsed(ms: number): string {
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

function isLowSignalStageReason(value: string | undefined) {
  if (!value) return true
  return /^(idle|session processing|response stream active|reasoning stream active|waiting for stream content)$/i.test(
    value.trim(),
  )
}
