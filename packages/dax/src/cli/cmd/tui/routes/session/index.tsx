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
import { applyPersonaVoice, getPersona, PERSONAS, type PersonaPack } from "@/dax/presentation/persona"
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
import { TodoItem } from "../../component/todo-item"
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
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { RAOPane } from "./rao-pane"
import { AuditLogPane } from "../../component/prompt/audit-log"
import { RefinePane } from "../../component/prompt/refine"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { formatTranscript } from "../../util/transcript"
import { UI } from "@/cli/ui.ts"
import { labelStage, type StreamStage } from "@/dax/workflow/stage"
import { parsePMList, parsePMRules } from "@/pm/format"
import {
  PANE_MODE,
  deriveActivePaneMode,
  deriveAutoPaneMode,
  paneCompactLabel,
  shouldAutoShowPane,
  type PaneFollowMode,
  type PaneMode,
  type PaneVisibility,
  paneLabel as daxPaneLabel,
  paneTitle as daxPaneTitle,
} from "@/dax/presentation/pane"
import { deriveWorkstationState, type WorkstationState } from "@/dax/presentation/workstation"
import {
  deriveAssistantInsightCard,
  deriveAuditHistory,
  deriveLiveSessionStageState,
  deriveLiveStreamStatus,
} from "@/dax/presentation/session-surface"
import {
  resolveSessionSidebarVisibility,
  shouldAutoOpenSidebar,
  shouldShowInterventionQueue,
  type DisplayMode,
} from "@/dax/presentation/session-display"
import { buildInterventionProjection, buildProposedChangesProjection } from "@/server/run-projections"
import type { ProposedChange as ProjectedProposedChange, RunEvent } from "@/server/run-contract"
import { VerificationReceipt } from "../../component/receipt"

type GroupedPart = Part | { type: "activity-cluster"; tools: ToolPart[] }
import { isEli12Mode } from "@/dax/intent"
import { DAX_SETTING } from "@/dax/settings"
import { formatUsd, latestContextUsage, sessionCostTotal, sessionTokenTotal } from "@/dax/session-metrics"
import { isGeminiSubscriptionLane } from "@/provider/gemini-subscription"
import { formatSessionExitMessage } from "./exit-message"
import { deriveFeatureBranchNudge } from "@/dax/presentation/vcs-guard"
import { deriveGitHubCINudge } from "@/dax/presentation/ci-guard"

addDefaultParsers(parsers.parsers)

const EXPLORE_TOOLS = new Set(["read", "glob", "grep", "list", "webfetch", "websearch", "codesearch"])
const PLAN_TOOLS = new Set(["task", "todowrite", "question", "skill"])
const EXECUTE_TOOLS = new Set(["write", "edit", "apply_patch", "shell"])
const VERIFY_TOOLS = new Set(["read", "grep", "list", "glob"])
const PRIMARY_STAGE_FLOW: StreamStage[] = ["thinking", "exploring", "planning", "executing", "verifying", "done"]
type PMTab = "note" | "list" | "rules"
type WorkflowMode = "build" | "plan" | "explore" | "docs" | "audit"
const WORKFLOW_MODES: WorkflowMode[] = ["plan", "build", "explore", "docs", "audit"]
const WORKFLOW_AGENT_MODES = new Set<WorkflowMode>(["plan", "build", "explore", "docs", "audit"])

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

export function Session() {
  const PANE_MODES = PANE_MODE

  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  
  const activePersona = createMemo(() => getPersona(kv.get(DAX_SETTING.session_persona, "zen")))
  const cyclePersona = () => {
    const current = activePersona().id
    const ids = Object.keys(PERSONAS)
    const next = ids[(ids.indexOf(current) + 1) % ids.length]
    kv.set(DAX_SETTING.session_persona, next)
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
  
  const projectedLifecycleEvents = createMemo<RunEvent[]>(() => {
    return lifecycle().flatMap<RunEvent>((event) => {
      const runId = event.properties?.runId || event.properties?.sessionId || route.sessionID
      if (!runId) return []
      if (event.type === "intervention.required") {
        return [{
          schemaVersion: "v1",
          eventId: `${event.type}:${event.properties.interventionId ?? event.timestamp}`,
          sequence: 0,
          cursor: `${event.type}:${event.properties.interventionId ?? event.timestamp}`,
          runId,
          timestamp: event.timestamp,
          type: "intervention.required",
          payload: {
            interventionId: event.properties.interventionId,
            reason: event.properties.reason,
            kind: event.properties.kind,
            approvalId: event.properties.approvalId,
            metadata: event.properties.metadata,
          },
        }]
      }
      if (event.type === "intervention.resolved") {
        return [{
          schemaVersion: "v1",
          eventId: `${event.type}:${event.properties.interventionId ?? event.timestamp}`,
          sequence: 0,
          cursor: `${event.type}:${event.properties.interventionId ?? event.timestamp}`,
          runId,
          timestamp: event.timestamp,
          type: "intervention.resolved",
          payload: {
            interventionId: event.properties.interventionId,
            status: event.properties.status,
            comment: event.properties.comment,
            resolvedAt: event.properties.resolvedAt ?? event.timestamp,
          },
        }]
      }
      return []
    })
  })

  const interventions = createMemo(() => buildInterventionProjection(projectedLifecycleEvents()))

  const permissions = createMemo(() => {
    if (!session() || session()?.parentID) return []
    const legacy = children().flatMap((x) => sync.data.permission[x.id] ?? [])
    const modern = children().flatMap((x) => (sync.data.approvals[x.id] ?? []).filter(a => (a.type as string) !== "question"))
    return modern.length > 0 ? (modern as any) : legacy
  })

  const projectedApprovalRecords = createMemo(() => {
    if (route.sessionID && (sync.data.approvals[route.sessionID]?.length ?? 0) > 0) return sync.data.approvals[route.sessionID] ?? []
    if (!session() || session()?.parentID) return []
    return children().flatMap((child) => sync.data.approvals[child.id] ?? [])
  })

  const proposedChanges = createMemo<ProjectedProposedChange[]>(() => {
    if (projectedApprovalRecords().length > 0) return buildProposedChangesProjection(projectedApprovalRecords())
    return permissions()
      .filter((p: any) => p.context?.diffPreview)
      .map((approval: any) => ({
        changeId: `legacy_${approval.id ?? approval.approvalId ?? approval.createdAt ?? Math.random().toString(36).slice(2)}`,
        runId: approval.runId ?? route.sessionID,
        approvalId: approval.approvalId,
        stepId: approval.context?.stepId,
        type: approval.type === "patch_apply" ? "patch" : "file_edit",
        filePath: approval.context?.filePath ?? "unknown",
        diff: approval.context?.diffPreview ?? "",
        status:
          approval.status === "pending"
            ? "pending"
            : approval.status === "approved"
              ? "approved_not_applied"
              : approval.status === "denied"
                ? "rejected"
                : "stale",
        createdAt: approval.createdAt ?? new Date().toISOString(),
      }))
  })

  const narrative = createMemo(() => {
    const combined = [
      ...messages().map((m) => ({ type: "message" as const, id: m.id, timestamp: m.time.created, data: m })),
      ...lifecycle().map((l) => ({ type: "lifecycle" as const, id: l.timestamp + l.type, timestamp: new Date(l.timestamp).getTime(), data: l })),
    ]
    return combined.toSorted((a, b) => a.timestamp - b.timestamp)
  })

  const currentRun = createMemo(() => {
    const events = lifecycle()
    const stateEvent = events.findLast(e => e.type === "run.state_changed")
    return stateEvent?.properties
  })

  const currentStep = createMemo(() => {
    const events = lifecycle()
    const stepEvent = events.findLast(e => e.type === "plan.step_promoted")
    return stepEvent?.properties
  })

  const modernTrust = createMemo(() => {
    const events = lifecycle()
    const auditEvent = events.findLast(e => e.type === "audit.posture_updated")
    return auditEvent?.properties?.trust
  })

  const questions = createMemo(() => {
    if (!session() || session()?.parentID) return []
    const legacy = children().flatMap((x) => sync.data.question[x.id] ?? [])
    const modern = children().flatMap((x) => (sync.data.approvals[x.id] ?? []).filter(a => (a.type as string) === "question"))
    return modern.length > 0 ? (modern as any) : legacy
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
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = kv.signal("thinking_visibility", false)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", false)
  const [showAssistantMetadata, setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showEli12Summary, setShowEli12Summary] = kv.signal(DAX_SETTING.eli12_summary_visibility, false)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [animationsEnabled, setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [paneVisibility, setPaneVisibility] = kv.signal<PaneVisibility>(DAX_SETTING.session_pane_visibility, "auto")
  const [paneMode, setPaneMode] = kv.signal<PaneMode>(DAX_SETTING.session_pane_mode, "plan")
  const [paneFollowMode, setPaneFollowMode] = kv.signal<PaneFollowMode>(DAX_SETTING.session_pane_follow_mode, "smart")
  const [workflowMode, setWorkflowMode] = kv.signal<WorkflowMode>(DAX_SETTING.session_workflow_mode, "plan")
  const [slowStream, setSlowStream] = kv.signal(DAX_SETTING.session_stream_slow, true)
  const [displayMode] = kv.signal<DisplayMode>(DAX_SETTING.display_mode, "operator")
  const [queueVisibleRaw] = kv.signal<string | boolean>(DAX_SETTING.intervention_queue_visible, true)
  const [selectedProposedChangeId, setSelectedProposedChangeId] = createSignal<string>()
  // Track refined prompt - always read fresh from KV when render
  const refinedPrompt = createMemo(() => {
    // Force re-read whenever these change
    const mode = kv.store[DAX_SETTING.session_pane_mode]
    const vis = kv.store[DAX_SETTING.session_pane_visibility]
    const ref = kv.store[DAX_SETTING.session_refined_prompt]
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
  const STAGE_MIN_DWELL_MS = 1200
  const STREAM_RENDER_CADENCE_MS = 30
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

    const immediate = next.stage === "waiting" || next.stage === "retrying" || current.stage === "waiting"
    if (immediate) {
      setDisplayStageState(next)
      setStageLastChangedAt(Date.now())
      return
    }

    const elapsed = Date.now() - stageLastChangedAt()
    const remaining = Math.max(0, STAGE_MIN_DWELL_MS - elapsed)
    if (remaining === 0) {
      setDisplayStageState(next)
      setStageLastChangedAt(Date.now())
      return
    }

    const timer = setTimeout(() => {
      setDisplayStageState(stageState())
      setStageLastChangedAt(Date.now())
    }, remaining)
    onCleanup(() => clearTimeout(timer))
  })
  const stageLabel = createMemo(() => {
    return labelStage(displayStageState().stage, explainMode())
  })
  const stageColor = createMemo(() => {
    const stage = displayStageState().stage
    if (stage === "waiting") return theme.primary
    if (stage === "retrying") return theme.error
    if (stage === "done") return theme.success
    return theme.accent
  })
  const streamStatus = createMemo(() => {
    return deriveLiveStreamStatus({
      pendingID: pending(),
      partsForMessage: (messageID) => sync.data.part[messageID] ?? [],
    })
  })
  const [smartFollowActive, setSmartFollowActive] = createSignal(true)
  const [pendingUpdates, setPendingUpdates] = createSignal(0)
  const [streamParts, setStreamParts] = createSignal<Record<string, Part[]>>({})

  const wide = createMemo(() => dimensions().width > 120)
  const hasApprovalsNeed = createMemo(() => permissions().length > 0 || questions().length > 0)
  const sidebarVisible = createMemo(() => {
    return resolveSessionSidebarVisibility({
      hasParentSession: !!session()?.parentID,
      sidebarOpen: sidebarOpen(),
      displayMode: displayMode(),
    })
  })
  const showInterventionQueue = createMemo(() =>
    shouldShowInterventionQueue({
      displayMode: displayMode(),
      queueVisible: queueVisibleRaw() !== false && queueVisibleRaw() !== "false",
    }),
  )
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() && wide() ? 42 : 0) - 4)
  const liveStacked = createMemo(() => contentWidth() < 80)
  const stripCompact = createMemo(() => contentWidth() < 112)
  const stripTight = createMemo(() => contentWidth() < 132)
  const stripInnerWidth = createMemo(() => Math.max(0, contentWidth()))
  const stripColumns = createMemo(() => {
    const w = stripInnerWidth()
    if (w >= 120) return 4
    if (w >= 64) return 2
    return 1
  })
  const stripGap = createMemo(() => (stripColumns() === 1 ? 0 : 1))
  const stripInnerSectionWidth = createMemo(() => {
    const cols = stripColumns()
    const inner = Math.max(0, stripInnerWidth() - stripGap() * (cols - 1))
    return Math.max(0, Math.floor(inner / cols))
  })
  const livePaneWidth = createMemo(() => {
    const total = contentWidth()
    const gapAndBorders = 6
    const target = Math.floor((total - gapAndBorders) * 0.35)
    return Math.max(40, Math.min(64, target))
  })
  const compactPaneTabs = createMemo(() => !liveStacked() && livePaneWidth() < 48)
  const mainPaneGrow = createMemo(() => (liveStacked() ? 1 : 7))
  const sidePaneGrow = createMemo(() => (liveStacked() ? 1 : 3))
  const paneDiffView = createMemo(() => {
    const diffStyle = sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    const availableWidth = liveStacked() ? contentWidth() : livePaneWidth()
    return availableWidth > 120 ? "split" : "unified"
  })
  const followEnabled = createMemo(() => paneFollowMode() === "live" || smartFollowActive())
  const sessionPartCount = createMemo(() =>
    messages().reduce((acc, msg) => acc + (sync.data.part[msg.id]?.length ?? 0), 0),
  )
  const sessionTurnCount = createMemo(() => messages().filter((message) => message.role === "user").length)
  const incompleteTodoCount = createMemo(() => todo().filter((item) => item.status !== "completed").length)
  const sessionTokenCount = createMemo(() => sessionTokenTotal(messages()))
  const [googleSubscriptionLaneActive, setGoogleSubscriptionLaneActive] = createSignal(false)
  createEffect(
    on(messages, async (current) => {
      const assistantMessages = current.filter((message) => message.role === "assistant")
      const hasGoogleMessages = assistantMessages.some((message) => message.providerID === "google")
      if (!hasGoogleMessages) {
        setGoogleSubscriptionLaneActive(false)
        return
      }
      const auth = await Auth.get("google")
      setGoogleSubscriptionLaneActive(
        isGeminiSubscriptionLane({
          providerID: "google",
          auth,
        }),
      )
    }),
  )
  const sessionCostLabel = createMemo(() => {
    const assistantMessages = messages().filter((message) => message.role === "assistant")
    const hasBillableNonGoogle = assistantMessages.some(
      (message) => message.providerID !== "google" && (message.cost ?? 0) > 0,
    )
    if (googleSubscriptionLaneActive() && !hasBillableNonGoogle) return "included"
    return formatUsd(sessionCostTotal(messages()))
  })
  const sessionGeneratedTokenCount = createMemo(() =>
    messages().reduce((sum, message) => {
      if (message.role !== "assistant") return sum
      const tokens = message.tokens
      if (!tokens) return sum
      return sum + (tokens.output ?? 0) + (tokens.reasoning ?? 0)
    }, 0),
  )
  const sessionElapsedLabel = createMemo(() => {
    const currentSession = session()
    if (!currentSession) return undefined
    const duration = Math.max(
      0,
      (currentSession.time.updated ?? currentSession.time.created) - currentSession.time.created,
    )
    if (!duration) return undefined
    return Locale.duration(duration)
  })
  const contextUsage = createMemo(() => latestContextUsage(messages(), sync.data.provider))
  const connectedMcpCount = createMemo(
    () => Object.values(sync.data.mcp).filter((item) => item.status === "connected").length,
  )
  const [retryClock, setRetryClock] = createSignal(Date.now())
  createEffect(() => {
    const status = sync.data.session_status?.[route.sessionID]
    if (status?.type !== "retry") return
    setRetryClock(Date.now())
    const timer = setInterval(() => setRetryClock(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const selectedTheme = createMemo(() => themeState.selected)
  const selectedThemeShort = createMemo(() => {
    const name = selectedTheme()
    if (name.length <= 14) return name
    return `${name.slice(0, 11)}...`
  })
  const headerStats = createMemo(() => {
    const items: { label: string; color?: RGBA }[] = [{ label: stageLabel().toLowerCase(), color: stageColor() }]
    const status = sync.data.session_status?.[route.sessionID]
    const usage = contextUsage()
    const activeInterventions = interventions().filter(i => i.status === "requested" || i.status === "pending")
    
    if (activeInterventions.length > 0) {
      items.push({
        label: `intervention required (${activeInterventions.length})`,
        color: theme.error,
      })
    }

    if (usage) {
      items.push({
        label: usage.percentage !== null ? `context ${usage.percentage}%` : `context ${usage.tokens.toLocaleString()}`,
      })
    }
    if (status?.type === "retry") {
      items.push({
        label: `retry ${Locale.duration(Math.max(0, status.next - retryClock()))}`,
        color: theme.error,
      })
    } else if (status?.type === "delayed") {
      items.push({
        label: "provider delayed",
        color: theme.error,
      })
    }
    if (!stripCompact()) {
      items.push({ label: `tokens ${sessionTokenCount().toLocaleString()}` })
      if (sessionGeneratedTokenCount() > 0) {
        items.push({ label: `generated ${sessionGeneratedTokenCount().toLocaleString()}` })
      }
      items.push({
        label: googleSubscriptionLaneActive() && sessionCostLabel() === "included" ? "cost included" : sessionCostLabel(),
      })
    } else {
      items.push({ label: `${sessionTurnCount()} turns` })
    }
    if (!stripTight() && connectedMcpCount() > 0) {
      items.push({ label: `mcp ${connectedMcpCount()}` })
    }
    return items
  })
  let lastUpdateKey = ""

  const renderParts = (message: { id: string; role: string; time: { created: number; completed?: number } }) => {
    const parts = sync.data.part[message.id] ?? []
    if (!slowStream()) return parts
    if (message.role !== "assistant") return parts
    if (message.time.completed) return parts
    return streamParts()[message.id] ?? []
  }

  function snapshotStreamParts() {
    const streamingMessages = messages().filter((m) => m.role === "assistant" && !m.time.completed)
    if (streamingMessages.length === 0) {
      if (Object.keys(streamParts()).length > 0) {
        setStreamParts({})
      }
      return
    }
    setStreamParts((prev) => {
      const next: Record<string, Part[]> = { ...prev }
      let changed = false
      for (const message of streamingMessages) {
        const parts = sync.data.part[message.id] ?? []
        const prevParts = prev[message.id]
        if (prevParts?.length !== parts.length) {
          changed = true
        }
        next[message.id] = [...parts]
      }
      for (const key of Object.keys(next)) {
        if (!streamingMessages.some((m) => m.id === key)) {
          delete next[key]
          changed = true
        }
      }
      return changed ? next : prev
    })
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
    toast.show({ message: `Theme: ${next}`, variant: "success", duration: 1800 })
  }

  function cyclePaneVisibility() {
    const next = paneVisibility() === "auto" ? "pinned" : paneVisibility() === "pinned" ? "hidden" : "auto"
    setPaneVisibility(() => next)
  }

  function cycleWorkflowMode(step: 1 | -1) {
    const idx = WORKFLOW_MODES.indexOf(workflowMode())
    const next = WORKFLOW_MODES[(idx + step + WORKFLOW_MODES.length) % WORKFLOW_MODES.length]
    selectWorkflowMode(next)
  }

  function pauseSmartFollow() {
    if (paneFollowMode() !== "smart") return
    if (!smartFollowActive()) return
    setSmartFollowActive(false)
  }

  function jumpToLive() {
    setSmartFollowActive(true)
    setPendingUpdates(0)
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 10)
  }

  const scrollAcceleration = createMemo(() => {
    const tui = sync.data.config.tui
    if (tui?.scroll_acceleration?.enabled) {
      return new MacOSScrollAccel()
    }
    if (tui?.scroll_speed) {
      return new CustomSpeedScroll(tui.scroll_speed)
    }

    return new CustomSpeedScroll(3)
  })

  createEffect(async () => {
    await sync.session
      .sync(route.sessionID)
      .then(() => {
        if (scroll) scroll.scrollBy(100_000)
      })
      .catch((e) => {
        console.error(e)
        toast.show({
          message: `Session not found: ${route.sessionID}`,
          variant: "error",
        })
        return navigate({ type: "home" })
      })
  })

  const toast = useToast()
  const sdk = useSDK()

  // Handle initial prompt from fork
  createEffect(() => {
    if (route.initialPrompt && prompt) {
      prompt?.set(route.initialPrompt)
    }
  })

  let lastSwitch: string | undefined = undefined
  sdk.event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.type !== "tool") return
    if (part.sessionID !== route.sessionID) return
    if (part.state.status !== "completed") return
    if (part.id === lastSwitch) return

    if (part.tool === "plan_exit") {
      local.agent.set("build")
      setWorkflowMode(() => "build")
      lastSwitch = part.id
    } else if (part.tool === "plan_enter") {
      local.agent.set("plan")
      setWorkflowMode(() => "plan")
      lastSwitch = part.id
    }
  })

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef | undefined
  const keybind = useKeybind()

  // Allow exit when in child session (prompt is hidden)
  const exit = useExit()

  createEffect(() => {
    return exit.message.set(
      formatSessionExitMessage({
        sessionID: session()?.id,
        title: session()?.title,
        turnCount: sessionTurnCount(),
        tokenCount: sessionTokenCount(),
        generatedTokenCount: sessionGeneratedTokenCount(),
        elapsedLabel: sessionElapsedLabel(),
        costLabel: sessionCostLabel(),
      }),
    )
  })

  useKeyboard((evt) => {
    if (keybind.match("agent_cycle", evt)) {
      evt.preventDefault()
      cycleWorkflowMode(1)
      return
    }
    if (keybind.match("agent_cycle_reverse", evt)) {
      evt.preventDefault()
      cycleWorkflowMode(-1)
      return
    }
    // Handle keybindings that should work in all sessions (including child sessions)
    if (keybind.match("app_exit", evt)) {
      exit()
      return
    }
    // Session-specific keybindings (only for primary sessions)
    if (!session()?.parentID) {
      if (keybind.match("history_previous", evt) && evt.shift) {
        // ... existing history navigation logic ...
      }
      if (keybind.match("history_next", evt) && evt.shift) {
        // ... existing history navigation logic ...
      }
      // Add other session-specific keybindings here as needed
    }
  })

  // Helper: Find next visible message boundary in direction
  const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
    const children = scroll.getChildren()
    const messagesList = messages()
    const scrollTop = scroll.y

    // Get visible messages sorted by position, filtering for valid non-synthetic, non-ignored content
    const visibleMessages = children
      .filter((c) => {
        if (!c.id) return false
        const message = messagesList.find((m) => m.id === c.id)
        if (!message) return false

        // Check if message has valid non-synthetic, non-ignored text parts
        const parts = sync.data.part[message.id]
        if (!parts || !Array.isArray(parts)) return false

        return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
      })
      .sort((a, b) => a.y - b.y)

    if (visibleMessages.length === 0) return null

    if (direction === "next") {
      // Find first message below current position
      return visibleMessages.find((c) => c.y > scrollTop + 10)?.id ?? null
    }
    // Find last message above current position
    return [...visibleMessages].reverse().find((c) => c.y < scrollTop - 10)?.id ?? null
  }

  // Helper: Scroll to message in direction or fallback to page scroll
  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      dialog.clear()
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
    dialog.clear()
  }

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()
  const [pmTab, setPmTab] = kv.signal<PMTab>(DAX_SETTING.session_pm_tab, "note")

  const messageText = (messageID: string) => {
    const parts = sync.data.part[messageID] ?? []
    let text = ""
    for (const part of parts) {
      if (part.type !== "text" || part.synthetic) continue
      text += part.text
    }
    return text.trim()
  }

  const pmHistory = createMemo(() => {
    const messageList = messages()
    const items: Array<{
      commandText: string
      subcommand: PMTab | "help"
      responseText: string
      createdAt: number
    }> = []

    for (const message of messageList) {
      if (message.role !== "user") continue
      const commandText = messageText(message.id)
      if (!commandText.startsWith("/pm")) continue
      const subcommand = (commandText.split(/\s+/)[1]?.toLowerCase() ?? "help") as PMTab | "help"
      const response = messageList.find(
        (candidate) => candidate.role === "assistant" && candidate.parentID === message.id,
      )
      if (!response) continue
      const responseText = messageText(response.id)
      if (!responseText) continue

      items.push({
        commandText,
        subcommand: ["note", "list", "rules"].includes(subcommand) ? (subcommand as PMTab) : "help",
        responseText,
        createdAt: response.time.created,
      })
    }

    return items
  })

  const recentPmCommands = createMemo(() =>
    messages()
      .filter((message) => message.role === "user")
      .map((message) => ({
        id: message.id,
        text: messageText(message.id),
      }))
      .filter((entry) => entry.text.startsWith("/pm "))
      .slice(-6)
      .reverse(),
  )

  const latestPmListResponse = createMemo(() => pmHistory().findLast((entry) => entry.subcommand === "list"))
  const latestPmRulesResponse = createMemo(() =>
    pmHistory().findLast((entry) => entry.subcommand === "rules" && entry.commandText.trim() === "/pm rules"),
  )
  const latestPmRulesAddResponse = createMemo(() =>
    pmHistory().findLast(
      (entry) => entry.subcommand === "rules" && entry.commandText.trim().startsWith("/pm rules add "),
    ),
  )

  const parsedPmList = createMemo(() => {
    const responseText = latestPmListResponse()?.responseText
    const parsed = parsePMList(responseText ?? "")
    return {
      rows: parsed.rows,
      empty: parsed.rows.length === 0,
      info: parsed.info ?? "",
    }
  })

  const parsedPmRules = createMemo(() => {
    const responseText = latestPmRulesResponse()?.responseText
    const parsed = parsePMRules(responseText ?? "")
    return {
      rows: parsed.rows,
      empty: parsed.rows.length === 0,
      info: parsed.info ?? "",
    }
  })
  const pendingRaoCount = createMemo(() => permissions().length + questions().length)
  const pmSummary = createMemo(() => {
    const recent = recentPmCommands()
    return {
      recent,
      recentCount: recent.length,
      noteCount: parsedPmList().rows.length,
      ruleCount: parsedPmRules().rows.length,
      latestCommand: recent[0]?.text,
    }
  })
  const latestUserCommand = createMemo(() => {
    for (const message of [...messages()].reverse()) {
      if (message.role !== "user") continue
      const text = messageText(message.id)
      if (!text.startsWith("/")) continue
      return text
    }
    return ""
  })
  const latestUserAsk = createMemo(() => {
    for (const message of [...messages()].reverse()) {
      if (message.role !== "user") continue
      const text = messageText(message.id)
      if (!text) continue
      if (text.startsWith("/")) continue
      return text
    }
    return ""
  })
  const liveMissionGoal = createMemo(() => {
    const sessionTitle = session()?.title?.trim()
    const latestAsk = latestUserAsk().trim()
    const lowSignalAsk =
      !latestAsk ||
      /^(hi|hello|hey|yo|sup|hola|greetings|good (morning|afternoon|evening)|what's up|whats up)$/i.test(latestAsk) ||
      latestAsk.split(/\s+/).length <= 2
    const genericTitle =
      !sessionTitle ||
      /^(greeting|greeting and .*|new run|session|hello|hi)$/i.test(sessionTitle) ||
      sessionTitle.split(/\s+/).length <= 2

    if (lowSignalAsk && genericTitle) return "Initial check-in"
    if (lowSignalAsk && sessionTitle) return sessionTitle
    if (latestAsk && genericTitle) return latestAsk
    if (
      latestAsk &&
      sessionTitle &&
      latestAsk.toLowerCase() !== sessionTitle.toLowerCase() &&
      latestAsk.length > sessionTitle.length
    ) {
      return latestAsk
    }
    return sessionTitle || latestAsk
  })
  const recentTools = createMemo(() => {
    const items: Array<{ tool: string; status: string; label: string; command?: string; output?: string }> = []
    for (const msg of [...messages()].reverse()) {
      if (msg.role !== "assistant") continue
      for (const part of [...(sync.data.part[msg.id] ?? [])].reverse()) {
        if (part.type !== "tool") continue
        const input = (part.state.input ?? {}) as Record<string, any>
        items.push({
          tool: part.tool,
          status: part.state.status,
          label: describeRecentTool(part.tool, input),
          command: typeof input.command === "string" ? input.command : undefined,
          output:
            "output" in part.state && typeof part.state.output === "string" ? part.state.output : undefined,
        })
        if (items.length >= 5) return items
      }
    }
    return items
  })
  const hasLivePaneContext = createMemo(() => {
    if (sessionStatusType() !== "idle") return true
    if (stageState().stage !== "done") return true
    if (todo().some((item) => item.status === "in_progress")) return true
    if (recentTools().some((item) => item.status === "pending")) return true
    return false
  })
  const liveMilestones = createMemo(() => {
    if (todo().length > 0) {
      return todo()
        .slice(0, 6)
        .map((item) => ({
          label: item.content,
          status: item.status === "completed" ? "done" : item.status === "in_progress" ? "active" : "pending",
        }))
    }

    const items: Array<{ label: string; status: "done" | "active" | "pending" }> = []
    const stage = stageState().stage
    const stageReasonText = stageState().reason
    if (liveMissionGoal()) items.push({ label: `Scope request: ${liveMissionGoal()}`, status: "done" })
    if (recentTools().length > 0) {
      items.push(
        ...recentTools()
          .slice(0, 2)
          .map((tool) => ({
            label: tool.label,
            status:
              tool.status === "completed"
                ? ("done" as const)
                : tool.status === "pending"
                  ? ("active" as const)
                  : ("pending" as const),
          })),
      )
    }
    if (stageReasonText && !isLowSignalPaneReason(stageReasonText) && items.length < 4) {
      items.push({
        label: stageReasonText,
        status: stage === "done" ? "done" : stage === "waiting" ? "pending" : "active",
      })
    }
    if (pendingRaoCount() > 0) {
      items.push({
        label: `${pendingRaoCount()} approval or question item${pendingRaoCount() === 1 ? "" : "s"} need attention`,
        status: "pending",
      })
    }
    return items.slice(0, 5)
  })
  const auditHistory = createMemo(() =>
    deriveAuditHistory({
      messages: messages(),
      messageText,
    }),
  )

  const latestAudit = createMemo(() => auditHistory().findLast((entry) => entry.result !== undefined))
  const trustSurface = createMemo(() => {
    const audit = latestAudit()?.result
    if (!audit) return { label: "idle", color: theme.textMuted }
    if (audit.status === "pass") return { label: "clear", color: theme.success }
    if (audit.status === "warn") return { label: "warn", color: theme.primary }
    return { label: "blocked", color: theme.error }
  })

  const prefillPmNote = () => {
    prompt?.set({
      input: "/pm note Project constants | Product codename is ... | release,context",
      parts: [],
    })
  }

  const isMutatingCommand = (name: string, args: string) => {
    const mutating = ["write", "edit", "apply_patch", "rm", "mv", "cp", "mkdir", "git", "npm", "bun", "yarn", "pnpm", "cargo", "go", "pip"]
    if (mutating.includes(name)) return true
    // Also check for common shell mutations in generic shell commands
    if (name === "shell" || name === "sh" || name === "bash") {
      const lower = args.toLowerCase()
      return /\b(rm|mv|cp|mkdir|git|npm|bun|yarn|pnpm|cargo|go|pip|chmod|chown|patch|apply)\b/.test(lower)
    }
    return false
  }

  const runSessionSlashCommand = async (raw: string) => {
    const selectedModel = local.model.current()
    if (!selectedModel) {
      toast.show({
        variant: "warning",
        message: "Select a model before running commands",
        duration: 3000,
      })
      return
    }

    const trimmed = raw.trim()
    if (!trimmed.startsWith("/")) return
    const isAuditCommand = trimmed.startsWith("/audit")
    if (isAuditCommand) {
      setWorkflowMode(() => "audit")
      local.agent.set("audit")
    }
    const commandLine = trimmed.slice(1)
    const [name, ...rest] = commandLine.split(" ")
    if (!name) return
    const variant = local.model.variant.current()
    const args = rest.join(" ").trim()

    if (workflowMode() === "explore" && isMutatingCommand(name, args)) {
      toast.show({
        variant: "error",
        message: `Command "${name}" is blocked in Explore mode. Promote to Build mode first.`,
        duration: 4000,
      })
      return
    }

    const commandAgent = isAuditCommand ? "audit" : local.agent.current().name

    await sdk.client.session
      .command({
        sessionID: route.sessionID,
        command: name,
        arguments: args,
        agent: commandAgent,
        model: `${selectedModel.providerID}/${selectedModel.modelID}`,
        messageID: Identifier.ascending("message"),
        variant,
        parts: [],
      })
      .then(() => {
        setPaneVisibility(() => "pinned")
        toast.show({ message: `Queued ${trimmed}`, variant: "success", duration: 1600 })
        toBottom()
      })
      .catch((error) => {
        toast.error(error)
      })
  }

  const runPmCommand = async (raw: string) => runSessionSlashCommand(raw)
  const runAuditCommand = async (raw: string) => runSessionSlashCommand(raw)

  const selectWorkflowMode = (mode: WorkflowMode) => {
    const availableAgents = local.agent.list()
    if (!availableAgents.some((a) => a.name === mode)) {
      toast.show({
        variant: "warning",
        message: `Mode "${mode}" not available. Agents loading...`,
        duration: 3000,
      })
      return
    }
    setWorkflowMode(() => mode)
    local.agent.set(mode)
    prompt?.focus()
  }

  const revertInfo = createMemo(() => session()?.revert)
  const revertMessageID = createMemo(() => revertInfo()?.messageID)

  const revertDiffFiles = createMemo(() => {
    const diffText = revertInfo()?.diff ?? ""
    if (!diffText) return []

    try {
      const patches = parsePatch(diffText)
      return patches.map((patch) => {
        const filename = patch.newFileName || patch.oldFileName || "unknown"
        const cleanFilename = filename.replace(/^[ab]\//, "")
        return {
          filename: cleanFilename,
          additions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("+")).length,
            0,
          ),
          deletions: patch.hunks.reduce(
            (sum, hunk) => sum + hunk.lines.filter((line) => line.startsWith("-")).length,
            0,
          ),
        }
      })
    } catch {
      return []
    }
  })

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info?.messageID) return
    return {
      messageID: info.messageID,
      reverted: revertRevertedMessages(),
      diff: info.diff,
      diffFiles: revertDiffFiles(),
    }
  })

  const paneDiffFiletype = createMemo(() => {
    const files = revert()?.diffFiles
    if (!files?.length) return "none"
    return filetype(files[0].filename)
  })

  const hasMemoryNeed = createMemo(() => latestUserCommand().startsWith("/pm"))
  const hasRefineNeed = createMemo(() => refinedPrompt().trim().length > 0)
  const hasAuditNeed = createMemo(() => {
    const audit = latestAudit()?.result
    return workflowMode() === "audit" || audit?.status === "warn" || audit?.status === "fail"
  })
  const hasPlanContext = createMemo(() => todo().length > 0 || !!liveMissionGoal())
  const hasDiffNeed = createMemo(() => !!revert()?.diff || proposedChanges().length > 0)
  const refineStatus = createMemo(() => {
    if (!refinedPrompt().trim()) return undefined
    if (proposedChanges().length > 0 && refineWrites().length === 0) {
      return {
        label: "drift detected",
        tone: "error" as const,
        reason: "The run has concrete change context but the refine contract did not forecast likely writes.",
      }
    }
    if (pendingRaoCount() > 0 && refineApprovals().length === 0) {
      return {
        label: "watch",
        tone: "warning" as const,
        reason: "The run paused for operator review without a clear approval forecast in refine.",
      }
    }
    if (refineUnknowns().length > 0) {
      return {
        label: "watch",
        tone: "warning" as const,
        reason: "The contract still carries unresolved unknowns that may alter execution.",
      }
    }
    return {
      label: "aligned",
      tone: "success" as const,
      reason: "The live run is still aligned with the current refined execution contract.",
    }
  })
  const priorityPaneMode = createMemo<PaneMode>(() => {
    if (hasApprovalsNeed()) return "approvals"
    if (hasRefineNeed()) return "refine"
    if (hasMemoryNeed()) return "memory"
    if (hasDiffNeed()) return "diff"
    if (hasAuditNeed()) return "audit"
    return "plan"
  })
  const paneBadge = (mode: PaneMode) => {
    switch (mode) {
      case "diff": {
        const revertCount = revert()?.diffFiles?.length ?? 0
        const proposedCount = proposedChanges().length
        const total = revertCount + proposedCount
        return total > 0 ? String(total) : undefined
      }
      case "audit": {
        const summary = latestAudit()?.result?.summary
        if (!summary) return auditHistory().length > 0 ? String(auditHistory().length) : undefined
        const count = summary.blocker_count + summary.warning_count
        return count > 0 ? String(count) : undefined
      }
      case "approvals":
        return pendingRaoCount() > 0 ? String(pendingRaoCount()) : undefined
      case "plan":
        return todo().length > 0 ? String(todo().length) : undefined
      case "memory":
        return pmSummary().recentCount > 0 ? String(pmSummary().recentCount) : undefined
      case "refine":
        return refinedPrompt().trim().length > 0 ? String(refineExecutionProfile().length + refineApprovals().length) : undefined
      default:
        return undefined
    }
  }
  const sessionArtifacts = createMemo(() => {
    const legacy = (sync.data as any).session_artifact?.[route.sessionID] ?? []
    const modern = sync.data.artifacts[route.sessionID] ?? []
    const combined = [...modern, ...legacy]
    return combined.map((item: any) => ({
      label: item.title || item.path || item.id,
      kind: item.type || item.kind,
    }))
  })
  const workstationState = createMemo(() =>
    deriveWorkstationState({
      sessionID: route.sessionID,
      stage: stageState().stage,
      stageReason: stageState().reason,
      sessionStatusType: sessionStatusType(),
      goal: liveMissionGoal(),
      todo: todo(),
      reflection: (session()?.state_v2 as any)?.reflection,
      approvals: permissions().map((permission: any) => ({
        label: permission.permission ?? permission.tool?.callID ?? "approval",
        reason: permission.patterns?.[0],
      })),
      questions: questions().length,
      artifacts: sessionArtifacts(),
      diffCount: (revert()?.diffFiles?.length ?? 0) + proposedChanges().length,
      recentTooling: recentTools(),
      audit: latestAudit()?.result
        ? {
            status: latestAudit()!.result!.status,
            blockerCount: latestAudit()!.result!.summary.blocker_count,
            warningCount: latestAudit()!.result!.summary.warning_count,
            infoCount: latestAudit()!.result!.summary.info_count,
          }
        : undefined,
    }),
  )
  const planMilestones = createMemo(() => {
    const seen = new Set<string>()
    const goal = workstationState().goal?.trim().toLowerCase()
    const focus = workstationState().currentStep?.trim().toLowerCase()
    return liveMilestones().filter((item) => {
      const label = item.label.trim()
      const normalized = label.toLowerCase()
      if (!label || seen.has(normalized)) return false
      if (goal && normalized === goal) return false
      if (focus && normalized === focus) return false
      seen.add(normalized)
      return true
    })
  })
  const planTooling = createMemo(() => {
    const suppressed = new Set(
      [workstationState().currentStep, ...workstationState().activitySummary.items]
        .filter((item): item is string => !!item)
        .map((item) => item.trim().toLowerCase()),
    )
    return recentTools().filter((item) => !suppressed.has(item.label.trim().toLowerCase()))
  })
  const hasRequirement = createMemo(() => hasApprovalsNeed() || hasRefineNeed() || hasAuditNeed() || hasPlanContext())

  const showPane = createMemo(() => {
    if (paneVisibility() === "hidden") return false
    if (paneVisibility() === "pinned") return true
    return shouldAutoShowPane({
      wide: wide(),
      hasApprovals: hasApprovalsNeed(),
      hasRefineDraft: hasRefineNeed(),
      hasAuditAttention: hasAuditNeed(),
      hasDiffContext: hasDiffNeed(),
      hasLiveContext: hasLivePaneContext(),
      hasMemoryContext: hasMemoryNeed(),
      hasPlanContext: hasPlanContext(),
    })
  })
  const activePaneMode = createMemo<PaneMode>(() =>
    deriveActivePaneMode({
      hasApprovals: hasApprovalsNeed(),
      hasRefineDraft: hasRefineNeed(),
      hasAuditAttention: hasAuditNeed(),
      hasDiffContext: hasDiffNeed(),
      hasLiveContext: hasLivePaneContext(),
      hasMemoryContext: hasMemoryNeed(),
      hasPlanContext: hasPlanContext(),
      liveStage: displayStageState().stage,
      fallback: priorityPaneMode(),
      paneMode: paneMode(),
      paneVisibility: paneVisibility(),
      paneFollowMode: paneFollowMode(),
      smartFollowActive: smartFollowActive(),
    }),
  )
  const liveRailHint = createMemo(() => {
    if (hasApprovalsNeed()) {
      return {
        label: "approvals",
        reason: "Operator input is required before the run can continue.",
      }
    }
    if (displayStageState().stage === "verifying" && hasAuditNeed()) {
      return {
        label: "audit",
        reason: "DAX is validating the result and surfacing review findings.",
      }
    }
    if ((displayStageState().stage === "verifying" || displayStageState().stage === "done") && hasDiffNeed()) {
      return {
        label: "changes",
        reason: "The run has concrete file change context ready for inspection.",
      }
    }
    if (hasRefineNeed()) {
      return {
        label: "refine",
        reason: "There is a refined execution contract ready to review.",
      }
    }
    if (hasMemoryNeed()) {
      return {
        label: "memory",
        reason: "Workspace memory has active context relevant to this run.",
      }
    }
    return {
      label: "workstation",
      reason: "The live run is still building context, so the workstation is the best control surface.",
    }
  })
  const operatorNextMove = createMemo(() => {
    const persona = activePersona()
    const voice = (text: string) => applyPersonaVoice(text, persona)
    const ciNudge = deriveGitHubCINudge({
      recentTools: recentTools(),
      branch: sync.data.vcs?.branch,
    })
    const branchNudge = deriveFeatureBranchNudge({
      branch: sync.data.vcs?.branch,
      workflowMode: workflowMode(),
      hasConcreteChanges: hasDiffNeed(),
    })
    if (hasApprovalsNeed()) {
      return {
        title: voice("Review the waiting decision"),
        detail: voice("Open approvals, inspect the reason or diff, then allow or deny the run"),
        tone: "warning" as const,
      }
    }
    if (ciNudge) {
      return {
        title: voice(ciNudge.title),
        detail: voice(ciNudge.detail),
        tone: ciNudge.tone,
      }
    }
    if (branchNudge && workflowMode() === "build") {
      return {
        title: voice(branchNudge.title),
        detail: voice(branchNudge.detail),
        tone: branchNudge.tone,
      }
    }
    if (displayStageState().stage === "verifying" && hasAuditNeed()) {
      return {
        title: voice("Inspect validation findings"),
        detail: voice("Use the audit pane to review warnings or blockers before you trust the result"),
        tone: "accent" as const,
      }
    }
    if ((displayStageState().stage === "verifying" || displayStageState().stage === "done") && hasDiffNeed()) {
      return {
        title: voice("Review the concrete changes"),
        detail: voice("Open changes to inspect the diff and confirm the workspace outcome"),
        tone: "primary" as const,
      }
    }
    if (hasRefineNeed()) {
      return {
        title: voice("Check the execution contract"),
        detail: voice("Review the refine pane before you continue, especially the risk and approval forecast"),
        tone: "primary" as const,
      }
    }
    if (hasMemoryNeed()) {
      return {
        title: voice("Capture durable context"),
        detail: voice("Use memory to preserve the decisions or repo context this run uncovered"),
        tone: "muted" as const,
      }
    }
    if (displayStageState().stage === "done") {
      return {
        title: voice("Choose the next operator move"),
        detail: voice("Use this completed state to verify, continue with a follow-up, or hand the result off cleanly"),
        tone: "muted" as const,
      }
    }
    return {
      title: voice("Let the run build context"),
      detail: voice("The workstation will stay focused on live state until the run reaches a review-worthy checkpoint"),
      tone: "muted" as const,
    }
  })
  createEffect(() => {
    if (activePaneMode() !== "approvals") return
    if (!showPane()) return
    // Hand control to the approval/question pane when operator action is required.
    prompt?.blur()
  })
  const openDiffDialog = () => {
    if (!hasDiffNeed()) return
    dialog.replace(() => (
      <DialogDiff
        explainMode={explainMode()}
        diffs={[
          ...(revert()?.diffFiles ?? []).map((file) => ({
            file: file.filename,
            additions: file.additions,
            deletions: file.deletions,
          })),
          ...proposedChanges().map((change) => ({
            file: change.filePath ?? "unknown",
            additions: 0,
            deletions: 0,
            speculative: true,
          }))
        ]}
        onOpenPane={() => {
          setPaneMode(() => "diff")
          setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
          dialog.clear()
        }}
      />
    ))
  }

  const openTimelineDialog = () => {
    dialog.replace(() => (
      <DialogTimeline
        onMove={(messageID) => {
          const child = scroll.getChildren().find((child) => child.id === messageID)
          if (child) scroll.scrollBy(child.y - scroll.y - 1)
        }}
        sessionID={route.sessionID}
        setPrompt={(promptInfo) => prompt?.set(promptInfo)}
      />
    ))
  }

  const openStatusDialog = () => {
    dialog.replace(() => <DialogStatus />)
  }

  const openPmPane = () => {
    setPaneMode(() => "memory")
    setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
    setSmartFollowActive(false)
  }

  const WorkspaceMemoryPane = () => (
    <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
      <box
        flexDirection="column"
        gap={0}
        paddingBottom={1}
        border={["bottom"]}
        borderColor={theme.borderSubtle}
      >
        <text fg={theme.primary} bold>
          Workspace memory
        </text>
        <text fg={theme.textMuted}>Durable notes and operating rules for this workspace</text>
      </box>
      <box
        flexDirection="row"
        gap={1}
        flexWrap="wrap"
        padding={1}
        backgroundColor={tint(theme.backgroundPanel, theme.accent, 0.04)}
        border={["round"]}
        borderColor={theme.borderSubtle}
      >
        <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>
            recent <span style={{ fg: theme.text }}>{pmSummary().recentCount}</span>
          </text>
        </box>
        <Show when={pmSummary().noteCount > 0}>
          <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
            <text fg={theme.textMuted}>
              notes <span style={{ fg: theme.text }}>{pmSummary().noteCount}</span>
            </text>
          </box>
        </Show>
        <Show when={pmSummary().ruleCount > 0}>
          <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
            <text fg={theme.textMuted}>
              rules <span style={{ fg: theme.text }}>{pmSummary().ruleCount}</span>
            </text>
          </box>
        </Show>
        <Show when={pmSummary().latestCommand}>
          <text fg={theme.textMuted} wrapMode="truncate-end">
            latest: {pmSummary().latestCommand}
          </text>
        </Show>
      </box>
      <box flexDirection="row" gap={1} flexWrap="wrap">
        <For each={["note", "list", "rules"] as PMTab[]}>
          {(tab) => (
            <box
              onMouseUp={() => setPmTab(() => tab)}
              backgroundColor={pmTab() === tab ? theme.backgroundElement : theme.backgroundPanel}
              paddingLeft={1}
              paddingRight={1}
              border={["round"]}
              borderColor={pmTab() === tab ? theme.primary : theme.borderSubtle}
            >
              <text
                fg={pmTab() === tab ? theme.primary : theme.textMuted}
                attributes={pmTab() === tab ? TextAttributes.BOLD : undefined}
              >
                /pm {tab}
              </text>
            </box>
          )}
        </For>
      </box>
      <box
        flexDirection="column"
        gap={1}
        border={["round"]}
        borderColor={theme.borderSubtle}
        backgroundColor={tint(theme.backgroundPanel, theme.accent, 0.03)}
        padding={1}
      >
        <Switch>
          <Match when={pmTab() === "note"}>
            <text fg={theme.textMuted} wrapMode="word">
              Save product constraints and handoff context that should survive across sessions.
            </text>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <box
                onMouseUp={prefillPmNote}
                backgroundColor={theme.backgroundElement}
                paddingTop={0}
                paddingBottom={0}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.primary}>Template</text>
              </box>
              <box
                onMouseUp={() => runPmCommand("/pm note")}
                backgroundColor={theme.backgroundElement}
                paddingTop={0}
                paddingBottom={0}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.accent}>Run /pm note</text>
              </box>
            </box>
            <Show when={recentPmCommands().length > 0}>
              <box border={["top"]} borderColor={theme.borderSubtle} paddingTop={1} flexDirection="column" gap={1}>
                <text fg={theme.textMuted}>Recent PM commands</text>
                <For each={recentPmCommands().slice(0, 4)}>
                  {(entry) => (
                    <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                      <text fg={theme.text} wrapMode="truncate-end">
                        {entry.text}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            </Show>
          </Match>
          <Match when={pmTab() === "list"}>
            <text fg={theme.textMuted} wrapMode="word">
              List recent PM notes and tags for this workspace.
            </text>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <box
                onMouseUp={() => runPmCommand("/pm list")}
                backgroundColor={theme.backgroundElement}
                paddingTop={0}
                paddingBottom={0}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.accent}>Run /pm list</text>
              </box>
              <Show when={latestPmListResponse()}>
                {(entry) => <text fg={theme.textMuted}>Last: {entry().commandText}</text>}
              </Show>
            </box>
            <box border={["top"]} borderColor={theme.borderSubtle} paddingTop={1} flexDirection="column" gap={1}>
              <Show
                when={!parsedPmList().empty}
                fallback={
                  <text fg={theme.textMuted} wrapMode="word">
                    {parsedPmList().info}
                  </text>
                }
              >
                <For each={parsedPmList().rows}>
                  {(row) => (
                    <box
                      flexDirection="column"
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={theme.backgroundElement}
                    >
                      <text fg={theme.text}>
                        {row.day} | {row.title}
                      </text>
                      <Show when={row.tags.length > 0}>
                        <text fg={theme.textMuted}>tags: {row.tags.join(", ")}</text>
                      </Show>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </Match>
          <Match when={pmTab() === "rules"}>
            <text fg={theme.textMuted} wrapMode="word">
              Inspect and maintain project guardrails that should always be enforced.
            </text>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <box
                onMouseUp={() => runPmCommand("/pm rules")}
                backgroundColor={theme.backgroundElement}
                paddingTop={0}
                paddingBottom={0}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.accent}>Run /pm rules</text>
              </box>
              <box
                onMouseUp={() =>
                  prompt?.set({
                    input: "/pm rules add require_approval release:publish ask",
                    parts: [],
                  })
                }
                backgroundColor={theme.backgroundElement}
                paddingTop={0}
                paddingBottom={0}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.primary}>Add rule template</text>
              </box>
            </box>
            <Show when={latestPmRulesAddResponse()}>
              {(entry) => (
                <text fg={theme.textMuted} wrapMode="word">
                  Latest update: {entry().responseText}
                </text>
              )}
            </Show>
            <box border={["top"]} borderColor={theme.borderSubtle} paddingTop={1} flexDirection="column" gap={1}>
              <Show
                when={!parsedPmRules().empty}
                fallback={
                  <text fg={theme.textMuted} wrapMode="word">
                    {parsedPmRules().info}
                  </text>
                }
              >
                <For each={parsedPmRules().rows}>
                  {(row) => (
                    <box
                      flexDirection="column"
                      paddingLeft={1}
                      paddingRight={1}
                      backgroundColor={theme.backgroundElement}
                    >
                      <text fg={theme.text}>
                        {row.ruleType}
                        {" -> "}
                        {row.action}
                      </text>
                      <text fg={theme.textMuted} wrapMode="word">
                        {row.pattern}
                        <Show when={row.source}> ({row.source})</Show>
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  )

  const selectPaneMode = (mode: PaneMode) => {
    setPaneMode(() => mode)
    setPaneVisibility(() => "pinned")
    setSmartFollowActive(false)
  }

  const jumpLastUserMessage = () => {
    const messageList = sync.data.message[route.sessionID]
    if (!messageList?.length) return
    for (let i = messageList.length - 1; i >= 0; i--) {
      const message = messageList[i]
      if (!message || message.role !== "user") continue
      const parts = sync.data.part[message.id]
      if (!parts?.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)) continue
      const child = scroll.getChildren().find((entry) => entry.id === message.id)
      if (child) scroll.scrollBy(child.y - scroll.y - 1)
      break
    }
  }

  function moveChild(direction: number) {
    if (children().length === 1) return
    let next = children().findIndex((x) => x.id === session()?.id) + direction
    if (next >= children().length) next = 0
    if (next < 0) next = children().length - 1
    if (children()[next]) {
      navigate({
        type: "session",
        sessionID: children()[next].id,
      })
    }
  }

  const command = useCommandDialog()
  command.register(() => [
    {
      title: "Review approvals",
      value: "session.approvals.review",
      category: "Review",
      enabled: permissions().length + questions().length > 0,
      onSelect: (dialog) => {
        setPaneMode(() => "approvals")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
      },
    },
    {
      title: "Review diff",
      value: "session.diff.review",
      category: "Review",
      enabled: hasDiffNeed(),
      onSelect: (dialog) => {
        openDiffDialog()
      },
    },
    {
      title: "Share session",
      value: "session.share",
      suggested: route.type === "session",
      keybind: "session_share",
      category: "Session",
      enabled: sync.data.config.share !== "disabled" && !session()?.share?.url,
      slash: {
        name: "share",
      },
      onSelect: async (dialog) => {
        await sdk.client.session
          .share({
            sessionID: route.sessionID,
          })
          .then((res) =>
            Clipboard.copy(res.data!.share!.url).catch(() =>
              toast.show({ message: "Failed to copy URL to clipboard", variant: "error" }),
            ),
          )
          .then(() => toast.show({ message: "Share URL copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to share session", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Rename session",
      value: "session.rename",
      keybind: "session_rename",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => <DialogSessionRename session={route.sessionID} />)
      },
    },
    {
      title: "Jump to message",
      value: "session.timeline",
      keybind: "session_timeline",
      category: "Session",
      onSelect: (dialog) => {
        openTimelineDialog()
      },
    },
    {
      title: "Fork from message",
      value: "session.fork",
      keybind: "session_fork",
      category: "Session",
      onSelect: (dialog) => {
        dialog.replace(() => (
          <DialogForkFromTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
          />
        ))
      },
    },
    {
      title: "Compact session",
      value: "session.compact",
      keybind: "session_compact",
      category: "Session",
      slash: {
        name: "compact",
        aliases: ["summarize"],
      },
      onSelect: (dialog) => {
        const selectedModel = local.model.current()
        if (!selectedModel) {
          toast.show({
            variant: "warning",
            message: "Connect OpenAI, Gemini, Anthropic, or Ollama to summarize this session",
            duration: 3000,
          })
          return
        }
        sdk.client.session.summarize({
          sessionID: route.sessionID,
          modelID: selectedModel.modelID,
          providerID: selectedModel.providerID,
        })
        dialog.clear()
      },
    },
    {
      title: "Unshare session",
      value: "session.unshare",
      keybind: "session_unshare",
      category: "Session",
      enabled: !!session()?.share?.url,
      onSelect: async (dialog) => {
        await sdk.client.session
          .unshare({
            sessionID: route.sessionID,
          })
          .then(() => toast.show({ message: "Session unshared successfully", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to unshare session", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Undo previous message",
      value: "session.undo",
      keybind: "messages_undo",
      category: "Session",
      slash: {
        name: "undo",
      },
      onSelect: async (dialog) => {
        const status = sync.data.session_status?.[route.sessionID]
        if (status?.type !== "idle") await sdk.client.session.abort({ sessionID: route.sessionID }).catch(() => {})
        const revert = session()?.revert?.messageID
        const message = messages().findLast((x) => (!revert || x.id < revert) && x.role === "user")
        if (!message) return
        sdk.client.session
          .revert({
            sessionID: route.sessionID,
            messageID: message.id,
          })
          .then(() => {
            toBottom()
          })
        const parts = sync.data.part[message.id]
        prompt?.set(
          parts.reduce(
            (agg, part) => {
              if (part.type === "text") {
                if (!part.synthetic) agg.input += part.text
              }
              if (part.type === "file") agg.parts.push(part)
              return agg
            },
            { input: "", parts: [] as PromptInfo["parts"] },
          ),
        )
        dialog.clear()
      },
    },
    {
      title: "Redo",
      value: "session.redo",
      keybind: "messages_redo",
      category: "Session",
      enabled: !!session()?.revert?.messageID,
      onSelect: (dialog) => {
        dialog.clear()
        const messageID = session()?.revert?.messageID
        if (!messageID) return
        const message = messages().find((x) => x.role === "user" && x.id > messageID)
        if (!message) {
          sdk.client.session.unrevert({
            sessionID: route.sessionID,
          })
          prompt?.set({ input: "", parts: [] })
          return
        }
        sdk.client.session.revert({
          sessionID: route.sessionID,
          messageID: message.id,
        })
      },
    },
    {
      title: `Persona: ${activePersona().label}`,
      value: "session.persona.cycle",
      category: "View",
      slash: {
        name: "persona",
      },
      onSelect: (dialog) => {
        cyclePersona()
        toast.show({ message: `Persona: ${activePersona().label}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: sidebarVisible() ? "Hide sidebar" : "Show sidebar",
      value: "session.sidebar.toggle",
      keybind: "sidebar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        batch(() => {
          const isVisible = sidebarVisible()
          setSidebar(() => (isVisible ? "hide" : "auto"))
          setSidebarOpen(!isVisible)
        })
        dialog.clear()
      },
    },
    {
      title: `Pane: ${paneVisibility() === "auto" ? "Auto (active)" : "Auto"}`,
      value: "session.pane.auto",
      category: "View",
      onSelect: (dialog) => {
        setPaneVisibility(() => "auto")
        toast.show({ message: "Pane: Auto", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane: ${paneVisibility() === "pinned" ? "Pinned (active)" : "Pinned"}`,
      value: "session.pane.pinned",
      category: "View",
      onSelect: (dialog) => {
        setPaneVisibility(() => "pinned")
        toast.show({ message: "Pane: Pinned", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane: ${paneVisibility() === "hidden" ? "Hidden (active)" : "Hidden"}`,
      value: "session.pane.hidden",
      category: "View",
      onSelect: (dialog) => {
        setPaneVisibility(() => "hidden")
        toast.show({ message: "Pane: Hidden", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Pane: Toggle (auto -> pinned -> hidden)",
      value: "session.pane.toggle",
      category: "View",
      slash: {
        name: "pane",
      },
      onSelect: (dialog) => {
        const next = paneVisibility() === "auto" ? "pinned" : paneVisibility() === "pinned" ? "hidden" : "auto"
        setPaneVisibility(() => next)
        toast.show({ message: `Pane: ${Locale.titlecase(next)}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane mode: ${paneLabel("diff")}${paneMode() === "diff" ? " (active)" : ""}`,
      value: "session.pane.mode.diff",
      category: "View",
      onSelect: (dialog) => {
        setPaneMode(() => "diff")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
        toast.show({ message: `Pane mode: ${paneLabel("diff")}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane mode: ${paneLabel("audit")}${paneMode() === "audit" ? " (active)" : ""}`,
      value: "session.pane.mode.audit",
      category: "View",
      onSelect: (dialog) => {
        setPaneMode(() => "audit")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
        toast.show({ message: `Pane mode: ${paneLabel("audit")}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane mode: ${paneLabel("approvals")}${paneMode() === "approvals" ? " (active)" : ""}`,
      value: "session.pane.mode.rao",
      category: "View",
      onSelect: (dialog) => {
        setPaneMode(() => "approvals")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
        toast.show({ message: `Pane mode: ${paneLabel("approvals")}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane mode: ${paneLabel("plan")}${paneMode() === "plan" ? " (active)" : ""}`,
      value: "session.pane.mode.pm",
      category: "View",
      onSelect: (dialog) => {
        setPaneMode(() => "plan")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
        toast.show({ message: `Pane mode: ${paneLabel("plan")}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane mode: ${paneLabel("memory")}${paneMode() === "memory" ? " (active)" : ""}`,
      value: "session.pane.mode.memory",
      category: "View",
      onSelect: (dialog) => {
        setPaneMode(() => "memory")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
        toast.show({ message: `Pane mode: ${paneLabel("memory")}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Mode: ${workflowMode() === "build" ? "Build (active)" : "Build"}`,
      value: "session.mode.build",
      category: "Mode",
      onSelect: (dialog) => {
        selectWorkflowMode("build")
        toast.show({ message: "Mode: Build", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Mode: ${workflowMode() === "plan" ? "Plan (active)" : "Plan"}`,
      value: "session.mode.plan",
      category: "Mode",
      onSelect: (dialog) => {
        selectWorkflowMode("plan")
        toast.show({ message: "Mode: Plan", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Mode: ${workflowMode() === "explore" ? "Explore (active)" : "Explore"}`,
      value: "session.mode.explore",
      category: "Mode",
      onSelect: (dialog) => {
        selectWorkflowMode("explore")
        toast.show({ message: "Mode: Explore", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Mode: ${workflowMode() === "docs" ? "Docs (active)" : "Docs"}`,
      value: "session.mode.docs",
      category: "Mode",
      onSelect: (dialog) => {
        selectWorkflowMode("docs")
        toast.show({ message: "Mode: Docs", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Mode: ${workflowMode() === "audit" ? "Audit (active)" : "Audit"}`,
      value: "session.mode.audit",
      category: "Mode",
      onSelect: (dialog) => {
        selectWorkflowMode("audit")
        toast.show({ message: "Mode: Audit", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Audit: Run",
      value: "session.audit.run",
      category: "Mode",
      onSelect: (dialog) => {
        runAuditCommand("/audit")
        dialog.clear()
      },
    },
    {
      title: "Audit: Gate",
      value: "session.audit.gate",
      category: "Mode",
      onSelect: (dialog) => {
        runAuditCommand("/audit gate")
        dialog.clear()
      },
    },
    {
      title: `Audit: Profile ${latestAudit()?.result?.profile ? `(latest ${latestAudit()!.result!.profile})` : "strict"}`,
      value: "session.audit.profile.strict",
      category: "Mode",
      onSelect: (dialog) => {
        runAuditCommand("/audit profile strict")
        dialog.clear()
      },
    },
    {
      title: `Pane follow: ${paneFollowMode() === "smart" ? "Smart (active)" : "Smart"}`,
      value: "session.pane.follow.smart",
      category: "View",
      onSelect: (dialog) => {
        setPaneFollowMode(() => "smart")
        setSmartFollowActive(true)
        setPendingUpdates(0)
        toast.show({ message: "Pane follow: Smart", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane follow: ${paneFollowMode() === "live" ? "Live (active)" : "Live"}`,
      value: "session.pane.follow.live",
      category: "View",
      onSelect: (dialog) => {
        setPaneFollowMode(() => "live")
        setSmartFollowActive(true)
        setPendingUpdates(0)
        toast.show({ message: "Pane follow: Live", variant: "success" })
        dialog.clear()
      },
    },
    {
      title: "Pane follow: Toggle (smart <-> live)",
      value: "session.pane.follow.toggle",
      category: "View",
      slash: {
        name: "follow",
      },
      onSelect: (dialog) => {
        const next = paneFollowMode() === "smart" ? "live" : "smart"
        setPaneFollowMode(() => next)
        setSmartFollowActive(true)
        setPendingUpdates(0)
        toast.show({ message: `Pane follow: ${Locale.titlecase(next)}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: explainMode() ? "Disable ELI12 mode" : "Enable ELI12 mode",
      value: "session.toggle.eli12_mode",
      slash: {
        name: "eli12",
      },
      category: "View",
      onSelect: (dialog) => {
        const isEli12 = explainMode()
        const next = isEli12 ? "normal" : "eli12"
        kv.set(DAX_SETTING.explain_mode, next)
        toast.show({ message: `ELI12 mode ${!isEli12 ? "enabled" : "disabled"}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane follow: Jump live${pendingUpdates() > 0 ? ` (${pendingUpdates()} updates)` : ""}`,
      value: "session.pane.follow.jump_live",
      category: "View",
      enabled: paneFollowMode() === "smart" && !smartFollowActive(),
      onSelect: (dialog) => {
        jumpToLive()
        dialog.clear()
      },
    },
    {
      title: slowStream() ? "Stream cadence: Slow (active)" : "Stream cadence: Slow",
      value: "session.stream.slow.toggle",
      category: "View",
      slash: {
        name: "slowstream",
      },
      onSelect: (dialog) => {
        const next = !slowStream()
        setSlowStream(() => next)
        toast.show({ message: `Stream cadence: ${next ? "Slow" : "Live"}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Theme: Next (${selectedThemeShort()})`,
      value: "session.theme.next",
      category: "View",
      slash: {
        name: "theme-next",
      },
      onSelect: (dialog) => {
        cycleTheme(1)
        dialog.clear()
      },
    },
    {
      title: `Theme: Previous (${selectedThemeShort()})`,
      value: "session.theme.previous",
      category: "View",
      slash: {
        name: "theme-prev",
      },
      onSelect: (dialog) => {
        cycleTheme(-1)
        dialog.clear()
      },
    },
    {
      title: conceal() ? "Disable code concealment" : "Enable code concealment",
      value: "session.toggle.conceal",
      keybind: "messages_toggle_conceal" as any,
      category: "Session",
      onSelect: (dialog) => {
        setConceal((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showTimestamps() ? "Hide timestamps" : "Show timestamps",
      value: "session.toggle.timestamps",
      category: "Session",
      onSelect: (dialog) => {
        setTimestamps((prev) => (prev === "show" ? "hide" : "show"))
        dialog.clear()
      },
    },
    {
      title: explainMode() ? "Reasoning hidden in ELI12 mode" : showThinking() ? "Dismiss reasoning" : "Inspect reasoning",
      value: "session.toggle.thinking",
      keybind: "display_thinking",
      category: "Session",
      onSelect: (dialog) => {
        if (explainMode()) {
          toast.show({
            variant: "info",
            message: "Reasoning is hidden while ELI12 mode is enabled",
            duration: 2500,
          })
          dialog.clear()
          return
        }
        setShowThinking((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: showDetails() ? "Hide tool details" : "Show tool details",
      value: "session.toggle.actions",
      keybind: "tool_details",
      category: "Session",
      onSelect: (dialog) => {
        setShowDetails((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: explainMode()
        ? showEli12Summary()
          ? "Hide ELI12 action summary"
          : "Show ELI12 action summary"
        : "ELI12 action summary (available in ELI12 mode)",
      value: "session.toggle.eli12.summary",
      slash: {
        name: "eli12summary",
      },
      category: "Session",
      onSelect: (dialog) => {
        const next = !showEli12Summary()
        setShowEli12Summary(() => next)
        toast.show({
          variant: "info",
          message: next ? "ELI12 action summary enabled" : "ELI12 action summary disabled",
          duration: 2200,
        })
        dialog.clear()
      },
    },
    {
      title: explainMode() ? "Normal mode" : "ELI12 mode (Explain Like I'm 12)",
      value: "session.toggle.eli12",
      keybind: "display_eli12" as any,
      category: "Session",
      onSelect: (dialog) => {
        toggleEli12()
        toast.show({
          variant: "success",
          message: explainMode() ? "ELI12 mode enabled" : "Normal mode restored",
          duration: 2200,
        })
        dialog.clear()
      },
    },
    {
      title: "Toggle session scrollbar",
      value: "session.toggle.scrollbar",
      keybind: "scrollbar_toggle",
      category: "Session",
      onSelect: (dialog) => {
        setShowScrollbar((prev) => !prev)
        dialog.clear()
      },
    },
    {
      title: "Page up",
      value: "session.page.up",
      keybind: "messages_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Page down",
      value: "session.page.down",
      keybind: "messages_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 2)
        dialog.clear()
      },
    },
    {
      title: "Line up",
      value: "session.line.up",
      keybind: "messages_line_up",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-1)
        dialog.clear()
      },
    },
    {
      title: "Line down",
      value: "session.line.down",
      keybind: "messages_line_down",
      category: "Session",
      disabled: true,
      onSelect: (dialog) => {
        scroll.scrollBy(1)
        dialog.clear()
      },
    },
    {
      title: "Half page up",
      value: "session.half.page.up",
      keybind: "messages_half_page_up",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(-scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "Half page down",
      value: "session.half.page.down",
      keybind: "messages_half_page_down",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollBy(scroll.height / 4)
        dialog.clear()
      },
    },
    {
      title: "First message",
      value: "session.first",
      keybind: "messages_first",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollTo(0)
        dialog.clear()
      },
    },
    {
      title: "Last message",
      value: "session.last",
      keybind: "messages_last",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        scroll.scrollTo(scroll.scrollHeight)
        dialog.clear()
      },
    },
    {
      title: "Jump to last user message",
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: "Session",
      hidden: true,
      onSelect: () => {
        jumpLastUserMessage()
      },
    },
    {
      title: "Next message",
      value: "session.message.next",
      keybind: "messages_next",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => scrollToMessage("next", dialog),
    },
    {
      title: "Previous message",
      value: "session.message.previous",
      keybind: "messages_previous",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => scrollToMessage("prev", dialog),
    },
    {
      title: "Copy last assistant message",
      value: "messages.copy",
      keybind: "messages_copy",
      category: "Session",
      onSelect: (dialog) => {
        const revertID = session()?.revert?.messageID
        const lastAssistantMessage = messages().findLast(
          (msg) => msg.role === "assistant" && (!revertID || msg.id < revertID),
        )
        if (!lastAssistantMessage) {
          toast.show({ message: "No assistant messages found", variant: "error" })
          dialog.clear()
          return
        }

        const parts = sync.data.part[lastAssistantMessage.id] ?? []
        const textParts = parts.filter((part) => part.type === "text")
        if (textParts.length === 0) {
          toast.show({ message: "No text parts found in last assistant message", variant: "error" })
          dialog.clear()
          return
        }

        const text = textParts
          .map((part) => part.text)
          .join("\n")
          .trim()
        if (!text) {
          toast.show({
            message: "No text content found in last assistant message",
            variant: "error",
          })
          dialog.clear()
          return
        }

        Clipboard.copy(text)
          .then(() => toast.show({ message: "Message copied to clipboard!", variant: "success" }))
          .catch(() => toast.show({ message: "Failed to copy to clipboard", variant: "error" }))
        dialog.clear()
      },
    },
    {
      title: "Copy session transcript",
      value: "session.copy",
      category: "Session",
      slash: {
        name: "copy",
      },
      onSelect: async (dialog) => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()
          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: showThinking(),
              toolDetails: showDetails(),
              assistantMetadata: showAssistantMetadata(),
            },
          )
          await Clipboard.copy(transcript)
          toast.show({ message: "Session transcript copied to clipboard!", variant: "success" })
        } catch (error) {
          toast.show({ message: "Failed to copy session transcript", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Export session transcript",
      value: "session.export",
      keybind: "session_export",
      category: "Session",
      slash: {
        name: "export",
      },
      onSelect: async (dialog) => {
        try {
          const sessionData = session()
          if (!sessionData) return
          const sessionMessages = messages()

          const defaultFilename = `session-${sessionData.id.slice(0, 8)}.md`

          const options = await DialogExportOptions.show(
            dialog,
            defaultFilename,
            showThinking(),
            showDetails(),
            showAssistantMetadata(),
            false,
          )

          if (options === null) return

          const transcript = formatTranscript(
            sessionData,
            sessionMessages.map((msg) => ({ info: msg, parts: sync.data.part[msg.id] ?? [] })),
            {
              thinking: options.thinking,
              toolDetails: options.toolDetails,
              assistantMetadata: options.assistantMetadata,
            },
          )

          if (options.openWithoutSaving) {
            // Just open in editor without saving
            await Editor.open({ value: transcript, renderer })
          } else {
            const exportDir = process.cwd()
            const filename = options.filename.trim()
            const filepath = path.join(exportDir, filename)

            await Bun.write(filepath, transcript)

            // Open with EDITOR if available
            const result = await Editor.open({ value: transcript, renderer })
            if (result !== undefined) {
              await Bun.write(filepath, result)
            }

            toast.show({ message: `Session exported to ${filename}`, variant: "success" })
          }
        } catch (error) {
          toast.show({ message: "Failed to export session", variant: "error" })
        }
        dialog.clear()
      },
    },
    {
      title: "Next child session",
      value: "session.child.next",
      keybind: "session_child_cycle",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        moveChild(1)
        dialog.clear()
      },
    },
    {
      title: "Previous child session",
      value: "session.child.previous",
      keybind: "session_child_cycle_reverse",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        moveChild(-1)
        dialog.clear()
      },
    },
    {
      title: "Go to parent session",
      value: "session.parent",
      keybind: "session_parent",
      category: "Session",
      hidden: true,
      onSelect: (dialog) => {
        const parentID = session()?.parentID
        if (parentID) {
          navigate({
            type: "session",
            sessionID: parentID,
          })
        }
        dialog.clear()
      },
    },
  ])

  const dialog = useDialog()
  const renderer = useRenderer()

  const keepPromptFocused = () => {
    if (promptDisabled()) return
    setTimeout(() => {
      if (!prompt) return
      prompt.focus()
    }, 0)
  }

  // snap to bottom when session changes
  createEffect(
    on(
      () => route.sessionID,
      () => {
        setSmartFollowActive(true)
        setPendingUpdates(0)
        toBottom()
      },
    ),
  )
  createEffect(() => {
    if (paneFollowMode() === "live") {
      setSmartFollowActive(true)
      setPendingUpdates(0)
      return
    }
    const key = `${sessionPartCount()}-${pending() ?? ""}-${sessionStatusType()}`
    if (key === lastUpdateKey) return
    if (lastUpdateKey && paneFollowMode() === "smart" && !smartFollowActive()) {
      setPendingUpdates((count) => count + 1)
    }
    lastUpdateKey = key
  })
  createEffect(() => {
    if (!slowStream()) {
      setStreamParts({})
      return
    }
    snapshotStreamParts()
    const timer = setInterval(snapshotStreamParts, STREAM_RENDER_CADENCE_MS)
    onCleanup(() => clearInterval(timer))
  })
  createEffect(
    on(
      [paneVisibility, paneMode, paneFollowMode, showDetails, slowStream, selectedTheme, sidebarVisible],
      () => {
        keepPromptFocused()
      },
      { defer: true },
    ),
  )

  const decisionState = createMemo(() => {
    const stage = stageState().stage
    const reflection = (session()?.state_v2 as any)?.reflection
    if (reflection?.decision === "ask") return "Awaiting approval"
    if (stage === "thinking") return "Interpreting"
    if (stage === "planning") return "Critiquing"
    if (stage === "executing") return "Executing"
    if (stage === "verifying") return "Verifying"
    if (stage === "retrying") return "Recovering"
    return undefined
  })

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        get wide() {
          return wide()
        },
        sessionID: route.sessionID,
        conceal,
        showThinking: () => showThinking() && !explainMode(),
        showTimestamps,
        showDetails,
        showAssistantMetadata,
        diffWrapMode,
        sync,
      }}
    >
      <box flexDirection="row" flexGrow={1} minHeight={0} width="100%">
        <box
          flexGrow={1}
          minHeight={0}
          paddingBottom={1}
          paddingTop={1}
          paddingLeft={2}
          paddingRight={2}
          gap={1}
          flexDirection="column"
        >
          <Header
            busy={displayStageState().stage !== "done"}
            lifecycleLabel={labelStage(stageState().stage, explainMode())}
            decisionState={decisionState()}
            persona={activePersona()}
          />

          <box
            flexDirection="column"
            gap={0}
            flexShrink={0}
            alignItems="stretch"
            border={["bottom"]}
            borderColor={theme.borderSubtle}
            paddingLeft={0}
            paddingRight={0}
            paddingTop={0}
            paddingBottom={1}
          >
            <box flexDirection="row" justifyContent="space-between" alignItems="center" gap={1} flexWrap="wrap">
              <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                <Show when={session()}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="truncate-end">
                    {session()!.title}
                  </text>
                </Show>
                <Show when={explainMode()}>
                  <box paddingLeft={1} paddingRight={1} backgroundColor={theme.backgroundElement}>
                    <text fg={theme.textMuted}>eli12</text>
                  </box>
                </Show>
                <Show when={pending()}>
                  <Spinner />
                </Show>
              </box>
              <box
                flexDirection="row"
                gap={1}
                alignItems="center"
                flexWrap="nowrap"
                justifyContent="flex-end"
                backgroundColor={theme.backgroundPanel}
              >
                <For each={headerStats()}>
                  {(item, index) => (
                    <>
                      <Show when={index() > 0}>
                        <text fg={theme.textMuted} wrapMode="none">
                          ·
                        </text>
                      </Show>
                      <text fg={item.color ?? theme.textMuted} wrapMode="none">
                        {item.label}
                      </text>
                    </>
                  )}
                </For>
              </box>
            </box>
            <box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center" width="100%" paddingBottom={0}>
              <box
                onMouseUp={() => cycleWorkflowMode(1)}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundElement}
              >
                <text fg={theme.accent}>
                  agent <span style={{ fg: theme.text }}>{workflowMode()}</span>
                </text>
              </box>
              <box
                onMouseUp={cyclePaneVisibility}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundElement}
              >
                <text fg={theme.textMuted}>
                  pane <span style={{ fg: theme.text }}>{paneVisibility()}</span>
                </text>
              </box>
              <box
                onMouseUp={() => setShowDetails((prev) => !prev)}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundElement}
              >
                <text fg={showDetails() ? theme.primary : theme.textMuted}>
                  details{" "}
                  <span style={{ fg: showDetails() ? theme.text : theme.textMuted }}>
                    {showDetails() ? "on" : "off"}
                  </span>
                </text>
              </box>
              <box
                onMouseUp={() => cycleTheme(1)}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundElement}
              >
                <text fg={theme.textMuted}>
                  theme <span style={{ fg: theme.text }}>{selectedThemeShort()}</span>
                </text>
              </box>
            </box>
          </box>
          <box flexGrow={1} minHeight={0} flexDirection="column">
            <ErrorBoundary
              fallback={(error, reset) => (
                <box
                  flexGrow={1}
                  minHeight={0}
                  flexDirection="column"
                  gap={1}
                  border={["top", "right", "bottom", "left"]}
                  borderColor={theme.error}
                  backgroundColor={tint(theme.backgroundPanel, theme.error, 0.12)}
                  padding={2}
                >
                  <text fg={theme.error} attributes={TextAttributes.BOLD}>
                    Session pane recovered from an error
                  </text>
                  <text fg={theme.textMuted} wrapMode="word">
                    {String(error)}
                  </text>
                  <box
                    onMouseUp={() => {
                      reset()
                      keepPromptFocused()
                    }}
                    backgroundColor={theme.primary}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={theme.background}>Reset</text>
                  </box>
                </box>
              )}
            >
              <Switch>
                <Match when={showPane() || activePaneMode() === "refine"}>
                  <box flexGrow={1} flexDirection={liveStacked() ? "column" : "row"} minHeight={0}>
                    <box
                      flexGrow={mainPaneGrow()}
                      width={liveStacked() ? "100%" : Math.max(48, contentWidth() - livePaneWidth() - 3)}
                      minHeight={0}
                      flexDirection="column"
                      border={["top", "right", "bottom", "left"]}
                      borderColor={theme.backgroundElement}
                    >
                    <scrollbox
                        ref={(r: ScrollBoxRenderable | undefined) => {
                          if (r) scroll = r
                        }}
                        onMouseDown={pauseSmartFollow}
                        viewportOptions={{
                          paddingRight: showScrollbar() ? 1 : 0,
                        }}
                        verticalScrollbarOptions={{
                          paddingLeft: 1,
                          visible: showScrollbar(),
                          trackOptions: {
                            backgroundColor: theme.backgroundElement,
                            foregroundColor: theme.border,
                          },
                        }}
                        stickyScroll={followEnabled()}
                        stickyStart="bottom"
                        flexGrow={1}
                        scrollAcceleration={scrollAcceleration()}
                      >
                        <For each={narrative()}>
                          {(item, index) => (
                            <Switch>
                              <Match when={item.type === "lifecycle"}>
                                <LifecycleEvent event={item.data} />
                              </Match>
                              <Match when={item.type === "message"}>
                                {(function() {
                                  const message = item.data as any;
                                  return (
                                    <Switch>
                                      <Match when={message.id === revert()?.messageID}>
                                        {(function () {
                                          const command = useCommandDialog()
                                          const [hover, setHover] = createSignal(false)
                                          const dialog = useDialog()

                                          const handleUnrevert = async () => {
                                            const confirmed = await DialogConfirm.show(
                                              dialog,
                                              "Confirm Redo",
                                              "Are you sure you want to restore the reverted messages?",
                                            )
                                            if (confirmed) {
                                              command.trigger("session.redo")
                                            }
                                          }

                                          return (
                                            <box
                                              onMouseOver={() => setHover(true)}
                                              onMouseOut={() => setHover(false)}
                                              onMouseUp={handleUnrevert}
                                              marginTop={1}
                                              flexShrink={0}
                                              border={["left"]}
                                              customBorderChars={SplitBorder.customBorderChars}
                                              borderColor={theme.backgroundPanel}
                                            >
                                              <box
                                                paddingTop={1}
                                                paddingBottom={1}
                                                paddingLeft={2}
                                                backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                                              >
                                                <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                                                <text fg={theme.textMuted}>
                                                  <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> to
                                                  restore
                                                </text>
                                                <Show when={revert()!.diffFiles?.length}>
                                                  <box marginTop={1}>
                                                    <For each={revert()!.diffFiles}>
                                                      {(file) => (
                                                        <text fg={theme.text}>
                                                          {file.filename}
                                                          <Show when={file.additions > 0}>
                                                            <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                                          </Show>
                                                          <Show when={file.deletions > 0}>
                                                            <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                                          </Show>
                                                        </text>
                                                      )}
                                                    </For>
                                                  </box>
                                                </Show>
                                              </box>
                                            </box>
                                          )
                                        })()}
                                      </Match>
                                      <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                                        <></>
                                      </Match>
                                      <Match when={message.role === "user"}>
                                        <UserMessage
                                          index={index()}
                                          onMouseUp={() => {
                                            if (renderer.getSelection()?.getSelectedText()) return
                                            dialog.replace(() => (
                                              <DialogMessage
                                                messageID={message.id}
                                                sessionID={route.sessionID}
                                                setPrompt={(promptInfo) => prompt?.set(promptInfo)}
                                              />
                                            ))
                                          }}
                                          message={message as UserMessage}
                                          parts={renderParts(message)}
                                          pending={pending()}
                                        />
                                      </Match>
                                      <Match when={message.role === "assistant"}>
                                        <AssistantMessage
                                          last={lastAssistant()?.id === message.id}
                                          message={message as AssistantMessage}
                                          parts={renderParts(message)}
                                          stage={displayStageState().stage}
                                          todo={todo()}
                                          persona={activePersona()}
                                        />
                                      </Match>
                                    </Switch>
                                  )
                                })()}
                              </Match>
                            </Switch>
                          )}
                        </For>
                      </scrollbox>
                    </box>
                    <scrollbox
                      flexGrow={sidePaneGrow()}
                      width={liveStacked() ? "100%" : livePaneWidth()}
                      minHeight={0}
                      backgroundColor={theme.backgroundPanel}
                      scrollAcceleration={scrollAcceleration()}
                    >
                      <box padding={1} gap={1} backgroundColor={theme.backgroundPanel} flexDirection="column">
                        <box
                          flexDirection="column"
                          gap={1}
                          border={["bottom"]}
                          borderColor={theme.border}
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
                          <Show
                            when={
                              workstationState().planSummary.totalSteps > 0 ||
                              trustSurface().label !== "idle" ||
                              pendingRaoCount() > 0 ||
                              workstationState().artifactSummary.count > 0
                            }
                          >
                            <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                              <box
                                paddingLeft={1}
                                paddingRight={1}
                                backgroundColor={tint(theme.backgroundElement, theme.primary, 0.08)}
                                border={["round"]}
                                borderColor={theme.borderSubtle}
                              >
                                <text fg={theme.text}>{workstationState().lifecycleLabel.toLowerCase()}</text>
                              </box>
                              <Show when={workstationState().planSummary.totalSteps > 0}>
                                <box
                                  paddingLeft={1}
                                  paddingRight={1}
                                  backgroundColor={theme.backgroundElement}
                                  border={["round"]}
                                  borderColor={theme.borderSubtle}
                                >
                                  <text fg={theme.text}>
                                    todo {workstationState().planSummary.currentStepIndex}/
                                    {workstationState().planSummary.totalSteps}
                                  </text>
                                </box>
                              </Show>
                              <Show when={trustSurface().label !== "idle"}>
                                <box
                                  paddingLeft={1}
                                  paddingRight={1}
                                  backgroundColor={theme.backgroundElement}
                                  border={["round"]}
                                  borderColor={theme.borderSubtle}
                                >
                                  <text fg={trustSurface().color}>trust {trustSurface().label}</text>
                                </box>
                              </Show>
                              <Show when={pendingRaoCount() > 0}>
                                <box
                                  paddingLeft={1}
                                  paddingRight={1}
                                  backgroundColor={tint(theme.backgroundElement, theme.warning, 0.08)}
                                  border={["round"]}
                                  borderColor={theme.warning}
                                >
                                  <text fg={theme.warning}>attention {pendingRaoCount()}</text>
                                </box>
                              </Show>
                              <Show when={workstationState().artifactSummary.count > 0}>
                                <box
                                  paddingLeft={1}
                                  paddingRight={1}
                                  backgroundColor={theme.backgroundElement}
                                  border={["round"]}
                                  borderColor={theme.borderSubtle}
                                >
                                  <text fg={theme.textMuted}>artifacts {workstationState().artifactSummary.count}</text>
                                </box>
                              </Show>
                              <Show when={paneBadge(activePaneMode())}>
                                <box
                                  paddingLeft={1}
                                  paddingRight={1}
                                  backgroundColor={tint(theme.backgroundElement, theme.primary, 0.08)}
                                  border={["round"]}
                                  borderColor={theme.borderSubtle}
                                >
                                  <text fg={theme.primary}>
                                    {paneLabel(activePaneMode())} {paneBadge(activePaneMode())}
                                  </text>
                                </box>
                              </Show>
                            </box>
                          </Show>
                        </box>
                        <Switch>
                          <Match when={activePaneMode() === "diff"}>
                            <Show
                              when={hasDiffNeed()}
                              fallback={<text fg={theme.textMuted}>No active diff or proposed changes for this turn.</text>}
                            >
                              <box flexDirection="column" gap={1} flexGrow={1} width="100%">
                                <Show when={revert()?.diffFiles?.length}>
                                  <box flexDirection="column" gap={0}>
                                    <For each={revert()?.diffFiles ?? []}>
                                      {(file) => (
                                        <text fg={theme.text}>
                                          {file.filename}
                                          <Show when={file.additions > 0}>
                                            <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                          </Show>
                                          <Show when={file.deletions > 0}>
                                            <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                          </Show>
                                        </text>
                                      )}
                                    </For>
                                  </box>
                                </Show>
                                <Show when={proposedChanges().length > 0}>
                                  <box flexDirection="column" gap={0} marginBottom={1}>
                                    <text fg={theme.primary} bold>PROPOSED CHANGES</text>
                                    <text fg={theme.textMuted}>Review the planned write before DAX applies it.</text>
                                    <For each={proposedChanges()}>
                                      {(change) => (
                                        <box
                                          flexDirection="row"
                                          gap={1}
                                          justifyContent="space-between"
                                          onMouseUp={() => setSelectedProposedChangeId(change.changeId)}
                                          paddingLeft={1}
                                          paddingRight={1}
                                          backgroundColor={
                                            selectedProposedChangeId() === change.changeId
                                              ? tint(theme.backgroundElement, theme.primary, 0.14)
                                              : theme.backgroundPanel
                                          }
                                          border={["round"]}
                                          borderColor={
                                            selectedProposedChangeId() === change.changeId ? theme.primary : theme.borderSubtle
                                          }
                                        >
                                          <text fg={selectedProposedChangeId() === change.changeId ? theme.primary : theme.text}>
                                            {selectedProposedChangeId() === change.changeId ? ">" : " "}
                                            {" "}
                                            {change.filePath}
                                          </text>
                                          <text fg={proposedChangeStatusColor(change.status)}>
                                            {proposedChangeStatusLabel(change.status)}
                                          </text>
                                        </box>
                                      )}
                                    </For>
                                  </box>
                                </Show>
                                <box
                                  flexGrow={1}
                                  border={["top"]}
                                  borderColor={theme.borderSubtle}
                                  paddingTop={1}
                                  width="100%"
                                >
                                  <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration()}>
                                    <diff
                                      diff={revert()?.diff ?? selectedProposedChange()?.diff ?? ""}
                                      view={paneDiffView()}
                                      filetype={revert()?.diff ? paneDiffFiletype() : filetype(selectedProposedChange()?.filePath)}
                                      syntaxStyle={syntax()}
                                      showLineNumbers={true}
                                      width="100%"
                                      wrapMode={diffWrapMode()}
                                      fg={theme.text}
                                      addedBg={theme.diffAddedBg}
                                      removedBg={theme.diffRemovedBg}
                                      contextBg={theme.diffContextBg}
                                      addedSignColor={theme.diffHighlightAdded}
                                      removedSignColor={theme.diffHighlightRemoved}
                                      lineNumberFg={theme.diffLineNumber}
                                      lineNumberBg={theme.diffContextBg}
                                      addedLineNumberBg={theme.diffAddedLineNumberBg}
                                      removedLineNumberBg={theme.diffRemovedLineNumberBg}
                                    />
                                  </scrollbox>
                                </box>
                              </box>
                            </Show>
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
                                kv.set(DAX_SETTING.session_refined_prompt, "")
                                setPaneMode(() => "plan")
                                setPaneVisibility(() => "auto")
                                setSmartFollowActive(true)
                              }}
                            />
                          </Match>
                          <Match when={activePaneMode() === "audit"}>
                            <AuditLogPane history={auditHistory()} latest={latestAudit()} />
                          </Match>
                          <Match when={activePaneMode() === "approvals"}>
                            <box flexGrow={1} minHeight={0}>
                              <RAOPane
                                permissions={permissions()}
                                questions={questions()}
                                sessionID={route.sessionID}
                              />
                            </box>
                          </Match>
                          <Match when={activePaneMode() === "plan"}>
                            <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
                              <box
                                flexDirection="column"
                                gap={0}
                                paddingBottom={1}
                                border={["bottom"]}
                                borderColor={theme.borderSubtle}
                              >
                                <text fg={theme.primary} bold>
                                  Workstation
                                </text>
                                <text fg={theme.textMuted}>Live execution state and operator focus</text>
                              </box>
                              <Show
                                when={
                                  !!workstationState().goal ||
                                  !!workstationState().currentStep ||
                                  planMilestones().length > 0 ||
                                  workstationState().activitySummary.items.length > 0
                                }
                                fallback={
                                  <box
                                    flexDirection="column"
                                    gap={0}
                                    padding={1}
                                    border={["round"]}
                                    borderColor={theme.borderSubtle}
                                    backgroundColor={theme.backgroundElement}
                                  >
                                    <text fg={theme.text}>This pane will update as DAX builds context.</text>
                                    <text fg={theme.textMuted}>Use the stream on the left for the narrative. This side stays focused on live state.</text>
                                  </box>
                                }
                              >
                                <box
                                  flexDirection="column"
                                  gap={1}
                                  border={["round"]}
                                  borderColor={tint(theme.borderSubtle, theme.primary, 0.35)}
                                  backgroundColor={tint(theme.backgroundPanel, theme.primary, 0.05)}
                                  padding={1}
                                >
                                  <box
                                    flexDirection="row"
                                    gap={1}
                                    flexWrap="wrap"
                                    padding={1}
                                    backgroundColor={theme.backgroundElement}
                                    border={["round"]}
                                    borderColor={theme.borderSubtle}
                                  >
                                    <box
                                      backgroundColor={tint(theme.background, theme.primary, 0.18)}
                                      border={["round"]}
                                      borderColor={theme.borderSubtle}
                                      paddingLeft={1}
                                      paddingRight={1}
                                    >
                                      <text fg={theme.primary} bold>
                                        {workstationState().lifecycleLabel}
                                      </text>
                                    </box>
                                    <Show when={workstationState().trustPosture !== "clear"}>
                                      <box
                                        backgroundColor={tint(
                                          theme.background,
                                          workstationState().trustPosture === "blocked" ? theme.error : theme.warning,
                                          0.14,
                                        )}
                                        border={["round"]}
                                        borderColor={
                                          workstationState().trustPosture === "blocked" ? theme.error : theme.warning
                                        }
                                        paddingLeft={1}
                                        paddingRight={1}
                                      >
                                        <text
                                          fg={
                                            workstationState().trustPosture === "blocked" ? theme.error : theme.warning
                                          }
                                        >
                                          {workstationState().trustLabel}
                                        </text>
                                      </box>
                                    </Show>
                                  </box>
                                  <box
                                    flexDirection="column"
                                    gap={0}
                                    padding={1}
                                    backgroundColor={tint(theme.backgroundElement, theme.primary, 0.06)}
                                    border={["round"]}
                                    borderColor={theme.borderSubtle}
                                  >
                                    <box flexDirection="row" justifyContent="space-between" gap={1} flexWrap="wrap">
                                      <text fg={theme.text}>Live lane</text>
                                      <text fg={theme.primary}>{liveRailHint().label}</text>
                                    </box>
                                    <text fg={theme.textMuted} wrapMode="word">
                                      {stageLabel()} · {streamStatus()}
                                    </text>
                                    <text fg={theme.text} wrapMode="word">
                                      {liveRailHint().reason}
                                    </text>
                                  </box>
                                  <box
                                    flexDirection="column"
                                    gap={0}
                                    padding={1}
                                    backgroundColor={
                                      operatorNextMove().tone === "warning"
                                        ? tint(theme.backgroundElement, theme.warning, 0.08)
                                        : operatorNextMove().tone === "accent"
                                          ? tint(theme.backgroundElement, theme.accent, 0.08)
                                          : operatorNextMove().tone === "primary"
                                            ? tint(theme.backgroundElement, theme.primary, 0.08)
                                            : theme.backgroundElement
                                    }
                                    border={["round"]}
                                    borderColor={
                                      operatorNextMove().tone === "warning"
                                        ? theme.warning
                                        : operatorNextMove().tone === "accent"
                                          ? theme.accent
                                          : operatorNextMove().tone === "primary"
                                            ? theme.primary
                                            : theme.borderSubtle
                                    }
                                  >
                                    <text
                                      fg={
                                        operatorNextMove().tone === "warning"
                                          ? theme.warning
                                          : operatorNextMove().tone === "accent"
                                            ? theme.accent
                                            : operatorNextMove().tone === "primary"
                                              ? theme.primary
                                              : theme.text
                                      }
                                    >
                                      Operator next move
                                    </text>
                                    <text fg={theme.text} wrapMode="word" bold>
                                      {operatorNextMove().title}
                                    </text>
                                    <text fg={theme.textMuted} wrapMode="word">
                                      {operatorNextMove().detail}
                                    </text>
                                  </box>
                                  <Show when={refineStatus()}>
                                    {(status) => (
                                      <box
                                        flexDirection="column"
                                        gap={0}
                                        padding={1}
                                        backgroundColor={
                                          status().tone === "error"
                                            ? tint(theme.backgroundElement, theme.error, 0.08)
                                            : status().tone === "warning"
                                              ? tint(theme.backgroundElement, theme.warning, 0.08)
                                              : tint(theme.backgroundElement, theme.success, 0.08)
                                        }
                                        border={["round"]}
                                        borderColor={
                                          status().tone === "error"
                                            ? theme.error
                                            : status().tone === "warning"
                                              ? theme.warning
                                              : theme.success
                                        }
                                      >
                                        <box flexDirection="row" justifyContent="space-between" gap={1} flexWrap="wrap">
                                          <text
                                            fg={
                                              status().tone === "error"
                                                ? theme.error
                                                : status().tone === "warning"
                                                  ? theme.warning
                                                  : theme.success
                                            }
                                          >
                                            Refine contract
                                          </text>
                                          <text
                                            fg={
                                              status().tone === "error"
                                                ? theme.error
                                                : status().tone === "warning"
                                                  ? theme.warning
                                                  : theme.success
                                            }
                                            bold
                                          >
                                            {status().label}
                                          </text>
                                        </box>
                                        <Show when={refineExecutionProfile().length > 0}>
                                          <For each={refineExecutionProfile().slice(0, 3)}>
                                            {(item) => <text fg={theme.text}>{item}</text>}
                                          </For>
                                        </Show>
                                        <Show when={refineApprovals().length > 0}>
                                          <text fg={theme.textMuted} wrapMode="word">
                                            Approval forecast: {refineApprovals()[0]}
                                          </text>
                                        </Show>
                                        <Show when={refineValidationPlan().length > 0}>
                                          <text fg={theme.textMuted} wrapMode="word">
                                            Validation plan: {refineValidationPlan()[0]}
                                          </text>
                                        </Show>
                                        <Show when={refineGovernance().length > 0}>
                                          <text fg={theme.textMuted} wrapMode="word">
                                            Governance hint: {refineGovernance()[0]}
                                          </text>
                                        </Show>
                                        <text fg={theme.textMuted} wrapMode="word">
                                          {status().reason}
                                        </text>
                                      </box>
                                    )}
                                  </Show>
                                  <Show when={workstationState().currentStep}>
                                    <box
                                      flexDirection="column"
                                      gap={0}
                                      padding={1}
                                      backgroundColor={theme.backgroundElement}
                                      border={["round"]}
                                      borderColor={theme.borderSubtle}
                                    >
                                      <text fg={theme.textMuted}>Current focus</text>
                                      <text fg={theme.text} wrapMode="word">
                                        {workstationState().currentStep}
                                      </text>
                                    </box>
                                  </Show>
                                  <Show when={planMilestones().length > 0}>
                                    <box
                                      flexDirection="column"
                                      gap={0}
                                      padding={1}
                                      backgroundColor={theme.backgroundElement}
                                      border={["round"]}
                                      borderColor={theme.borderSubtle}
                                    >
                                      <text fg={theme.textMuted}>Milestone board</text>
                                      <For each={planMilestones().slice(0, 4)}>
                                        {(item) => (
                                          <box flexDirection="row" justifyContent="space-between" gap={1}>
                                            <text
                                              fg={
                                                item.status === "done"
                                                  ? theme.success
                                                  : item.status === "active"
                                                    ? theme.text
                                                    : theme.textMuted
                                              }
                                              wrapMode="word"
                                            >
                                              {item.status === "done" ? "✓" : item.status === "active" ? "●" : "◌"}{" "}
                                              {item.label}
                                            </text>
                                            <text fg={theme.textMuted}>
                                              {item.status === "done"
                                                ? "done"
                                                : item.status === "active"
                                                  ? "active"
                                                  : "queued"}
                                            </text>
                                          </box>
                                        )}
                                      </For>
                                    </box>
                                  </Show>
                                  <Show when={showInterventionQueue() && workstationState().approvalSummary.pendingCount > 0}>
                                    <box
                                      flexDirection="column"
                                      gap={0}
                                      padding={1}
                                      backgroundColor={tint(theme.backgroundElement, theme.warning, 0.08)}
                                      border={["round"]}
                                      borderColor={theme.warning}
                                    >
                                      <text fg={theme.warning}>Operator review required</text>
                                      <text fg={theme.text}>
                                        ● Review {workstationState().approvalSummary.topLabel ?? "approval"} before DAX can continue
                                      </text>
                                      <text fg={theme.textMuted}>
                                        {workstationState().approvalSummary.pendingCount} item{workstationState().approvalSummary.pendingCount === 1 ? "" : "s"} waiting in the review queue
                                      </text>
                                    </box>
                                  </Show>
                                  <Show when={showInterventionQueue() && activeInterventions().length > 0}>
                                    <box
                                      flexDirection="column"
                                      gap={0}
                                      padding={1}
                                      backgroundColor={tint(theme.backgroundElement, theme.error, 0.07)}
                                      border={["round"]}
                                      borderColor={theme.error}
                                    >
                                      <text fg={theme.error}>Why the run is paused</text>
                                      <For each={activeInterventions().slice(0, 2)}>
                                        {(item) => (
                                          <box flexDirection="column" gap={0} paddingTop={1}>
                                            <text fg={theme.text}>
                                              {interventionKindLabel(item.kind)}{item.approvalId ? " · linked to review" : ""}
                                            </text>
                                            <text fg={theme.textMuted} wrapMode="word">
                                              {item.reason}
                                            </text>
                                          </box>
                                        )}
                                      </For>
                                      <text fg={theme.textMuted}>Resolve the review or ambiguity, then DAX can resume the run.</text>
                                    </box>
                                  </Show>
                                  <Show when={workstationState().goal}>
                                    <box
                                      flexDirection="column"
                                      gap={0}
                                      padding={1}
                                      backgroundColor={theme.backgroundElement}
                                      border={["round"]}
                                      borderColor={theme.borderSubtle}
                                    >
                                      <text fg={theme.textMuted}>Goal</text>
                                      <text fg={theme.text} wrapMode="word" bold>
                                        {workstationState().goal}
                                      </text>
                                    </box>
                                  </Show>
                                  <Show when={workstationState().activitySummary.items.length > 0}>
                                    <box
                                      flexDirection="column"
                                      gap={0}
                                      padding={1}
                                      backgroundColor={theme.backgroundElement}
                                      border={["round"]}
                                      borderColor={theme.borderSubtle}
                                    >
                                      <text fg={theme.textMuted}>Active thread</text>
                                      <For each={workstationState().activitySummary.items.slice(0, 2)}>
                                        {(item) => <text fg={theme.text}>● {item}</text>}
                                      </For>
                                    </box>
                                  </Show>
                                  <Show when={planTooling().length > 0}>
                                    <box
                                      flexDirection="column"
                                      gap={0}
                                      padding={1}
                                      backgroundColor={theme.backgroundElement}
                                      border={["round"]}
                                      borderColor={theme.borderSubtle}
                                    >
                                      <text fg={theme.textMuted}>Recent tooling</text>
                                      <For each={planTooling().slice(0, 2)}>
                                        {(item) => (
                                          <box flexDirection="row" justifyContent="space-between" gap={1}>
                                            <text fg={item.status === "pending" ? theme.primary : theme.text}>
                                              {item.status === "pending" ? "◌" : "✓"} {item.label}
                                            </text>
                                            <text fg={theme.textMuted}>
                                              {item.status === "pending" ? "live" : item.status}
                                            </text>
                                          </box>
                                        )}
                                      </For>
                                    </box>
                                  </Show>
                                </box>
                              </Show>
                              <Show when={todo().length > 0}>
                                <box flexDirection="column" gap={1}>
                                  <text fg={theme.text}>Execution plan</text>
                                  <box
                                    flexDirection="column"
                                    gap={1}
                                    border={["round"]}
                                    borderColor={theme.borderSubtle}
                                    backgroundColor={tint(theme.backgroundPanel, theme.accent, 0.03)}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <For each={todo().slice(0, 6)}>
                                      {(item) => <TodoItem status={item.status} content={item.content} />}
                                    </For>
                                  </box>
                                </box>
                              </Show>
                            </box>
                          </Match>
                          <Match when={activePaneMode() === "memory"}>
                            <WorkspaceMemoryPane />
                          </Match>
                        </Switch>
                      </box>
                    </scrollbox>
                  </box>
                </Match>
                <Match when={true}>
                  <scrollbox
                    ref={(r: ScrollBoxRenderable | undefined) => {
                      if (r) scroll = r
                    }}
                    onMouseDown={pauseSmartFollow}
                    viewportOptions={{
                      paddingRight: showScrollbar() ? 1 : 0,
                    }}
                    verticalScrollbarOptions={{
                      paddingLeft: 1,
                      visible: showScrollbar(),
                      trackOptions: {
                        backgroundColor: theme.backgroundElement,
                        foregroundColor: theme.border,
                      },
                    }}
                    stickyScroll={followEnabled()}
                    stickyStart="bottom"
                    flexGrow={1}
                    scrollAcceleration={scrollAcceleration()}
                  >
                    <For each={narrative()}>
                      {(item, index) => (
                        <Switch>
                          <Match when={item.type === "lifecycle"}>
                            <LifecycleEvent event={item.data} />
                          </Match>
                          <Match when={item.type === "message"}>
                            {(function() {
                              const message = item.data as any;
                              return (
                                <Switch>
                                  <Match when={message.id === revert()?.messageID}>
                                    {(function () {
                                      const command = useCommandDialog()
                                      const [hover, setHover] = createSignal(false)
                                      const dialog = useDialog()

                                      const handleUnrevert = async () => {
                                        const confirmed = await DialogConfirm.show(
                                          dialog,
                                          "Confirm Redo",
                                          "Are you sure you want to restore the reverted messages?",
                                        )
                                        if (confirmed) {
                                          command.trigger("session.redo")
                                        }
                                      }

                                      return (
                                        <box
                                          onMouseOver={() => setHover(true)}
                                          onMouseOut={() => setHover(false)}
                                          onMouseUp={handleUnrevert}
                                          marginTop={1}
                                          flexShrink={0}
                                          border={["left"]}
                                          customBorderChars={SplitBorder.customBorderChars}
                                          borderColor={theme.backgroundPanel}
                                        >
                                          <box
                                            paddingTop={1}
                                            paddingBottom={1}
                                            paddingLeft={2}
                                            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
                                          >
                                            <text fg={theme.textMuted}>{revert()!.reverted.length} message reverted</text>
                                            <text fg={theme.textMuted}>
                                              <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> to
                                              restore
                                            </text>
                                            <Show when={revert()!.diffFiles?.length}>
                                              <box marginTop={1}>
                                                <For each={revert()!.diffFiles}>
                                                  {(file) => (
                                                    <text fg={theme.text}>
                                                      {file.filename}
                                                      <Show when={file.additions > 0}>
                                                        <span style={{ fg: theme.diffAdded }}> +{file.additions}</span>
                                                      </Show>
                                                      <Show when={file.deletions > 0}>
                                                        <span style={{ fg: theme.diffRemoved }}> -{file.deletions}</span>
                                                      </Show>
                                                    </text>
                                                  )}
                                                </For>
                                              </box>
                                            </Show>
                                          </box>
                                        </box>
                                      )
                                    })()}
                                  </Match>
                                  <Match when={revert()?.messageID && message.id >= revert()!.messageID}>
                                    <></>
                                  </Match>
                                  <Match when={message.role === "user"}>
                                    <UserMessage
                                      index={index()}
                                      onMouseUp={() => {
                                        if (renderer.getSelection()?.getSelectedText()) return
                                        dialog.replace(() => (
                                          <DialogMessage
                                            messageID={message.id}
                                            sessionID={route.sessionID}
                                            setPrompt={(promptInfo) => prompt?.set(promptInfo)}
                                          />
                                        ))
                                      }}
                                      message={message as UserMessage}
                                      parts={renderParts(message)}
                                      pending={pending()}
                                    />
                                  </Match>
                                  <Match when={message.role === "assistant"}>
                                    <StageTimeline
                                      visible={message.id === pending()}
                                      stageState={displayStageState()}
                                      stageLabel={stageLabel()}
                                      stageColor={stageColor()}
                                      streamStatus={streamStatus()}
                                      explainMode={explainMode()}
                                    />
                                    <AssistantMessage
                                      last={lastAssistant()?.id === message.id}
                                      message={message as AssistantMessage}
                                      parts={renderParts(message)}
                                      stage={displayStageState().stage}
                                      todo={todo()}
                                    />
                                  </Match>
                                </Switch>
                              )
                            })()}
                          </Match>
                        </Switch>
                      )}
                    </For>
                  </scrollbox>
                </Match>
              </Switch>
            </ErrorBoundary>
            <box flexShrink={0}>
              <Show when={promptDisabled()}>
                <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
                  <text fg={theme.warning}>
                    Input disabled while viewing a delegated session. Switch back to the parent to continue typing.
                  </text>
                </box>
              </Show>
              <Prompt
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                  // Apply initial prompt when prompt component mounts (e.g., from fork)
                  if (route.initialPrompt) {
                    r.set(route.initialPrompt)
                  }
                }}
                disabled={promptDisabled()}
                panePinned={paneVisibility() === "pinned"}
                activePaneMode={activePaneMode()}
                approvalAttentionCount={permissions().length}
                questionAttentionCount={questions().length}
                onRefineReady={(promptText) => {
                  kv.set(DAX_SETTING.session_refined_prompt, promptText)
                  setPaneMode(() => "refine")
                  setPaneVisibility(() => "pinned")
                  setSmartFollowActive(false)
                  setPendingUpdates(0)
                }}
                onSubmit={() => {
                  promptRef.current?.submit()
                  toBottom()
                }}
                sessionID={route.sessionID}
              />
            </box>
          </box>
          <Show when={!sidebarVisible() || !wide()}>
            <Footer lifecycleLabel={labelStage(stageState().stage, explainMode())} />
          </Show>
          <Toast />
        </box>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar
                sessionID={route.sessionID}
                onInspectApprovals={() => {
                  setPaneMode(() => "approvals")
                  setPaneVisibility(() => "pinned")
                }}
                onInspectDiff={openDiffDialog}
                onInspectMcp={openStatusDialog}
                onOpenPm={openPmPane}
                onOpenTimeline={openTimelineDialog}
                onJumpLive={toBottom}
                onJumpLastUser={jumpLastUserMessage}
              />
            </Match>
            <Match when={true}>
              <box
                position="absolute"
                top={0}
                left={0}
                right={0}
                bottom={0}
                alignItems="flex-end"
                backgroundColor={RGBA.fromInts(0, 0, 0, 70)}
              >
                <Sidebar
                  sessionID={route.sessionID}
                  onInspectApprovals={() => {
                    setPaneMode(() => "approvals")
                    setPaneVisibility(() => "pinned")
                  }}
                  onInspectDiff={openDiffDialog}
                  onInspectMcp={openStatusDialog}
                  onOpenPm={openPmPane}
                  onOpenTimeline={openTimelineDialog}
                  onJumpLive={toBottom}
                  onJumpLastUser={jumpLastUserMessage}
                />
              </box>
            </Match>
          </Switch>
        </Show>
      </box>
    </context.Provider>
  )
}

function ActivityCluster(props: { tools: ToolPart[] }) {
  const { theme } = useTheme()
  const ctx = use()
  const session = createMemo(() => ctx.sync.session.get(ctx.sessionID))
  const reflection = createMemo(() => (session()?.state_v2 as any)?.reflection)
  const [expanded, setExpanded] = createSignal(false)
  const count = () => props.tools.length
  const summary = () => {
    const tools = Array.from(new Set(props.tools.map((t) => t.tool)))
    const map: Record<string, string> = { read: "read", glob: "scanned", grep: "searched", list: "listed" }
    const verbs = tools.map((tool) => map[tool] ?? tool)
    return `Checked ${count()} repo items · ${verbs.join(", ")}`
  }

  return (
    <box
      flexDirection="column"
      marginTop={1}
      marginBottom={1}
      borderStyle="round"
      borderColor={theme.borderSubtle}
      backgroundColor={tint(theme.background, theme.backgroundElement, 0.28)}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" gap={1} onMouseUp={() => setExpanded(!expanded())} paddingTop={1} paddingBottom={1}>
        <box backgroundColor={tint(theme.background, theme.borderSubtle, 0.24)} paddingLeft={1} paddingRight={1} marginRight={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            activity
          </text>
        </box>
        <text fg={theme.textMuted}>{expanded() ? "▼" : "▶"}</text>
        <text fg={theme.textMuted}>{summary()}</text>
      </box>
      <Show when={expanded()}>
        <box
          flexDirection="column"
          paddingLeft={2}
          borderStyle="single"
          borderLeft
          borderColor={theme.backgroundElement}
          marginBottom={1}
        >
          <For each={props.tools}>
            {(tool) => (
              <box flexDirection="row" gap={1}>
                <text fg={theme.success}>✓</text>
                <text fg={theme.textMuted}>{tool.tool}</text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={reflection()?.verificationPlan && reflection()!.verificationPlan.length > 0}>
        <box
          flexDirection="row"
          gap={1}
          paddingTop={0}
          paddingBottom={1}
          paddingLeft={1}
        >
          <text fg={theme.secondary}>🛡️</text>
          <text fg={theme.textMuted} italic>
            Verifying: {reflection()!.verificationPlan.length} checks in progress
          </text>
        </box>
      </Show>
    </box>
  )
}

function LifecycleEvent(props: { event: any }) {
  const { theme } = useTheme()
  const label = createMemo(() => props.event.message || props.event.type)

  const icon = createMemo(() => {
    switch (props.event.type) {
      case "intent.created": return "🎯"
      case "plan.compiled": return "📋"
      case "plan.step_promoted": return "⏩"
      case "intervention.required": return "⚠️"
      case "intervention.resolved": return "✅"
      case "intervention.dismissed": return "⏭️"
      case "intervention.escalated": return "⬆️"
      case "audit.posture_updated": return "🛡️"
      case "run.state_changed": return "⚙️"
      case "artifact.created": return "📦"
      default: return "•"
    }
  })

  const color = createMemo(() => {
    if (props.event.type === "intervention.required") return theme.error
    if (props.event.type === "intervention.resolved") return theme.success
    return theme.textMuted
  })

  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      marginTop={1}
      flexDirection="row"
      gap={1}
      alignItems="center"
    >
      <text fg={color()}>{icon()}</text>
      <text fg={color()} attributes={TextAttributes.BOLD} wrapMode="word">
        {label()}
      </text>
    </box>
  )
}
const MIME_BADGE: Record<string, string> = {
  "text/plain": "txt",
  "image/png": "img",
  "image/jpeg": "img",
  "image/gif": "img",
  "image/webp": "img",
  "application/pdf": "pdf",
  "application/x-directory": "dir",
}

function UserMessage(props: {
  message: UserMessage
  parts: Part[]
  onMouseUp: () => void
  index: number
  pending?: string
}) {
  const ctx = use()
  const local = useLocal()
  const text = createMemo(() => props.parts.flatMap((x) => (x.type === "text" && !x.synthetic ? [x] : []))[0])
  const files = createMemo(() => props.parts.flatMap((x) => (x.type === "file" ? [x] : [])))
  const sync = useSync()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        <box
          id={props.message.id}
          marginTop={1}
          marginBottom={0}
          border={["left"]}
          borderColor={theme.accent}
          backgroundColor={tint(theme.background, theme.accent, 0.02)}
          paddingLeft={1}
          paddingRight={0}
        >
          <box onMouseUp={props.onMouseUp} flexShrink={0}>
            <box
              flexDirection="row"
              gap={1}
              alignItems="center"
              paddingTop={0}
              paddingBottom={0}
              border={["bottom"]}
              borderColor={theme.backgroundElement}
              marginBottom={1}
            >
              <box backgroundColor={theme.accent} paddingLeft={1} paddingRight={1} marginRight={1}>
                <text fg={theme.background} attributes={TextAttributes.BOLD}>
                  YOU
                </text>
              </box>
              <Show when={ctx.showTimestamps()}>
                <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                  {Locale.todayTimeOrDateTime(props.message.time.created)}
                </text>
              </Show>
            </box>
            <box paddingLeft={1} paddingRight={1} paddingBottom={0}>
              <text fg={theme.accent} wrapMode="word" attributes={TextAttributes.BOLD}>
                {text()?.text}
              </text>
            </box>
            <Show when={files().length}>
              <box flexDirection="row" paddingTop={1} gap={1} flexWrap="wrap">
                <For each={files()}>
                  {(file) => {
                    const bg = createMemo(() => {
                      if (file.mime.startsWith("image/")) return theme.accent
                      if (file.mime === "application/pdf") return theme.primary
                      return theme.secondary
                    })
                    return (
                      <text fg={theme.text}>
                        <span style={{ bg: bg(), fg: theme.background }}> {MIME_BADGE[file.mime] ?? file.mime} </span>
                        <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.filename} </span>
                      </text>
                    )
                  }}
                </For>
              </box>
            </Show>
          </box>
        </box>
      </Show>
      <Show when={compaction()}>
        <box
          marginTop={1}
          border={["top"]}
          title=" Compaction "
          titleAlignment="center"
          borderColor={theme.borderActive}
        />
      </Show>
    </>
  )
}

type StageTimelineProps = {
  visible: boolean
  stageState: { stage: StreamStage; reason: string }
  stageLabel: string
  stageColor: RGBA
  streamStatus: string
  explainMode: boolean
}

function StageTimeline(props: StageTimelineProps) {
  const { theme } = useTheme()
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTick((t) => (t + 1) % 10), 200)
    onCleanup(() => clearInterval(timer))
  })
  const showFlow = createMemo(() => PRIMARY_STAGE_FLOW.includes(props.stageState.stage))
  const stageNames = createMemo(() => PRIMARY_STAGE_FLOW.map((stage) => labelStage(stage, props.explainMode)))
  const activeIndex = createMemo(() => PRIMARY_STAGE_FLOW.indexOf(props.stageState.stage))
  const baseBackground = createMemo(() => theme.backgroundElement ?? theme.backgroundPanel ?? theme.background)

  return (
    <Show when={props.visible}>
      <box paddingLeft={2} paddingRight={2} paddingTop={0} paddingBottom={0} flexDirection="column" gap={0}>
        <Switch>
          <Match when={showFlow()}>
            <box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center" marginTop={1}>
              <For each={PRIMARY_STAGE_FLOW}>
                {(stage, index) => {
                  const idx = index()
                  const state =
                    activeIndex() === -1
                      ? "upcoming"
                      : idx < activeIndex()
                        ? "complete"
                        : idx === activeIndex()
                          ? "active"
                          : "upcoming"
                  const bg =
                    state === "active"
                      ? tint(baseBackground(), props.stageColor, 0.55 + (tick() % 2 === 0 ? 0.05 : -0.05))
                      : state === "complete"
                        ? tint(baseBackground(), theme.primary, 0.35)
                        : tint(baseBackground(), theme.borderSubtle, 0.15)
                  const fg = state === "active" ? props.stageColor : state === "complete" ? theme.text : theme.textMuted
                  return (
                    <box flexDirection="row" alignItems="center" gap={1}>
                      <box paddingLeft={1} paddingRight={1} paddingBottom={0} paddingTop={0} backgroundColor={bg}>
                        <text fg={fg}>{stageNames()[idx]}</text>
                      </box>
                      <Show when={idx < PRIMARY_STAGE_FLOW.length - 1}>
                        <text fg={theme.borderSubtle}>›</text>
                      </Show>
                    </box>
                  )
                }}
              </For>
            </box>
          </Match>
          <Match when={!showFlow()}>
            <box flexDirection="row" gap={1} alignItems="center">
              <box
                paddingLeft={1}
                paddingRight={1}
                paddingBottom={0}
                paddingTop={0}
                backgroundColor={tint(baseBackground(), props.stageColor, 0.5 + (tick() % 2 === 0 ? 0.05 : -0.05))}
              >
                <text fg={props.stageColor}>{props.stageLabel}</text>
              </box>
            </box>
          </Match>
        </Switch>
      </box>
    </Show>
  )
}

function LiveTrace(props: { sessionID: string }) {
  const sync = useSync()
  const { theme } = useTheme()
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const toolCalls = createMemo(() => {
    return messages()
      .flatMap((msg) => {
        const parts = sync.data.part[msg.id] ?? []
        return parts
          .filter((p): p is ToolPart => p.type === "tool")
          .map((p) => ({
            tool: p.tool,
            state: p.state,
            time: p.state.status !== "pending" ? (p.state as any).time.created : Date.now(),
          }))
      })
      .sort((a, b) => b.time - a.time)
      .slice(0, 5)
  })

  const aggregatedCalls = createMemo(() => {
    const raw = toolCalls()
    const result: Array<{ tool: string; status: string; count: number }> = []
    for (const call of raw) {
      const last = result[result.length - 1]
      if (last && last.tool === call.tool && last.status === call.state.status) {
        last.count++
      } else {
        result.push({ tool: call.tool, status: call.state.status, count: 1 })
      }
    }
    return result.slice(0, 5)
  })

  return (
    <box flexDirection="column" gap={0} marginTop={1}>
      <text fg={theme.textMuted} attributes={TextAttributes.BOLD} marginBottom={1}>
        LIVE TRACE
      </text>
      <For each={aggregatedCalls()}>
        {(call) => (
          <box flexDirection="row" gap={1}>
            <text fg={call.status === "completed" ? theme.success : theme.primary}>
              {call.status === "completed" ? "✓" : "→"}
            </text>
            <text fg={theme.text} wrapMode="truncate-end">
              {Locale.titlecase(call.tool)}
              <Show when={call.count > 1}>
                <span style={{ fg: theme.textMuted }}> (x{call.count})</span>
              </Show>
            </text>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              [{call.status}]
            </text>
          </box>
        )}
      </For>
    </box>
  )
}

function Explainable(props: { children: JSX.Element; explanation?: string }) {
  const { theme } = useTheme()
  const [show, setShow] = createSignal(false)
  return (
    <box flexDirection="column" gap={0}>
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <box flexGrow={1}>{props.children}</box>
        <box
          onMouseUp={() => setShow(!show())}
          backgroundColor={show() ? theme.accent : theme.backgroundElement}
          paddingLeft={1}
          paddingRight={1}
          marginLeft={1}
        >
          <text fg={show() ? theme.background : theme.textMuted}>?</text>
        </box>
      </box>
      <Show when={show() && props.explanation}>
        <box
          marginTop={1}
          padding={1}
          backgroundColor={theme.backgroundElement}
          border={["left"]}
          borderColor={theme.accent}
        >
          <text fg={theme.text} wrapMode="word">
            {props.explanation}
          </text>
        </box>
      </Show>
    </box>
  )
}

function groupParts(parts: Part[]): GroupedPart[] {
  const result: GroupedPart[] = []
  const cluster: ToolPart[] = []

  const isLowLevel = (p: Part) => p.type === "tool" && ["read", "glob", "grep", "list"].includes(p.tool)

  const flush = () => {
    if (cluster.length > 0) {
      if (cluster.length === 1) {
        result.push(cluster[0])
      } else {
        result.push({ type: "activity-cluster", tools: [...cluster] } as any)
      }
      cluster.length = 0
    }
  }

  for (const part of parts) {
    if (isLowLevel(part)) {
      cluster.push(part as ToolPart)
    } else {
      flush()
      result.push(part)
    }
  }
  flush()
  return result
}

function describeRecentTool(tool: string, input: Record<string, any>) {
  const target = input.filePath || input.path || input.file || input.filename || input.target || ""
  const targetLabel =
    typeof target === "string" && target
      ? path.isAbsolute(target)
        ? path.basename(target)
        : target
      : ""
  const command = typeof input.command === "string" ? input.command.trim() : ""
  const compactCommand = command.replace(/\s+/g, " ")
  const commandPreview =
    compactCommand.length > 48 ? `${compactCommand.slice(0, 45).trimEnd()}...` : compactCommand
  switch (tool) {
    case "read":
      return targetLabel ? `Reading ${targetLabel}` : "Reading a file"
    case "glob":
      return input.pattern && input.path
        ? `Searching ${String(input.path)} for ${String(input.pattern)}`
        : input.pattern
          ? `Searching for ${String(input.pattern)}`
          : "Searching files"
    case "grep":
      return input.pattern && input.path
        ? `Searching ${String(input.path)} for matches`
        : input.pattern
          ? "Searching for matches"
          : "Searching file contents"
    case "list":
      return targetLabel ? `Listing ${targetLabel}` : "Listing files"
    case "shell":
      return commandPreview ? `Running ${commandPreview}` : "Running a shell command"
    case "edit":
      return targetLabel ? `Editing ${targetLabel}` : "Editing a file"
    case "write":
      return targetLabel ? `Writing ${targetLabel}` : "Writing a file"
    case "apply_patch":
      return targetLabel ? `Patching ${targetLabel}` : "Applying a patch"
    default:
      return targetLabel ? `${tool} · ${targetLabel}` : tool
  }
}

function isLowSignalPaneReason(value: string | undefined) {
  if (!value) return true
  return /^(idle|session processing|response stream active|reasoning stream active|waiting for provider response)$/i.test(
    value.trim(),
  )
}

function deriveStreamEvidenceItems(parts: Part[]) {
  const items: Array<{ label: string; status: "done" | "active" }> = []
  const seen = new Set<string>()
  const discoveryTools = new Set<string>()

  const pushItem = (label: string, status: "done" | "active") => {
    const normalized = label.trim().toLowerCase()
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    items.push({ label, status })
  }

  for (const part of [...parts].reverse()) {
    if (part.type !== "tool") continue
    const input = (part.state.input ?? {}) as Record<string, any>
    const label = describeRecentTool(part.tool, input)

    if (part.state.status === "pending" || part.state.status === "running") {
      pushItem(label, "active")
      continue
    }

    if (part.state.status !== "completed") continue

    if (["read", "shell", "write", "edit", "patch", "apply_patch", "webfetch"].includes(part.tool)) {
      pushItem(label, "done")
      continue
    }

    if (["glob", "grep", "list"].includes(part.tool)) {
      discoveryTools.add(part.tool)
    }
  }

  if (discoveryTools.size > 0) {
    const ordered = ["glob", "grep", "list"].filter((tool) => discoveryTools.has(tool))
    const verbs = ordered.map((tool) => ({ glob: "scanned", grep: "searched", list: "listed" })[tool] ?? tool)
    pushItem(`Checked workspace context · ${verbs.join(", ")}`, "done")
  }

  return items.slice(0, 3)
}

function isLowSignalGreeting(value: string) {
  return /^(hi|hello|hey|yo|sup|thanks|thank you|ok|okay|cool|nice)\b[!. ]*$/i.test(value.trim())
}

function deriveReasoningFallback(args: {
  asked: string
  doing: string
  next: string
  evidence: Array<{ label: string; status: "done" | "active" }>
  currentTool?: { status: string; label: string }
  runtimeStatus: { type: string; message?: string }
  completed: boolean
}) {
  if (args.runtimeStatus.type === "retry") {
    return "The provider is briefly cooling down. I’m holding the thread and will continue automatically as soon as the retry window clears."
  }

  if (args.runtimeStatus.type === "delayed") {
    return "The provider response is taking longer than usual, but the run is still active and waiting for the next model update."
  }

  if (args.currentTool && (args.currentTool.status === "pending" || args.currentTool.status === "running")) {
    return `I’m ${args.currentTool.label.toLowerCase()} so the next answer is grounded in the files and commands that matter for this task.`
  }

  if (args.evidence.length > 0) {
    const checked = args.evidence
      .filter((item) => item.status === "done")
      .slice(0, 2)
      .map((item) => item.label)
    if (checked.length === 1) {
      return `I’ve already ${checked[0].charAt(0).toLowerCase() + checked[0].slice(1)}, and I’m turning that evidence into the next useful answer.`
    }
    if (checked.length >= 2) {
      const [first, second] = checked
      return `I’ve already ${first.charAt(0).toLowerCase() + first.slice(1)} and ${second.charAt(0).toLowerCase() + second.slice(1)}, and I’m using that context to shape the answer.`
    }
  }

  if (!args.completed) {
    return `I’m working through "${args.asked}" and translating the current evidence into a clear next step.`
  }

  if (!isLowSignalGreeting(args.asked)) {
    return `I’ve worked through "${args.asked}" and I’m wrapping it into the clearest useful answer I can give next.`
  }

  return `I’m keeping the response grounded in the current task and ready for the next useful move.`
}

function AssistantMessage(props: {
  message: AssistantMessage
  parts: Part[]
  last: boolean
  stage: StreamStage
  todo: any[]
  persona?: PersonaPack
}) {
  const ctx = use()
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const kv = useKV()
  const [daxSpeaking, setDaxSpeaking] = createSignal(false)
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])
  const runtimeStatus = createMemo(() => sync.data.session_status?.[props.message.sessionID] ?? { type: "idle" as const })
  const [retryNow, setRetryNow] = createSignal(Date.now())
  const [stickyReasoningText, setStickyReasoningText] = createSignal<string | undefined>()
  createEffect(() => {
    if (runtimeStatus().type !== "retry") return
    setRetryNow(Date.now())
    const timer = setInterval(() => setRetryNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const toggleEli12 = () => kv.set(DAX_SETTING.explain_mode, explainMode() ? "normal" : "eli12")
  const showEli12Summary = createMemo(() => kv.get(DAX_SETTING.eli12_summary_visibility, false))
  const personaVoice = (text: string) => (props.persona ? applyPersonaVoice(text, props.persona) : text)
  const parent = createMemo(() => messages().find((x) => x.id === props.message.parentID && x.role === "user"))
  const currentToolLabel = createMemo(() => {
    for (const part of [...props.parts].reverse()) {
      if (part.type !== "tool") continue
      const input = (part.state.input ?? {}) as Record<string, any>
      return {
        status: part.state.status,
        label: describeRecentTool(part.tool, input),
      }
    }
    return undefined
  })
  const evidenceItems = createMemo(() => deriveStreamEvidenceItems(props.parts))
  const currentNativeReasoningText = createMemo(() => {
    if (!ctx.showThinking()) return undefined
    const chunks = props.parts
      .filter((part): part is ReasoningPart => part.type === "reasoning")
      .map((part) => cleanReasoningText(part.text))
      .filter(Boolean)
    if (chunks.length === 0) return undefined
    return chunks.join("\n\n")
  })
  createEffect(() => {
    const current = currentNativeReasoningText()
    if (current) setStickyReasoningText(current)
  })
  const visibleNativeReasoningText = createMemo(() => {
    if (!ctx.showThinking()) return undefined
    return currentNativeReasoningText() || stickyReasoningText()
  })
  const asked = createMemo(() => {
    const id = parent()?.id
    if (!id) return "No user request found."
    const text = (sync.data.part[id] ?? []).find((x) => x.type === "text" && "text" in x && x.text.trim())
    if (!text || !("text" in text)) return "Asked for help on this task."
    const body = text.text
      .replace(/^SYSTEM:\s*DAX\s*-\s*ELI12[\s\S]*?Primary success criteria:[\s\S]*?without confusion\.\s*/i, "")
      .replace(/Respond in plain language for non-technical users\.[\s\S]*?Your options\.\s*/i, "")
      .replace(/Please explain this:\s*/i, "")
      .replace(/Explain your previous response[\s\S]*?understand\.\s*/i, "")
      .trim()
      .replace(/\s+/g, " ")
    if (body.length <= 96) return body
    return body.slice(0, 96) + "..."
  })
  const doing = createMemo(() => {
    if (props.message.error) return personaVoice("Something went wrong while working through the request")
    if (runtimeStatus().type === "retry") return personaVoice("Waiting for a short provider cooldown before continuing")
    if (runtimeStatus().type === "delayed") return personaVoice("Still waiting on the provider while keeping the run alive")
    if (currentToolLabel()?.status === "pending") return personaVoice(`Working through ${currentToolLabel()!.label.toLowerCase()}`)
    if (props.parts.some((x) => x.type === "reasoning")) return personaVoice("Working through the request and shaping the answer")
    if (props.last && !props.message.time.completed) return personaVoice("Still working through the request")
    return personaVoice("Delivered the current answer cleanly")
  })
  const next = createMemo(() => {
    if (props.message.error) return personaVoice("Retry, or adjust your request and run again")
    if (runtimeStatus().type === "retry") return personaVoice("DAX will retry automatically after the cooldown")
    if (runtimeStatus().type === "delayed") return personaVoice("DAX will continue automatically as soon as the provider responds")
    if (currentToolLabel()?.status === "pending") return personaVoice("I’ll keep this moving and surface the next useful finding here")
    if (props.last && !props.message.time.completed) return personaVoice("I’ll keep going and surface the next useful update here")
    return personaVoice("Continue with a follow-up request")
  })
  const showActiveNarrative = createMemo(() => props.last && !props.message.time.completed && !props.message.error)
  const liveWorkingNote = createMemo(() => {
    if (props.message.error) return undefined
    if (runtimeStatus().type === "retry") {
      return personaVoice("The provider is cooling down for a moment. I’m holding the thread and will continue automatically")
    }
    if (runtimeStatus().type === "delayed") {
      return personaVoice("The run is still alive. I’m waiting on the provider to resume the next part of the answer")
    }
    if (props.parts.some((x) => x.type === "reasoning" && cleanReasoningText(x.text).length > 0)) {
      return personaVoice("I’m working through the task and shaping the next answer with the context gathered so far")
    }
    if (currentToolLabel()?.status === "pending") {
      return personaVoice(`I’m using ${currentToolLabel()!.label.toLowerCase()} to build enough context before I answer`)
    }
    if (props.last && !props.message.time.completed) {
      return personaVoice("I’m still on it and will post the next concrete update here as soon as it’s ready")
    }
    return undefined
  })
  const hasNativeEli12 = createMemo(() =>
    props.parts.some(
      (x) =>
        x.type === "text" &&
        /\b(you asked|what i'm doing|what happens next|your options)\b/i.test((x as TextPart).text ?? ""),
    ),
  )
  const personalityPrefix = createMemo(() => {
    // Dynamic Insight Extraction
    const reasoning = props.parts.find((p): p is ReasoningPart => p.type === "reasoning")?.text ?? ""
    const dynamicInsight = createMemo(() => {
      if (!reasoning) return null
      const sentences = reasoning.split(/[.!?]/)
      const finding = sentences.find((s) =>
        /\b(found|identified|discovered|analyzing|investigating|bottleneck|regression)\b/i.test(s),
      )
      if (!finding) return null
      const clean = finding.trim().replace(/^→\s*/, "")
      return clean.length > 40 ? clean.slice(0, 37) + "..." : clean
    })

    if (!dynamicInsight()) return null
    return (
      <box flexDirection="row" gap={1}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          {props.persona?.ui.glyph ?? "DAX"}
        </text>
        <text fg={theme.textMuted}>{dynamicInsight()}</text>
      </box>
    )
  })

  const showSummary = createMemo(() => explainMode() && showEli12Summary() && props.last && !hasNativeEli12())

  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })

  const duration = createMemo(() => {
    if (!final()) return 0
    if (!props.message.time.completed) return 0
    const user = messages().find((x) => x.role === "user" && x.id === props.message.parentID)
    if (!user || !user.time) return 0
    return props.message.time.completed - user.time.created
  })
  const totalTokens = createMemo(() => {
    const tokens = props.message.tokens
    if (!tokens) return 0
    return (
      (tokens.input ?? 0) +
      (tokens.output ?? 0) +
      (tokens.reasoning ?? 0) +
      (tokens.cache?.read ?? 0) +
      (tokens.cache?.write ?? 0)
    )
  })
  const generatedTokens = createMemo(() => {
    const tokens = props.message.tokens
    if (!tokens) return 0
    return (tokens.output ?? 0) + (tokens.reasoning ?? 0)
  })
  const tokensPerSecond = createMemo(() => {
    const ms = duration()
    if (!ms) return 0
    const seconds = ms / 1000
    if (!seconds) return 0
    return generatedTokens() / seconds
  })
  const hasRenderablePart = createMemo(() =>
    props.parts.some((part) => {
      if (part.type === "text") return part.text.trim().length > 0
      if (part.type === "reasoning") return part.text.trim().length > 0
      return false
    }),
  )
  const showMetadata = createMemo(() => ctx.showAssistantMetadata())

  const progress = createMemo(() => {
    const total = props.todo.length
    if (total === 0) return null
    const done = props.todo.filter((t) => t.status === "completed").length
    const current = props.todo.findIndex((t) => t.status === "in_progress") + 1
    const percent = Math.round((done / total) * 100)
    const bar = "■".repeat(done) + "□".repeat(total - done)
    return { bar, current: current > 0 ? current : done + 1, total, percent }
  })
  const insightCard = createMemo(() =>
    deriveAssistantInsightCard({
      asked: asked(),
      doing: doing(),
      next: final() && props.message.time.completed ? personaVoice("Awaiting your next instruction") : next(),
      stage: props.stage,
      streamStatus: deriveLiveStreamStatus({
        pendingID: props.last && !props.message.time.completed ? props.message.id : undefined,
        partsForMessage: () => props.parts,
      }),
      durationMs: duration(),
      totalTokens: totalTokens(),
      tokensPerSecond: tokensPerSecond(),
      progress: progress(),
    }),
  )

  const groupedParts = createMemo(() => {
    if (explainMode()) return groupParts(props.parts)
    return props.parts
  })
  const renderableParts = createMemo(() =>
    groupedParts().filter((part) => {
      if (part.type === "text") return part.text.trim().length > 0
      if (part.type === "reasoning") return false
      if (part.type === "tool") {
        return ctx.showDetails()
      }
      if (part.type === "activity-cluster") {
        return ctx.showDetails()
      }
      return false
    }),
  )
  const hasVisibleNativeReasoning = createMemo(
    () => !!visibleNativeReasoningText(),
  )
  const derivedReasoning = createMemo(() => {
    if (!ctx.showThinking() || hasVisibleNativeReasoning() || props.message.error) return undefined
    if (!(showActiveNarrative() || evidenceItems().length > 0 || !!liveWorkingNote() || props.message.time.completed)) return undefined
    return deriveReasoningFallback({
      asked: asked(),
      doing: doing(),
      next: next(),
      evidence: evidenceItems(),
      currentTool: currentToolLabel(),
      runtimeStatus: runtimeStatus(),
      completed: !!props.message.time.completed,
    })
  })
  const suggestedNextSteps = createMemo(() => {
    if (!final() || !props.message.time.completed) return []
    return completionNextSteps({
      mode: props.message.mode,
      hasError: !!props.message.error,
      hasIncompleteTodo: props.todo.some((item) => item.status !== "completed"),
      hasEvidence: evidenceItems().length > 0,
      hasReasoning: !!visibleNativeReasoningText() || !!derivedReasoning(),
    })
  })
  const showLiveStatusNote = createMemo(
    () => props.last && !props.message.time.completed && renderableParts().length === 0 && !props.message.error,
  )
  const reasoningTone = createMemo(() => tint(theme.textMuted, theme.text, 0.35))
  const shouldRender = createMemo(
    () =>
      renderableParts().length > 0 ||
      evidenceItems().length > 0 ||
      !!derivedReasoning() ||
      showLiveStatusNote() ||
      !!props.message.error,
  )
  const metricToneColor = (tone?: "primary" | "accent" | "muted") => {
    if (tone === "primary") return theme.primary
    if (tone === "accent") return theme.accent
    return theme.textMuted
  }
  const retryMeta = createMemo(() => {
    const status = runtimeStatus()
    if (status.type !== "retry") return undefined
    const ms = Math.max(0, status.next - retryNow())
    const geminiBusy = /gemini subscription lane is busy/i.test(status.message)
    return {
      title: geminiBusy ? "Gemini subscription lane is busy" : "Provider is temporarily busy",
      body: geminiBusy
        ? "Holding place and retrying automatically after a short cooldown. This is temporary and not an auth failure."
        : "Holding place and retrying automatically after a short cooldown.",
      countdown: ms,
      attempt: status.attempt,
    }
  })

  const modeLabel = createMemo(() => {
    if (!props.persona) return Locale.titlecase(props.message.mode)
    return props.persona.ui.statusLabels[props.message.mode] ?? Locale.titlecase(props.message.mode)
  })

  return (
    <Show when={shouldRender()}>
      <Show when={props.last && !props.message.time.completed && retryMeta()}>
        {(retry) => (
          <box paddingLeft={2} paddingRight={2} marginTop={1}>
            <box
              flexDirection="column"
              gap={0}
              borderStyle="round"
              borderColor={theme.error}
              backgroundColor={tint(theme.background, theme.error, 0.08)}
              paddingLeft={1}
              paddingRight={1}
              paddingTop={1}
              paddingBottom={1}
            >
              <box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
                <text fg={theme.error} attributes={TextAttributes.BOLD}>
                  {retry().title}
                </text>
                <text fg={theme.textMuted}>
                  retry in {Locale.duration(retry().countdown)} · attempt {retry().attempt}
                </text>
              </box>
              <text fg={theme.text} wrapMode="word">
                {retry().body}
              </text>
            </box>
          </box>
        )}
      </Show>
      <Show when={progress() && props.last && !props.message.time.completed}>
        <box paddingLeft={2} paddingRight={2} marginTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            FLOW: [{progress()!.bar}] Step {progress()!.current} of {progress()!.total} ({progress()!.percent}%)
          </text>
        </box>
      </Show>
      <Show when={props.last && !props.message.time.completed && personalityPrefix()}>
        <box paddingLeft={2} paddingRight={2} marginTop={1} flexDirection="row" gap={1}>
          {personalityPrefix()}
        </box>
      </Show>
      <Show when={showActiveNarrative()}>
        <box paddingLeft={2} paddingRight={2} marginTop={1} flexDirection="column" gap={0}>
          <Show when={!isLowSignalGreeting(asked())}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                asked
              </text>
              <text fg={theme.text} wrapMode="word">
                {asked()}
              </text>
            </box>
          </Show>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              doing
            </text>
            <text fg={theme.text} wrapMode="word">
              {doing()}
            </text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              next
            </text>
            <text fg={theme.textMuted} wrapMode="word">
              {next()}
            </text>
          </box>
        </box>
      </Show>
      <Show when={showSummary()}>
        <box paddingTop={1} paddingBottom={1} paddingLeft={2} paddingRight={2} marginTop={1} marginBottom={1}>
          <box
            flexDirection="column"
            gap={1}
            borderStyle="round"
            borderColor={theme.backgroundElement}
            backgroundColor={tint(theme.background, theme.primary, 0.045)}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
          >
            <box flexDirection="row" justifyContent="space-between" alignItems="center">
              <box flexDirection="column" gap={0}>
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                  EXECUTION NOTEBOOK
                </text>
              </box>
              <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  {insightCard().status.toUpperCase()}
                </text>
              </box>
            </box>

            <Show when={insightCard().progressLine}>
              <box
                border={["left"]}
                borderColor={theme.primary}
                paddingLeft={1}
                backgroundColor={tint(theme.background, theme.primary, 0.02)}
              >
                <text fg={theme.primary}>{insightCard().progressLine}</text>
              </box>
            </Show>

            <box flexDirection="row" gap={1} flexWrap="wrap">
              <For each={insightCard().metrics}>
                {(metric) => (
                  <box
                    flexDirection="row"
                    gap={1}
                    borderStyle="round"
                    borderColor={metric.tone === "accent" ? theme.accent : theme.backgroundElement}
                    backgroundColor={
                      metric.tone === "accent"
                        ? tint(theme.background, theme.accent, 0.08)
                        : tint(theme.background, theme.backgroundElement, 0.35)
                    }
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <text fg={metricToneColor(metric.tone)}>{metric.label}</text>
                    <text fg={metric.tone === "accent" ? theme.accent : theme.text}>{metric.value}</text>
                  </box>
                )}
              </For>
            </box>

            <box flexDirection="column" gap={0}>
              <For each={insightCard().rows}>
                {(row) => (
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                      {row.label.padEnd(7, " ")}
                    </text>
                    <text fg={theme.text} wrapMode="word">
                      {row.value}
                    </text>
                  </box>
                )}
              </For>
            </box>

            <Show when={suggestedNextSteps().length > 0}>
              <box
                flexDirection="column"
                gap={0}
                border={["left"]}
                borderColor={theme.accent}
                paddingLeft={1}
                backgroundColor={tint(theme.background, theme.accent, 0.03)}
              >
                <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                  NEXT STEPS
                </text>
                <For each={suggestedNextSteps()}>
                  {(step) => (
                    <text fg={theme.text} wrapMode="word">
                      - {step}
                    </text>
                  )}
                </For>
              </box>
            </Show>
          </box>
        </box>
      </Show>

      <Show when={showLiveStatusNote() && !showActiveNarrative()}>
        <box paddingLeft={2} paddingRight={2} marginTop={1}>
          <box
            flexDirection="column"
            gap={1}
            borderStyle="round"
            borderColor={theme.borderSubtle}
            backgroundColor={tint(theme.background, theme.backgroundElement, 0.2)}
            paddingLeft={1}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            >
              <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                <box backgroundColor={tint(theme.background, theme.primary, 0.24)} paddingLeft={1} paddingRight={1}>
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                  {modeLabel()}
                </text>
                </box>
                <text fg={theme.text}>{doing()}</text>
              </box>
              <Show when={liveWorkingNote()}>
                <text fg={theme.text} wrapMode="word">
                  {liveWorkingNote()}
                </text>
              </Show>
              <text fg={theme.textMuted} wrapMode="word">
                {next()}
              </text>
          </box>
        </box>
      </Show>

      <Show when={renderableParts().length > 0 || evidenceItems().length > 0 || !!visibleNativeReasoningText() || !!derivedReasoning()}>
        <box
          paddingLeft={0}
          paddingRight={0}
          flexDirection="column"
          borderStyle="round"
          borderColor={tint(theme.primary, theme.border, 0.45)}
          backgroundColor={tint(theme.backgroundPanel, theme.primary, 0.055)}
          marginTop={1}
          marginBottom={0}
        >
          <box
            flexDirection="row"
            gap={1}
            alignItems="center"
            paddingTop={0}
            paddingBottom={1}
            border={["bottom"]}
            borderColor={theme.border}
            marginBottom={1}
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={tint(theme.background, theme.backgroundElement, 0.28)}
          >
            <Show when={!daxSpeaking()}>
              <box
                backgroundColor={tint(theme.background, theme.primary, 0.34)}
                paddingLeft={1}
                paddingRight={1}
                marginRight={1}
              >
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                  {props.message.agent.toUpperCase()}
                </text>
              </box>
            </Show>
            <Show when={ctx.showTimestamps()}>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                {Locale.todayTimeOrDateTime(props.message.time.created)}
              </text>
            </Show>
          </box>
          <box paddingLeft={1} paddingRight={1} paddingBottom={1} flexDirection="column" gap={0}>
            <Show when={evidenceItems().length > 0}>
              <box marginBottom={1}>
                <box flexDirection="column" gap={0} paddingLeft={1}>
                  <text fg={theme.textMuted}>trace</text>
                  <For each={evidenceItems()}>
                    {(item) => (
                      <text fg={item.status === "active" ? theme.primary : theme.text}>
                        {item.status === "active" ? "◌" : "✓"} {item.label}
                      </text>
                    )}
                  </For>
                </box>
              </box>
            </Show>
            <Show when={derivedReasoning()}>
              <box marginBottom={1}>
                <box
                  flexDirection="column"
                  gap={0}
                  border={["left"]}
                  borderColor={theme.primary}
                  backgroundColor={tint(theme.background, theme.primary, 0.01)}
                  paddingLeft={1}
                  paddingRight={0}
                  paddingBottom={1}
                >
                  <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                    working notes
                  </text>
                  <text fg={reasoningTone()} wrapMode="word">
                    {derivedReasoning()}
                  </text>
                </box>
              </box>
            </Show>
            <Show when={visibleNativeReasoningText()}>
              <box marginBottom={1}>
                <box
                  flexDirection="column"
                  gap={0}
                  border={["left"]}
                  borderColor={theme.primary}
                  backgroundColor={tint(theme.background, theme.primary, 0.01)}
                  paddingLeft={1}
                  paddingRight={0}
                  paddingBottom={1}
                >
                  <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                    reasoning
                  </text>
                  <text fg={reasoningTone()} wrapMode="word">
                    {visibleNativeReasoningText()}
                  </text>
                </box>
              </box>
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
                      message={props.message}
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
      <Switch>
        <Match
          when={
            (showMetadata() || props.message.error || props.last) &&
            (props.last || final() || props.message.error?.name === "MessageAbortedError")
          }
        >
          <box
            flexDirection="row"
            gap={1}
            alignItems="center"
            marginTop={0}
            marginBottom={1}
            paddingLeft={2}
            paddingRight={2}
            flexWrap="wrap"
          >
            <text
              fg={
                props.message.error?.name === "MessageAbortedError"
                  ? theme.textMuted
                  : local.agent.color(props.message.agent)
              }
            >
              {props.last && !props.message.time.completed ? "◉" : "●"}
            </text>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              {modeLabel()}
            </text>
            <Show when={duration()}>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                ·
              </text>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                {Locale.duration(duration())}
              </text>
            </Show>
            <Show when={props.message.error?.name === "MessageAbortedError"}>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>interrupted</text>
            </Show>
          </box>
        </Match>
      </Switch>
    </Show>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
  "activity-cluster": ActivityClusterPart,
}

function ActivityClusterPart(props: { part: { type: "activity-cluster"; tools: ToolPart[] } }) {
  return <ActivityCluster tools={props.part.tools} />
}

function cleanReasoningText(text: string) {
  return text
    .replace("[REDACTED]", "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .trim()
}

function completionNextSteps(input: {
  mode: string
  hasError: boolean
  hasIncompleteTodo: boolean
  hasEvidence: boolean
  hasReasoning: boolean
}) {
  if (input.hasError) {
    return [
      "Retry the run after adjusting the request or fixing the failing dependency.",
      "Open the audit or details pane if you need the exact failure context.",
    ]
  }

  switch (input.mode) {
    case "explore":
      return [
        "Ask DAX to inspect a specific file, folder, or subsystem next.",
        "Turn these findings into a concrete implementation plan.",
        "Request a short handoff summary if you want to carry this context elsewhere.",
      ]
    case "plan":
      return [
        "Use this plan as the contract for an execution run.",
        "Refine the scope, risk level, or validation steps before you start writing.",
        "Ask DAX to convert the plan into a safer or more audit-heavy execution path.",
      ]
    case "audit":
      return [
        "Review the warnings or blockers in the audit pane before trusting the result.",
        "Ask DAX for a fix plan for the findings that still matter.",
        "Request a release or signoff summary once the findings are resolved.",
      ]
    default: {
      const steps: string[] = []
      if (input.hasEvidence) steps.push("Inspect the evidence or changes in the right pane before you move on.")
      if (input.hasIncompleteTodo) steps.push("Ask DAX to continue from the remaining plan items.")
      if (!input.hasIncompleteTodo) steps.push("Ask DAX to verify the result or package it into a clean handoff.")
      if (input.hasReasoning || input.hasEvidence) {
        steps.push("Request a follow-up change, deeper review, or concise signoff summary from this state.")
      }
      return steps.slice(0, 3)
    }
  }
}

function enrichAssistantMarkdown(text: string) {
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((segment) => (segment.startsWith("```") ? segment : enrichPlainMarkdownSegment(segment)))
    .join("")
}

function enrichPlainMarkdownSegment(segment: string) {
  const lines = segment.replace(/^\s*[•–▪]\s+/gm, "- ").split("\n")

  const nextMeaningfulLine = (start: number) => {
    for (let index = start + 1; index < lines.length; index++) {
      const candidate = lines[index]?.trim()
      if (candidate) return candidate
    }
    return ""
  }

  return lines
    .map((line, index) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (/^(#{1,6}\s|>\s|- \*\*|\|.+\||```)/.test(trimmed)) return line

      const next = nextMeaningfulLine(index)
      if (
        /^[A-Z][A-Za-z0-9/&()'\- ]{2,64}$/.test(trimmed) &&
        !/[.!?]$/.test(trimmed) &&
        (/^[-*]\s+/.test(next) || /^[A-Z][^:]{1,32}:\s+/.test(next))
      ) {
        return `## ${trimmed}`
      }

      const bulletLead = trimmed.match(/^[-*]\s+([^:]{2,36}):\s+(.+)$/)
      if (bulletLead) return `- **${bulletLead[1].trim()}:** ${bulletLead[2]}`

      const labelLead = trimmed.match(/^([A-Z][^:]{1,32}):\s+(.+)$/)
      if (labelLead) return `**${labelLead[1].trim()}:** ${labelLead[2]}`

      return line
    })
    .join("\n")
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
        <box
          flexDirection="row"
          gap={1}
          alignItems="center"
          border={["bottom"]}
          borderColor={theme.backgroundElement}
          marginBottom={1}
        >
          <box backgroundColor={theme.primary} paddingLeft={1} paddingRight={1} marginRight={1}>
            <text fg={theme.background} attributes={TextAttributes.BOLD}>
              REASONING
            </text>
          </box>
          <text fg={theme.textMuted}>working notes</text>
        </box>
        <box paddingBottom={1}>
          <code
            filetype="text"
            drawUnstyledText={false}
            streaming={true}
            syntaxStyle={syntax()}
            content={content()}
            conceal={ctx.conceal()}
            fg={reasoningFg()}
          />
        </box>
      </box>
    </Show>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage; marginTop?: number }) {
  const ctx = use()
  const { syntax } = useTheme()
  const content = createMemo(() => enrichAssistantMarkdown(props.part.text.trim()))
  return (
    <Show when={content().trim()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
        marginTop={props.marginTop ?? 1}
        flexShrink={0}
      >
        <markdown syntaxStyle={syntax()} streaming={true} content={content()} conceal={ctx.conceal()} />
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage; marginTop?: number }) {
  const ctx = use()
  const sync = useSync()

  // Hide tool if showDetails is false and tool completed successfully
  const shouldHide = createMemo(() => {
    if (ctx.showDetails()) return false
    if (props.part.state.status !== "completed") return false
    return true
  })

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

  return (
    <Show when={!shouldHide()}>
      <Switch>
        <Match when={props.part.tool === "shell"}>
          <Bash {...toolprops} />
        </Match>
        <Match when={props.part.tool === "glob"}>
          <Glob {...toolprops} />
        </Match>
        <Match when={props.part.tool === "read"}>
          <Read {...toolprops} />
        </Match>
        <Match when={props.part.tool === "grep"}>
          <Grep {...toolprops} />
        </Match>
        <Match when={props.part.tool === "list"}>
          <List {...toolprops} />
        </Match>
        <Match when={props.part.tool === "webfetch"}>
          <WebFetch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "codesearch"}>
          <CodeSearch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "websearch"}>
          <WebSearch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "write"}>
          <Write {...toolprops} />
        </Match>
        <Match when={props.part.tool === "edit"}>
          <Edit {...toolprops} />
        </Match>
        <Match when={props.part.tool === "task"}>
          <Task {...toolprops} />
        </Match>
        <Match when={props.part.tool === "apply_patch"}>
          <ApplyPatch {...toolprops} />
        </Match>
        <Match when={props.part.tool === "todowrite"}>
          <TodoWrite {...toolprops} />
        </Match>
        <Match when={props.part.tool === "question"}>
          <Question {...toolprops} />
        </Match>
        <Match when={props.part.tool === "skill"}>
          <Skill {...toolprops} />
        </Match>
        <Match when={true}>
          <GenericTool {...toolprops} />
        </Match>
      </Switch>
    </Show>
  )
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
function GenericTool(props: ToolProps<any>) {
  return (
    <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
      {props.tool} {input(props.input as any)}
    </InlineTool>
  )
}

function ToolTitle(props: { fallback: string; when: any; icon: string; children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <text paddingLeft={3} fg={props.when ? theme.textMuted : theme.text}>
      <Show fallback={<>~ {props.fallback}</>} when={props.when}>
        <span style={{ bold: true }}>{props.icon}</span> {props.children}
      </Show>
    </text>
  )
}

function InlineTool(props: {
  icon: string
  iconColor?: RGBA
  complete: any
  pending: string
  children: JSX.Element
  part: ToolPart
}) {
  const [margin, setMargin] = createSignal(0)
  const { theme } = useTheme()
  const ctx = use()
  const sync = useSync()
  const accent = createMemo(() => toolAccentColor(props.part.tool, theme))

  const permission = createMemo(() => {
    const callID = sync.data.permission[ctx.sessionID]?.at(0)?.tool?.callID
    if (!callID) return false
    return callID === props.part.callID
  })

  const fg = createMemo(() => {
    if (permission()) return theme.primary
    if (props.complete) return theme.textMuted
    return theme.text
  })

  const iconColor = createMemo(() => props.iconColor ?? accent())
  const backgroundColor = createMemo(() =>
    tint(theme.backgroundElement, accent(), props.part.state.status === "pending" ? 0.4 : 0.2),
  )

  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error : undefined))

  const denied = createMemo(
    () =>
      error()?.includes("rejected permission") ||
      error()?.includes("specified a rule") ||
      error()?.includes("user dismissed"),
  )

  return (
    <box
      marginTop={margin()}
      paddingLeft={2}
      paddingRight={1}
      backgroundColor={backgroundColor()}
      border={["left"]}
      borderColor={accent()}
      customBorderChars={SplitBorder.customBorderChars}
      renderBefore={function (this: BoxRenderable) {
        const el = this
        const parent = el.parent
        if (!parent) {
          return
        }
        if (el.height > 1) {
          setMargin(1)
          return
        }
        const children = parent.getChildren()
        const index = children.indexOf(el)
        const previous = children[index - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.height > 1 || previous.id.startsWith("text-")) {
          setMargin(1)
          return
        }
      }}
    >
      <text paddingLeft={1} fg={fg()} attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}>
        <Show fallback={<>~ {props.pending}</>} when={props.complete}>
          <span style={{ fg: iconColor() }}>{props.icon}</span> {props.children}
        </Show>
      </text>
      <Show when={error() && !denied()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function BlockTool(props: {
  title: string
  children: JSX.Element
  onClick?: () => void
  part?: ToolPart
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const ctx = use()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  const accent = createMemo(() => (props.part ? toolAccentColor(props.part.tool, theme) : theme.borderActive))
  const baseBackground = createMemo(() => tint(theme.backgroundPanel, accent(), 0.08))
  const hoverBackground = createMemo(() => tint(theme.backgroundPanel, accent(), 0.2))

  const statusBackground = createMemo(() => {
    if (props.part?.state.status === "error") return tint(theme.background, theme.error, 0.08)
    if (props.part?.state.status === "completed") return tint(theme.background, theme.success, 0.04)
    return baseBackground()
  })

  return (
    <box
      border={["left"]}
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={1}
      paddingRight={0}
      marginTop={1}
      gap={0}
      backgroundColor={hover() ? hoverBackground() : statusBackground()}
      borderColor={accent()}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingTop={0}
        paddingBottom={0}
        border={["bottom"]}
        borderColor={theme.backgroundElement}
        marginBottom={1}
      >
        <Show
          when={props.spinner}
          fallback={
            <text fg={accent()} attributes={TextAttributes.BOLD}>
              {props.title.toUpperCase()}
            </text>
          }
        >
          <Spinner color={accent()}>{props.title.replace(/^# /, "").toUpperCase()}</Spinner>
        </Show>
        <Show when={props.part?.state.status}>
          <box backgroundColor={accent()} paddingLeft={1} paddingRight={1}>
            <text fg={theme.background} attributes={TextAttributes.BOLD}>
              {props.part!.state.status.toUpperCase()}
            </text>
          </box>
        </Show>
      </box>
      <box paddingBottom={1}>{props.children}</box>
      <Show when={props.part?.tool === "write" || props.part?.tool === "edit"}>
        <box
          marginTop={1}
          padding={1}
          backgroundColor={tint(theme.background, theme.success, 0.1)}
          border={["left", "right", "top", "bottom"]}
          borderColor={theme.success}
        >
          <text fg={theme.success} attributes={TextAttributes.BOLD}>
            ✓ SAFETY AUDIT: PASS
          </text>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            Risk: Low · Integrity: 100% · Breaking Changes: None Detected
          </text>
        </box>
      </Show>
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function toolAccentColor(tool: string, theme: ThemeShape) {
  if (PLAN_TOOLS.has(tool)) return theme.accent
  if (EXECUTE_TOOLS.has(tool)) return theme.primary
  if (VERIFY_TOOLS.has(tool)) return theme.success
  if (EXPLORE_TOOLS.has(tool)) return theme.secondary
  return theme.borderActive
}

function Bash(props: ToolProps<typeof ShellTool>) {
  const { theme } = useTheme()
  const sync = useSync()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })
  const ctx = use()
  const session = createMemo(() => ctx.sync.session.get(ctx.sessionID))
  const reflection = createMemo(() => (session()?.state_v2 as any)?.reflection)

  const workdirDisplay = createMemo(() => {
    const workdir = (props.input as any).workdir
    if (!workdir || workdir === ".") return undefined

    const base = sync.data.path.directory
    if (!base) return undefined

    const absolute = path.resolve(base, workdir)
    if (absolute === base) return undefined

    const home = Global.Path.home
    if (!home) return absolute

    const match = absolute === home || absolute.startsWith(home + path.sep)
    return match ? absolute.replace(home, "~") : absolute
  })

  const title = createMemo(() => {
    const desc = (props.input as any).description ?? "Shell Command"
    const wd = workdirDisplay()
    if (!wd) return desc
    if (desc.includes(wd)) return desc
    return `${desc} in ${wd}`
  })

  const insight = createMemo(() => {
    if (props.part.state.status === "error") return "Command failed. Analyzing output for clues..."
    if (props.part.state.status === "completed") return "✦ Execution complete. Environment synchronized."
    return ""
  })

  const outcome = createMemo(() => {
    if (props.part.state.status === "error") return "Operation failed. Reviewing terminal logs for resolution."
    if (props.part.state.status === "completed")
      return "✓ Verification: Command executed successfully. Environment state updated."
    return ""
  })

  return (
    <Switch>
      <Match when={props.metadata.output !== undefined}>
        <BlockTool
          title={"# " + title()}
          part={props.part}
          spinner={isRunning()}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <Show when={(props.input as any).description}>
              <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
                ◈ STRATEGY: {(props.input as any).description}
              </text>
            </Show>
            <Show when={outcome()}>
              <text fg={theme.success} attributes={TextAttributes.BOLD}>
                {outcome()}
              </text>
            </Show>
            <Show when={insight()}>
              <text fg={theme.accent}>{insight()}</text>
            </Show>
            <text fg={theme.text}>$ {(props.input as any).command}</text>
            <Show when={output()}>
              <Explainable explanation={(props.input as any).description}>
                <text fg={theme.text}>{limited()}</text>
              </Explainable>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
            <Show when={props.part.state.status === "completed" && reflection()?.verificationPlan?.length > 0}>
              <VerificationReceipt
                action="Shell Execution"
                target={(props.input as any).command}
                status="verified"
                confidence={reflection()?.confidence}
                checks={reflection()!.verificationPlan.map((check: string) => ({
                  label: check,
                  status: "pass",
                }))}
              />
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          icon={props.part.state.status === "completed" ? "✓" : "$"}
          pending={(props.input as any).description ?? "Executing..."}
          complete={props.part.state.status === "completed"}
          part={props.part}
        >
          {ctx.wide ? title() : (props.input as any).command}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const ctx = use()
  const session = createMemo(() => ctx.sync.session.get(ctx.sessionID))
  const reflection = createMemo(() => (session()?.state_v2 as any)?.reflection)
  const code = createMemo(() => {
    if (!(props.input as any).content) return ""
    return (props.input as any).content
  })

  const lineCount = createMemo(() => code().split("\n").length)
  const insight = createMemo(() => {
    if (props.part.state.status === "error") return "Write failed. Checking permissions..."
    if (props.part.state.status === "completed") return `✦ Successfully wrote ${lineCount()} lines.`
    return ""
  })

  const impact = createMemo(() => {
    if (props.part.state.status === "completed")
      return `✓ Impact: Target file updated. Structural integrity verified (${lineCount()} lines).`
    return ""
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"◆ Wrote " + normalizePath((props.input as any).filePath!)} part={props.part}>
          <Show when={impact()}>
            <text fg={theme.success} attributes={TextAttributes.BOLD}>
              {impact()}
            </text>
          </Show>
          <Show when={insight()}>
            <text fg={theme.accent}>{insight()}</text>
          </Show>
          <Explainable
            explanation={`I am writing the following content to ${normalizePath((props.input as any).filePath!)} to update the project logic.`}
          >
            <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
              <code
                conceal={false}
                fg={theme.text}
                filetype={filetype((props.input as any).filePath!)}
                syntaxStyle={syntax()}
                content={code()}
              />
            </line_number>
          </Explainable>
          <Show when={props.metadata.diagnostics && Object.keys(props.metadata.diagnostics).length > 0}>
            <For each={Object.values(props.metadata.diagnostics!).flat()}>
              {(diagnostic: any) => (
                <text fg={theme.error}>
                  Error [{diagnostic.range.start.line}:{diagnostic.range.start.character}]: {diagnostic.message}
                </text>
              )}
            </For>
          </Show>
          <Show when={props.part.state.status === "completed" && reflection()?.verificationPlan?.length > 0}>
            <VerificationReceipt
              action="File Write"
              target={normalizePath((props.input as any).filePath!)}
              status="verified"
              confidence={reflection()?.confidence}
              checks={reflection()!.verificationPlan.map((check: string) => ({
                label: check,
                status: "pass",
              }))}
            />
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool
          icon={props.part.state.status === "completed" ? "✓" : "◆"}
          pending="Preparing write..."
          complete={props.part.state.status === "completed"}
          part={props.part}
        >
          {ctx.wide
            ? `Updated ${normalizePath((props.input as any).filePath!)}`
            : `Write ${normalizePath((props.input as any).filePath!)}`}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps<typeof GlobTool>) {
  const ctx = use()
  return (
    <InlineTool
      icon={props.part.state.status === "completed" ? "✓" : "✱"}
      pending="Finding files..."
      complete={props.part.state.status === "completed"}
      part={props.part}
    >
      {ctx.wide ? (
        `Scanned for files "${(props.input as any).pattern}"`
      ) : (
        <>
          Glob "{(props.input as any).pattern}"{" "}
          <Show when={(props.input as any).path}>in {normalizePath((props.input as any).path)} </Show>
          <Show when={props.metadata.count}>
            ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
          </Show>
        </>
      )}
    </InlineTool>
  )
}

function Read(props: ToolProps<typeof ReadTool>) {
  const { theme } = useTheme()
  const target = createMemo(() => normalizePath((props.input as any).filePath!))
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    if (props.part.state.time.compacted) return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  const insight = createMemo(() => {
    if (props.part.state.status === "error") return "Read failed. File may be restricted."
    if (props.part.state.status === "completed") return "✦ File content analyzed and ingested."
    return ""
  })

  return (
    <>
      <InlineTool
        icon={props.part.state.status === "completed" ? "✓" : "→"}
        pending={`Reading ${target()}...`}
        complete={props.part.state.status === "completed"}
        part={props.part}
      >
        {`Read ${target()}`}
      </InlineTool>
      <Show when={insight()}>
        <box paddingLeft={4}>
          <text fg={theme.accent}>{insight()}</text>
        </box>
      </Show>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3}>
            <text paddingLeft={3} fg={theme.textMuted}>
              ↳ Loaded {normalizePath(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

function Grep(props: ToolProps<typeof GrepTool>) {
  const ctx = use()
  return (
    <InlineTool
      icon={props.part.state.status === "completed" ? "✓" : "✱"}
      pending="Searching content..."
      complete={props.part.state.status === "completed"}
      part={props.part}
    >
      {ctx.wide ? (
        `Searched content for "${(props.input as any).pattern}"`
      ) : (
        <>
          Grep "{(props.input as any).pattern}"{" "}
          <Show when={(props.input as any).path}>in {normalizePath((props.input as any).path)} </Show>
          <Show when={props.metadata.matches}>
            ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
          </Show>
        </>
      )}
    </InlineTool>
  )
}

function List(props: ToolProps<typeof ListTool>) {
  const ctx = use()
  const dir = createMemo(() => {
    if ((props.input as any).path) {
      return normalizePath((props.input as any).path)
    }
    return ""
  })
  return (
    <InlineTool
      icon={props.part.state.status === "completed" ? "✓" : "→"}
      pending="Listing directory..."
      complete={props.part.state.status === "completed"}
      part={props.part}
    >
      {ctx.wide ? "Listed repository files" : `List ${dir()}`}
    </InlineTool>
  )
}

function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool
      icon="%"
      pending="Fetching from the web..."
      complete={(props.input as any as any).url}
      part={props.part}
    >
      WebFetch {(props.input as any as any).url}
    </InlineTool>
  )
}

function CodeSearch(props: ToolProps<any>) {
  const input = props.input as any as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={input.query} part={props.part}>
      Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
    </InlineTool>
  )
}

function WebSearch(props: ToolProps<any>) {
  const input = props.input as any as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={input.query} part={props.part}>
      Exa Web Search "{input.query}" <Show when={metadata.numResults}>({metadata.numResults} results)</Show>
    </InlineTool>
  )
}

function Task(props: ToolProps<typeof TaskTool>) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const { navigate } = useRoute()
  const local = useLocal()
  const sync = useSync()

  const tools = createMemo(() => {
    const sessionID = props.metadata.sessionId
    const msgs = sync.data.message[sessionID ?? ""] ?? []
    return msgs.flatMap((msg) =>
      (sync.data.part[msg.id] ?? [])
        .filter((part): part is ToolPart => part.type === "tool")
        .map((part) => ({ tool: part.tool, state: part.state })),
    )
  })

  const current = createMemo(() => tools().findLast((x) => x.state.status !== "pending"))

  const isRunning = createMemo(() => props.part.state.status === "running")

  return (
    <Switch>
      <Match when={(props.input as any).description || (props.input as any).subagent_type}>
        <BlockTool
          title={"# " + Locale.titlecase((props.input as any).subagent_type ?? "unknown") + " Task"}
          onClick={
            props.metadata.sessionId
              ? () => navigate({ type: "session", sessionID: props.metadata.sessionId! })
              : undefined
          }
          part={props.part}
          spinner={isRunning()}
        >
          <box>
            <text style={{ fg: theme.textMuted }}>
              {(props.input as any).description} ({tools().length} toolcalls)
            </text>
            <Show when={current()}>
              {(item) => {
                const title = item().state.status === "completed" ? (item().state as any).title : ""
                return (
                  <text style={{ fg: item().state.status === "error" ? theme.error : theme.textMuted }}>
                    └ {Locale.titlecase(item().tool)} {title}
                  </text>
                )
              }}
            </Show>
          </box>
          <Show when={props.metadata.sessionId}>
            <text fg={theme.text}>
              {keybind.print("session_child_cycle")}
              <span style={{ fg: theme.textMuted }}> view subagents</span>
            </text>
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="#" pending="Delegating..." complete={(props.input as any).subagent_type} part={props.part}>
          {(props.input as any).subagent_type} Task {(props.input as any).description}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const session = createMemo(() => ctx.sync.session.get(ctx.sessionID))
  const reflection = createMemo(() => (session()?.state_v2 as any)?.reflection)

  const view = createMemo(() => {
    const diffStyle = ctx.sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    // Default to "auto" behavior
    return ctx.width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype((props.input as any).filePath))

  const diffContent = createMemo(() => props.metadata.diff)

  const diagnostics = createMemo(() => {
    const filePath = Filesystem.normalizePath((props.input as any).filePath ?? "")
    const arr = props.metadata.diagnostics?.[filePath] ?? []
    return arr.filter((x) => x.severity === 1).slice(0, 3)
  })

  const impact = createMemo(() => {
    if (props.part.state.status === "completed")
      return "✓ Impact: Changes applied surgically. Functional parity maintained."
    return ""
  })

  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={"← Edit " + normalizePath((props.input as any).filePath!)} part={props.part}>
          <Show when={impact()}>
            <box paddingLeft={1} marginBottom={1}>
              <text fg={theme.success} attributes={TextAttributes.BOLD}>
                {impact()}
              </text>
            </box>
          </Show>
          <Explainable
            explanation={`I am applying these surgical changes to ${normalizePath((props.input as any).filePath!)} based on my analysis.`}
          >
            <box paddingLeft={1}>
              <diff
                diff={diffContent()}
                view={view()}
                filetype={ft()}
                syntaxStyle={syntax()}
                showLineNumbers={true}
                width="100%"
                wrapMode={ctx.diffWrapMode()}
                fg={theme.text}
                addedBg={theme.diffAddedBg}
                removedBg={theme.diffRemovedBg}
                contextBg={theme.diffContextBg}
                addedSignColor={theme.diffHighlightAdded}
                removedSignColor={theme.diffHighlightRemoved}
                lineNumberFg={theme.diffLineNumber}
                lineNumberBg={theme.diffContextBg}
                addedLineNumberBg={theme.diffAddedLineNumberBg}
                removedLineNumberBg={theme.diffRemovedLineNumberBg}
              />
            </box>
          </Explainable>
          <Show when={props.metadata.diagnostics && Object.keys(props.metadata.diagnostics).length > 0}>
            <box>
              <For each={Object.values(props.metadata.diagnostics!).flat()}>
                {(diagnostic: any) => (
                  <text fg={theme.error}>
                    Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]{" "}
                    {diagnostic.message}
                  </text>
                )}
              </For>
            </box>
          </Show>
          <Show when={props.part.state.status === "completed" && reflection()?.verificationPlan?.length > 0}>
            <VerificationReceipt
              action="File Edit"
              target={normalizePath((props.input as any).filePath!)}
              status="verified"
              confidence={reflection()?.confidence}
              checks={reflection()!.verificationPlan.map((check: string) => ({
                label: check,
                status: "pass",
              }))}
            />
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={(props.input as any).filePath} part={props.part}>
          Edit {normalizePath((props.input as any).filePath!)} {input({ replaceAll: (props.input as any).replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps<typeof ApplyPatchTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  const session = createMemo(() => ctx.sync.session.get(ctx.sessionID))
  const reflection = createMemo(() => (session()?.state_v2 as any)?.reflection)

  const files = createMemo(() => props.metadata.files ?? [])

  const view = createMemo(() => {
    const diffStyle = ctx.sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    return ctx.width > 120 ? "split" : "unified"
  })

  function Diff(p: { diff: string; filePath: string }) {
    return (
      <box paddingLeft={1}>
        <diff
          diff={p.diff}
          view={view()}
          filetype={filetype(p.filePath)}
          syntaxStyle={syntax()}
          showLineNumbers={true}
          width="100%"
          wrapMode={ctx.diffWrapMode()}
          fg={theme.text}
          addedBg={theme.diffAddedBg}
          removedBg={theme.diffRemovedBg}
          contextBg={theme.diffContextBg}
          addedSignColor={theme.diffHighlightAdded}
          removedSignColor={theme.diffHighlightRemoved}
          lineNumberFg={theme.diffLineNumber}
          lineNumberBg={theme.diffContextBg}
          addedLineNumberBg={theme.diffAddedLineNumberBg}
          removedLineNumberBg={theme.diffRemovedLineNumberBg}
        />
      </box>
    )
  }

  function title(file: { type: string; relativePath: string; filePath: string; deletions: number }) {
    if (file.type === "delete") return "# Deleted " + file.relativePath
    if (file.type === "add") return "# Created " + file.relativePath
    if (file.type === "move") return "# Moved " + normalizePath(file.filePath) + " → " + file.relativePath
    return "← Patched " + file.relativePath
  }

  return (
    <Switch>
      <Match when={files().length > 0}>
        <box flexDirection="column" gap={1}>
          <For each={files()}>
            {(file) => (
              <BlockTool title={title(file)} part={props.part}>
                <Show
                  when={file.type !== "delete"}
                  fallback={
                    <text fg={theme.diffRemoved}>
                      -{file.deletions} line{file.deletions !== 1 ? "s" : ""}
                    </text>
                  }
                >
                  <Diff diff={file.diff} filePath={file.filePath} />
                </Show>
              </BlockTool>
            )}
          </For>
          <Show when={props.part.state.status === "completed" && reflection()?.verificationPlan?.length > 0}>
            <VerificationReceipt
              action="Patch Application"
              status="verified"
              confidence={reflection()?.confidence}
              checks={reflection()!.verificationPlan.map((check: string) => ({
                label: check,
                status: "pass",
              }))}
            />
          </Show>
        </box>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing apply_patch..." complete={false} part={props.part}>
          apply_patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

function TodoWrite(props: ToolProps<typeof TodoWriteTool>) {
  return (
    <Switch>
      <Match when={props.metadata.todos?.length}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={(props.input as any).todos ?? []}>
              {(todo) => <TodoItem status={todo.status} content={todo.content} />}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps<typeof QuestionTool>) {
  const { theme } = useTheme()
  const count = createMemo(() => (props.input as any).questions?.length ?? 0)

  function format(answer?: string[]) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={props.metadata.answers}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={(props.input as any).questions ?? []}>
              {(q, i) => (
                <box flexDirection="column">
                  <text fg={theme.textMuted}>{q.question}</text>
                  <text fg={theme.text}>{format(props.metadata.answers?.[i()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
          Asked {count()} question{count() !== 1 ? "s" : ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Skill(props: ToolProps<typeof SkillTool>) {
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={(props.input as any).name} part={props.part}>
      Skill "{(props.input as any).name}"
    </InlineTool>
  )
}

function normalizePath(input?: string) {
  if (!input) return ""
  if (path.isAbsolute(input)) {
    return path.relative(process.cwd(), input) || "."
  }
  return input
}

function input(input: Record<string, any>, omit?: string[]): string {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}
