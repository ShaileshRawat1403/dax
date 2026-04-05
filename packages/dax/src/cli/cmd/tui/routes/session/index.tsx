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
import { deriveWorkstationState, type WorkstationState } from "@/dax/presentation/workstation"
import {
  deriveAssistantInsightCard,
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

type GroupedPart = Part | { type: "activity-cluster"; tools: ToolPart[] } | { type: "context-group"; tools: ToolPart[] }

const CONTEXT_GROUP_TOOLS = new Set(["read", "glob", "grep", "list", "webfetch", "websearch", "codesearch"])
const HIDDEN_TOOLS = new Set(["todowrite"])
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
const MUTATION_INTENT_RE =
  /\b(create|add|edit|update|change|fix|delete|remove|rename|move|install|run|execute|patch|write|commit|push|release|publish)\b/i

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

  const [personaId, setPersonaId] = kv.signal<string>(DAX_SETTING.session_persona, "zen")
  const activePersona = createMemo(() => getPersona(personaId()))
  const cyclePersona = () => {
    const ids = Object.keys(PERSONAS)
    const next = ids[(ids.indexOf(personaId()) + 1) % ids.length]!
    setPersonaId(() => next)
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
        return [
          {
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
          },
        ]
      }
      if (event.type === "intervention.resolved") {
        return [
          {
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
          },
        ]
      }
      return []
    })
  })

  const interventions = createMemo(() => buildInterventionProjection(projectedLifecycleEvents()))

  const permissions = createMemo(() => {
    if (!session() || session()?.parentID) return []
    const legacy = children().flatMap((x) => sync.data.permission[x.id] ?? [])
    const modern = children().flatMap((x) =>
      (sync.data.approvals[x.id] ?? []).filter((a) => (a.type as string) !== "question"),
    )
    return modern.length > 0 ? (modern as any) : legacy
  })

  const projectedApprovalRecords = createMemo(() => {
    if (route.sessionID && (sync.data.approvals[route.sessionID]?.length ?? 0) > 0)
      return sync.data.approvals[route.sessionID] ?? []
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
      ...lifecycle().map((l) => ({
        type: "lifecycle" as const,
        id: l.timestamp + l.type,
        timestamp: new Date(l.timestamp).getTime(),
        data: l,
      })),
    ]
    return combined.toSorted((a, b) => a.timestamp - b.timestamp)
  })

  const currentRun = createMemo(() => {
    const events = lifecycle()
    const stateEvent = events.findLast((e) => e.type === "run.state_changed")
    return stateEvent?.properties
  })

  const currentStep = createMemo(() => {
    const events = lifecycle()
    const stepEvent = events.findLast((e) => e.type === "plan.step_promoted")
    return stepEvent?.properties
  })

  const modernTrust = createMemo(() => {
    const events = lifecycle()
    const auditEvent = events.findLast((e) => e.type === "audit.posture_updated")
    return auditEvent?.properties?.trust
  })

  const questions = createMemo(() => {
    if (!session() || session()?.parentID) return []
    const legacy = children().flatMap((x) => sync.data.question[x.id] ?? [])
    const modern = children().flatMap((x) =>
      (sync.data.approvals[x.id] ?? []).filter((a) => (a.type as string) === "question"),
    )
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
  // TODO: slowStream setting is defined but not used anywhere - implement or remove
  const [slowStream, setSlowStream] = kv.signal(DAX_SETTING.session_stream_slow, true)
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
  const stageReasonText = createMemo(() => displayStageState().reason)

  const doing = createMemo(() => {
    const stage = displayStageState().stage
    const reason = displayStageState().reason
    if (stage === "done") return "Finished"
    if (stage === "waiting") return "Awaiting input"
    if (stage === "retrying") return "Retrying"
    if (!reason || isLowSignalStageReason(reason)) return stageLabel()
    return reason
  })

  const next = createMemo(() => {
    const stage = displayStageState().stage
    if (stage === "done") return "Ready for next request"
    if (stage === "waiting") return "Please review the approval or question"
    const nextIdx = PRIMARY_STAGE_FLOW.indexOf(stage) + 1
    const nextStage = PRIMARY_STAGE_FLOW[nextIdx]
    if (!nextStage) return ""
    return `Next: ${labelStage(nextStage, explainMode()).toLowerCase()}`
  })

  const showActiveNarrative = createMemo(() => chatActive() || !session()?.parentID)
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

  const [smartFollowActive, setSmartFollowActive] = createSignal(true)

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
  const followEnabled = createMemo(() => paneFollowMode() === "live" || smartFollowActive())

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
    const audit = latestAudit()?.result
    const art = (sync.data as any).session_artifact?.[route.sessionID] ?? []

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

  const liveRailHint = createMemo(() =>
    deriveAssistantInsightCard({
      asked: workstationState().goal || "Working...",
      doing: doing(),
      next: next(),
      stage: workstationState().lifecycleLabel,
      streamStatus: streamStatus(),
      durationMs: 0,
      totalTokens: 0,
      tokensPerSecond: 0,
      progress: undefined,
    }),
  )

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

  const hasDiffNeed = createMemo(() => proposedChanges().length > 0 || workstationState().artifactSummary.count > 0)
  const hasApprovalsNeed = createMemo(() => activeInterventions().length > 0)
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

  const scrollNarrative = () => {
    if (!narrativeScroll) return
    try {
      narrativeScroll.scrollTo(narrativeScroll.scrollHeight)
    } catch {
      // Keep rendering resilient if scrollbox metrics are transiently unavailable.
    }
  }

  const [lastMessageCount, setLastMessageCount] = createSignal(0)
  createEffect(() => {
    const count = narrative().length
    if (count !== lastMessageCount()) {
      setLastMessageCount(count)
      scrollNarrative()
    }
  })

  const [lastActivityAt, setLastActivityAt] = createSignal(Date.now())
  createEffect(() => {
    const reason = stageReasonText()
    if (reason) {
      setLastActivityAt(Date.now())
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

  const renderer = useRenderer()
  const keyboard = useKeyboard(() => {})

  const openTimeline = () => {
    setPaneMode(() => "plan")
    setPaneVisibility(() => "pinned")
  }

  const openPmPane = () => {
    setPaneMode(() => "memory")
    setPaneVisibility(() => "pinned")
  }

  const selectPaneMode = (mode: PaneMode) => {
    setPaneMode(() => mode)
    setPaneVisibility(() => "pinned")
    setSmartFollowActive(false)
  }

  const showPane = createMemo(() => {
    const stage = displayStageState().stage
    return shouldShowWorkstationPane({
      displayMode: displayMode(),
      paneVisibility: paneVisibility(),
      hasCriticalIntervention: hasApprovalsNeed(),
      isRuntimeCritical: sessionStatusType() === "busy" || stage === "executing" || stage === "verifying",
    })
  })

  createEffect(() => {
    if (paneVisibility() !== "hidden") return
    const stage = displayStageState().stage
    const shouldRecover =
      hasApprovalsNeed() || sessionStatusType() === "busy" || stage === "executing" || stage === "verifying"
    if (shouldRecover) {
      setPaneVisibility(() => "auto")
    }
  })

  const priorityPaneMode = createMemo<PaneMode>(() => {
    if (hasApprovalsNeed()) return "approvals"
    if (proposedChanges().length > 0) return "diff"
    return "plan"
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
      paneMode: paneMode(),
      paneVisibility: paneVisibility(),
      paneFollowMode: paneFollowMode(),
      smartFollowActive: smartFollowActive(),
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
      () => void refreshMemorySnapshot(),
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
      case "diff":
        return proposedChanges().length || undefined
      case "audit":
        return workstationState().auditSummary.findingsCount || undefined
      default:
        return undefined
    }
  }

  const liveWorkingNote = createMemo(() => {
    const reason = stageReasonText()
    if (!reason || isLowSignalStageReason(reason)) return undefined
    return reason
  })

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
          busy={sessionStatusType() === "busy"}
          actions={[
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
              <Show when={narrative().length === 0}>
                <box
                  paddingLeft={2}
                  paddingRight={2}
                  paddingTop={1}
                  paddingBottom={1}
                  borderStyle="round"
                  borderColor={theme.borderSubtle}
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
              <For each={narrative()}>
                {(item, index) => (
                  <Show when={item.type === "message"}>
                    <Message message={item.data} last={index() === narrative().length - 1} />
                  </Show>
                )}
              </For>

              <Show when={showLiveStatusNote() && !showActiveNarrative() && !showPane()}>
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
                      <box
                        backgroundColor={tint(theme.background, theme.primary, 0.24)}
                        paddingLeft={1}
                        paddingRight={1}
                      >
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
            </box>
          </scrollbox>

          {/* Right Side Workstation Pane */}
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
                  <Match when={activePaneMode() === "diff"}>
                    <Show
                      when={hasDiffNeed()}
                      fallback={<text fg={theme.textMuted}>No active diff or proposed changes for this turn.</text>}
                    >
                      <box flexDirection="column" gap={1} flexGrow={1} width="100%">
                        <Show when={proposedChanges().length > 0}>
                          <box flexDirection="column" gap={0} marginBottom={1}>
                            <text fg={theme.primary} bold>
                              PROPOSED CHANGES
                            </text>
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
                                  <text
                                    fg={selectedProposedChangeId() === change.changeId ? theme.primary : theme.text}
                                  >
                                    {selectedProposedChangeId() === change.changeId ? ">" : " "} {change.filePath}
                                  </text>
                                  <text fg={proposedChangeStatusColor(change.status)}>
                                    {proposedChangeStatusLabel(change.status)}
                                  </text>
                                </box>
                              )}
                            </For>
                          </box>
                        </Show>
                        <box flexGrow={1} border={["top"]} borderColor={theme.borderSubtle} paddingTop={1} width="100%">
                          <scrollbox flexGrow={1} scrollAcceleration={scrollAcceleration()}>
                            <diff
                              diff={selectedProposedChange()?.diff ?? ""}
                              view={paneDiffView()}
                              filetype={filetype(selectedProposedChange()?.filePath)}
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
                        <text fg={theme.textMuted}>Production control plane</text>
                      </box>
                      <Show
                        when={
                          !!workstationState().goal ||
                          !!workstationState().currentStep ||
                          workstationState().lifecycle !== "ready"
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
                            <text fg={theme.text}>Standby.</text>
                            <text fg={theme.textMuted}>State will populate when a run starts.</text>
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
                          {/* 1. Status Section */}
                          <box
                            flexDirection="row"
                            gap={1}
                            flexWrap="wrap"
                            padding={1}
                            backgroundColor={theme.backgroundElement}
                            border={["round"]}
                            borderColor={theme.borderSubtle}
                          >
                            <Show when={sessionStatusType() === "busy"}>
                              <box backgroundColor={theme.accent} paddingLeft={1} paddingRight={1} marginRight={1}>
                                <text fg={theme.background} bold>
                                  LIVE
                                </text>
                              </box>
                            </Show>
                            <box
                              backgroundColor={
                                workstationState().lifecycle === "blocked" || workstationState().lifecycle === "failed"
                                  ? tint(theme.background, theme.error, 0.18)
                                  : workstationState().lifecycle === "awaiting_approval"
                                    ? tint(theme.background, theme.warning, 0.18)
                                    : workstationState().lifecycle === "completed"
                                      ? tint(theme.background, theme.success, 0.18)
                                      : tint(theme.background, theme.primary, 0.18)
                              }
                              border={["round"]}
                              borderColor={
                                workstationState().lifecycle === "blocked" || workstationState().lifecycle === "failed"
                                  ? theme.error
                                  : workstationState().lifecycle === "awaiting_approval"
                                    ? theme.warning
                                    : workstationState().lifecycle === "completed"
                                      ? theme.success
                                      : theme.primary
                              }
                              paddingLeft={1}
                              paddingRight={1}
                            >
                              <text
                                fg={
                                  workstationState().lifecycle === "blocked" ||
                                  workstationState().lifecycle === "failed"
                                    ? theme.error
                                    : workstationState().lifecycle === "awaiting_approval"
                                      ? theme.warning
                                      : workstationState().lifecycle === "completed"
                                        ? theme.success
                                        : theme.primary
                                }
                                bold
                              >
                                STATUS: {workstationState().lifecycleLabel.toUpperCase()}
                              </text>
                            </box>
                            <Show when={workstationState().trustPosture !== "clear"}>
                              <box
                                backgroundColor={theme.backgroundElement}
                                border={["round"]}
                                borderColor={
                                  workstationState().trustPosture === "blocked" ? theme.error : theme.warning
                                }
                                paddingLeft={1}
                                paddingRight={1}
                              >
                                <text fg={workstationState().trustPosture === "blocked" ? theme.error : theme.warning}>
                                  TRUST: {workstationState().trustLabel.toUpperCase()}
                                </text>
                              </box>
                            </Show>
                          </box>

                          {/* 2. Blocked / Review Details */}
                          <Show when={activeInterventions().length > 0}>
                            <box
                              flexDirection="column"
                              gap={0}
                              padding={1}
                              backgroundColor={tint(theme.backgroundElement, theme.error, 0.07)}
                              border={["round"]}
                              borderColor={theme.error}
                            >
                              <text fg={theme.error} bold>
                                WHY BLOCKED
                              </text>
                              <For each={activeInterventions().slice(0, 3)}>
                                {(item) => (
                                  <box flexDirection="column" gap={0} paddingTop={1}>
                                    <text fg={theme.text}>! {interventionKindLabel(item.kind)}</text>
                                    <text fg={theme.textMuted} wrapMode="word">
                                      {item.reason}
                                    </text>
                                  </box>
                                )}
                              </For>
                            </box>
                          </Show>

                          {/* 3. Approvals Summary */}
                          <Show when={workstationState().approvalSummary.pendingCount > 0}>
                            <box
                              flexDirection="column"
                              gap={0}
                              padding={1}
                              backgroundColor={tint(theme.backgroundElement, theme.warning, 0.08)}
                              border={["round"]}
                              borderColor={theme.warning}
                            >
                              <text fg={theme.warning} bold>
                                PENDING APPROVALS
                              </text>
                              <text fg={theme.text}>
                                {workstationState().approvalSummary.pendingCount} item
                                {workstationState().approvalSummary.pendingCount === 1 ? "" : "s"} waiting
                              </text>
                              <text fg={theme.textMuted} wrapMode="word">
                                Top: {workstationState().approvalSummary.topReason}
                              </text>
                            </box>
                          </Show>

                          {/* 4. Completion Proof */}
                          <Show when={workstationState().completionProof}>
                            <box
                              flexDirection="column"
                              gap={0}
                              padding={1}
                              backgroundColor={
                                workstationState().completionProof!.ready
                                  ? tint(theme.backgroundElement, theme.success, 0.08)
                                  : tint(theme.backgroundElement, theme.warning, 0.08)
                              }
                              border={["round"]}
                              borderColor={workstationState().completionProof!.ready ? theme.success : theme.warning}
                            >
                              <box flexDirection="row" justifyContent="space-between">
                                <text
                                  fg={workstationState().completionProof!.ready ? theme.success : theme.warning}
                                  bold
                                >
                                  COMPLETION PROOF
                                </text>
                                <text fg={workstationState().completionProof!.ready ? theme.success : theme.warning}>
                                  {workstationState().completionProof!.ready ? "PASS" : "FAIL"}
                                </text>
                              </box>
                              <Show when={!workstationState().completionProof!.ready}>
                                <box flexDirection="column" gap={0} paddingTop={1}>
                                  <text fg={theme.textMuted}>Missing evidence:</text>
                                  <For each={workstationState().completionProof!.missing}>
                                    {(item) => <text fg={theme.text}>- {item.replace(/_/g, " ")}</text>}
                                  </For>
                                </box>
                              </Show>
                            </box>
                          </Show>

                          {/* 5. Next Step */}
                          <box
                            flexDirection="column"
                            gap={0}
                            padding={1}
                            backgroundColor={tint(theme.backgroundElement, theme.accent, 0.08)}
                            border={["round"]}
                            borderColor={theme.accent}
                          >
                            <text fg={theme.accent} bold>
                              NEXT STEP
                            </text>
                            <text fg={theme.text} wrapMode="word">
                              {operatorNextMoveSafe().title}
                            </text>
                            <Show when={operatorNextMoveSafe().detail}>
                              <text fg={theme.textMuted} wrapMode="word">
                                {operatorNextMoveSafe().detail}
                              </text>
                            </Show>
                          </box>

                          <Show when={workstationState().goal}>
                            <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
                              <text fg={theme.textMuted} bold>
                                GOAL:
                              </text>
                              <text fg={theme.textMuted} wrapMode="word">
                                {summarize(workstationState().goal, 60)}
                              </text>
                            </box>
                          </Show>
                        </box>
                      </Show>
                    </box>
                  </Match>

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
                        kv.set(DAX_SETTING.session_refined_prompt, "")
                        setPaneMode(() => "plan")
                        setPaneVisibility(() => "auto")
                        setSmartFollowActive(true)
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
                          borderColor={theme.error}
                          backgroundColor={tint(theme.backgroundElement, theme.error, 0.08)}
                        >
                          <text fg={theme.error} bold>
                            Memory load error
                          </text>
                          <text fg={theme.textMuted} wrapMode="word">
                            {memoryLoadError()}
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
            onSubmit={() => {
              setSmartFollowActive(true)
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
            setWorkflowMode(() => modes[(idx + 1) % modes.length])
          }}
        />
      </box>
    </context.Provider>
  )
}

function Message(props: { message: AssistantMessage | UserMessage; last: boolean }) {
  const ctx = use()
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()

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
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            ● USER
          </text>
          <Show when={ctx.showTimestamps()}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              {Locale.todayTimeOrDateTime(props.message.time.created)}
            </text>
          </Show>
        </box>
        <box paddingLeft={2} marginTop={0}>
          <text fg={theme.text} wrapMode="word">
            {(sync.data.part[props.message.id] ?? [])
              .filter((p): p is TextPart => p.type === "text")
              .map((p) => p.text)
              .join("")}
          </text>
        </box>
      </box>
    )
  }

  const parts = createMemo(() => sync.data.part[props.message.id] ?? [])
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

  const evidenceItems = createMemo(() => {
    return toolParts().map((p) => ({
      label: p.tool,
      status: p.state.status === "completed" ? "done" : "active",
    }))
  })

  const derivedReasoning = createMemo(() => {
    const text = reasoningParts()
      .map((p) => p.text)
      .join("")
    return cleanReasoningText(text)
  })

  const visibleNativeReasoningText = createMemo(() => {
    return "" // Handled by ReasoningPart component
  })

  const reasoningTone = createMemo(() => tint(theme.textMuted, theme.text, 0.2))

  return (
    <Show when={renderableParts().length > 0 || !!props.message.error}>
      <Show when={renderableParts().length > 0}>
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
            <box
              backgroundColor={tint(theme.background, roleColor(), 0.34)}
              paddingLeft={1}
              paddingRight={1}
              marginRight={1}
            >
              <text fg={roleColor()} attributes={TextAttributes.BOLD}>
                {roleLabel()}
              </text>
            </box>
            <Show when={ctx.showTimestamps()}>
              <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                {Locale.todayTimeOrDateTime(props.message.time.created)}
              </text>
            </Show>
          </box>
          <box paddingLeft={1} paddingRight={1} paddingBottom={1} flexDirection="column" gap={0}>
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
  const ctx = use()
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

  return (
    <box
      flexDirection="column"
      gap={0}
      marginTop={1}
      marginBottom={0}
      border={["left"]}
      borderColor={theme.borderSubtle}
      paddingLeft={1}
    >
      <box flexDirection="row" gap={1} alignItems="center" paddingBottom={allCompleted() ? 0 : 1}>
        <text fg={hasActive() ? theme.warning : theme.success}>{hasActive() ? "◌" : "✓"}</text>
        <text
          fg={hasActive() ? theme.warning : theme.textMuted}
          attributes={hasActive() ? TextAttributes.BOLD : undefined}
        >
          {hasActive() ? "Gathering context" : "Gathered context"}
        </text>
        <Show when={allCompleted()}>
          <text fg={theme.textMuted} dim>
            ({counts()})
          </text>
        </Show>
      </box>
      <Show when={allCompleted() && ctx.showAssistantMetadata()}>
        <box flexDirection="column" gap={0} paddingTop={0}>
          <For each={tools}>
            {(tool) => {
              const trace = deriveOperatorTraceLine(tool)
              return (
                <text fg={theme.textMuted} dim>
                  • {trace?.summary ?? tool.tool}
                </text>
              )
            }}
          </For>
        </box>
      </Show>
    </box>
  )
}

function ActivityClusterPart(props: { part: { type: "activity-cluster"; tools: ToolPart[] } }) {
  return <ActivityCluster tools={props.part.tools} />
}

function ActivityCluster(props: { tools: ToolPart[] }) {
  const { theme } = useTheme()
  const ctx = use()
  const kv = useKV()
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const traces = createMemo(() => props.tools.map((tool) => ({ tool, trace: deriveOperatorTraceLine(tool) })))
  const completed = createMemo(() => traces().filter((item) => item.tool.state.status === "completed").length)
  const first = createMemo(() => traces()[0])
  const last = createMemo(() => traces()[traces().length - 1])
  const narrative = createMemo(() => {
    const firstTrace = first()?.trace
    const lastTrace = last()?.trace
    if (!firstTrace && !lastTrace) return undefined
    if (traces().length === 1 && firstTrace) {
      if (explainMode()) {
        return `What I did: ${firstTrace.action.toLowerCase()} on ${firstTrace.target}. Result: ${firstTrace.result}. Next safe step: ${firstTrace.next}.`
      }
      return `I ran ${firstTrace.action.toLowerCase()} on ${firstTrace.target} and ${firstTrace.result}. Next: ${firstTrace.next}.`
    }
    if (firstTrace && lastTrace) {
      if (explainMode()) {
        return `I completed ${completed()} of ${traces().length} actions. Started with ${firstTrace.action.toLowerCase()} on ${firstTrace.target}, then moved to ${lastTrace.action.toLowerCase()} on ${lastTrace.target}. Next safe step: ${lastTrace.next}.`
      }
      return `I processed ${traces().length} steps (${completed()} complete). Started with ${firstTrace.action.toLowerCase()} on ${firstTrace.target}, then moved to ${lastTrace.action.toLowerCase()} on ${lastTrace.target}. Next: ${lastTrace.next}.`
    }
    return undefined
  })

  return (
    <box flexDirection="column" gap={0} paddingLeft={1}>
      <Show when={narrative()}>
        <text fg={theme.text} wrapMode="word">
          {narrative()}
        </text>
      </Show>
      <Show when={ctx.showAssistantMetadata()}>
        <box flexDirection="column" gap={0} paddingTop={1}>
          <For each={traces()}>
            {(item) => (
              <text fg={item.tool.state.status === "completed" ? theme.textMuted : theme.primary}>
                {item.tool.state.status === "completed" ? "✓" : "◌"} {item.trace?.summary ?? item.tool.tool}
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
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
  return (
    <Show when={props.part.text.trim()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
        marginTop={props.marginTop ?? 1}
        flexShrink={0}
      >
        <markdown syntaxStyle={syntax()} streaming={true} content={props.part.text.trim()} conceal={ctx.conceal()} />
      </box>
    </Show>
  )
}

const BLOCK_TOOLS = new Set(["shell", "edit", "write", "apply_patch", "task", "question"])

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

  const isBlock = BLOCK_TOOLS.has(props.part.tool)
  const isRunning = createMemo(() => props.part.state.status === "running" || props.part.state.status === "pending")

  return (
    <Switch>
      <Match when={props.part.tool === "shell"}>
        <Bash {...toolprops} />
      </Match>
      <Match when={props.part.tool === "write"}>
        <Write {...toolprops} />
      </Match>
      <Match when={props.part.tool === "edit"}>
        <Edit {...toolprops} />
      </Match>
      <Match when={isBlock}>
        <BlockTool
          title={props.part.tool}
          isRunning={isRunning()}
          part={props.part}
          input={toolprops.input}
          output={toolprops.output}
        >
          <Switch>
            <Match when={props.part.tool === "task"}>
              <text fg={theme.text}>
                {(toolprops.input as any).subagent_type ?? "Task"}: {(toolprops.input as any).description ?? ""}
              </text>
            </Match>
            <Match when={props.part.tool === "question"}>
              <text fg={theme.text}>{(toolprops.input as any).question ?? ""}</text>
            </Match>
            <Match when={props.part.tool === "apply_patch"}>
              <text fg={theme.text}>
                {Object.keys((toolprops.input as any).changes ?? {}).length} file
                {Object.keys((toolprops.input as any).changes ?? {}).length === 1 ? "" : "s"} patched
              </text>
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
          {props.part.tool}
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
  const accent = createMemo(() => (props.part.tool === "shell" ? theme.accent : theme.primary))
  const isRunning = createMemo(() => props.part.state.status === "running" || props.part.state.status === "pending")
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTick((t) => (t + 1) % 4), 400)
    onCleanup(() => clearInterval(timer))
  })

  const statusIndicator = createMemo(() => {
    if (props.complete) return ""
    if (isRunning()) {
      const frames = ["◐", "◑", "◒", "◓"]
      return frames[tick() % frames.length]
    }
    return ""
  })

  return (
    <box paddingLeft={1} border={["left"]} borderColor={accent()}>
      <text fg={props.complete ? theme.textMuted : theme.text}>
        <Show fallback={<>~ {props.pending}</>} when={props.complete}>
          <span style={{ fg: accent() }}>{props.icon}</span> {props.children}
        </Show>
        <Show when={statusIndicator()}>
          <text fg={theme.warning}> {statusIndicator()}</text>
        </Show>
      </text>
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
  const [tick, setTick] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => setTick((t) => (t + 1) % 4), 400)
    onCleanup(() => clearInterval(timer))
  })

  const statusText = createMemo(() => {
    if (hasError()) return "error"
    if (isCompleted()) return "done"
    const frames = ["◐", "◑", "◒", "◓"]
    return frames[tick() % frames.length]
  })

  return (
    <box
      flexDirection="column"
      gap={0}
      marginTop={1}
      marginBottom={0}
      border={["left"]}
      borderColor={hasError() ? theme.error : isCompleted() ? theme.borderSubtle : theme.warning}
      paddingLeft={1}
    >
      <box flexDirection="row" gap={1} alignItems="center" paddingBottom={1}>
        <text fg={hasError() ? theme.error : isCompleted() ? theme.success : theme.warning}>
          {hasError() ? "✗" : isCompleted() ? "✓" : statusText()}
        </text>
        <text
          fg={hasError() ? theme.error : isCompleted() ? theme.textMuted : theme.text}
          attributes={props.isRunning ? TextAttributes.BOLD : undefined}
        >
          {props.title}
        </text>
        <Show when={props.children}>
          <text fg={theme.textMuted} dim>
            — {props.children}
          </text>
        </Show>
      </box>
    </box>
  )
}

function Bash(props: ToolProps<typeof ShellTool>) {
  const { theme } = useTheme()
  const isRunning = createMemo(() => props.part.state.status === "running")
  const output = createMemo(() => stripAnsi(props.metadata.output?.trim() ?? ""))

  return (
    <InlineTool
      icon="✓"
      pending="Executing command..."
      complete={props.part.state.status === "completed"}
      part={props.part}
    >
      $ {(props.input as any).command}
      <Show when={output()}>
        <text fg={theme.textMuted} dim>
          {" "}
          [{output().split("\n").length} lines output]
        </text>
      </Show>
    </InlineTool>
  )
}

function Write(props: ToolProps<typeof WriteTool>) {
  const { theme } = useTheme()
  return (
    <InlineTool icon="✓" pending="Writing file..." complete={props.part.state.status === "completed"} part={props.part}>
      Wrote {normalizePath((props.input as any).filePath!)}
    </InlineTool>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const { theme } = useTheme()
  return (
    <InlineTool icon="✓" pending="Editing file..." complete={props.part.state.status === "completed"} part={props.part}>
      Edited {normalizePath((props.input as any).filePath!)}
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

function isLowSignalStageReason(value: string | undefined) {
  if (!value) return true
  return /^(idle|session processing|response stream active|reasoning stream active|waiting for stream content)$/i.test(
    value.trim(),
  )
}
