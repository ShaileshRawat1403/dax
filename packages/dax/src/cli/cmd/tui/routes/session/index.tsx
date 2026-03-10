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
import { BashTool } from "@/tool/bash"
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
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { RAOPane } from "./rao-pane"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { formatTranscript } from "../../util/transcript"
import { UI } from "@/cli/ui.ts"
import { labelStage, type StreamStage } from "@/dax/workflow/stage"
import {
  ORCHESTRATION_FLOW,
  labelOrchestrationPhase,
  streamStageToOrchestrationPhase,
  type OrchestrationPhase,
} from "@/dax/orchestration"
import { buildAssistantNarrative, type AssistantNarrativeIntensity } from "@/dax/assistant-narrative"
import {
  PANE_MODE,
  type PaneFollowMode,
  type PaneMode,
  type PaneVisibility,
  paneLabel as daxPaneLabel,
  paneTitle as daxPaneTitle,
  memoryLabel,
} from "@/dax/presentation/pane"
import { isEli12Mode } from "@/dax/intent"
import { DAX_SETTING } from "@/dax/settings"
import { nextActionForErrorMessage } from "@/dax/status"
import { SESSION_COMMAND_BINDINGS, SESSION_COMMAND_LABELS, SESSION_SHELL_ROLES } from "@/dax/session-shell"
import { Identifier } from "@/id/id"
import { parsePMList, parsePMRules } from "@/pm/format"
import { DialogApprovals } from "../../component/dialog-approvals"
import { DialogDiff } from "../../component/dialog-diff"
import { resolvePreferredName } from "@/dax/user-profile"

addDefaultParsers(parsers.parsers)

const EXPLORE_TOOLS = new Set(["read", "glob", "grep", "list", "webfetch", "websearch", "codesearch"])
const PLAN_TOOLS = new Set(["task", "todowrite", "question", "skill"])
const EXECUTE_TOOLS = new Set(["write", "edit", "apply_patch", "bash"])
const VERIFY_TOOLS = new Set(["read", "grep", "list", "glob"])
type PMTab = "note" | "list" | "rules"
type AuditSeverity = "critical" | "high" | "medium" | "low" | "info"
type AuditFinding = {
  id: string
  severity: AuditSeverity
  category: string
  title: string
  evidence: string
  impact: string
  fix: string
  owner_hint: string
  blocking: boolean
}
type AuditResult = {
  run_id: string
  timestamp: string
  profile: "strict" | "balanced" | "advisory"
  status: "pass" | "warn" | "fail"
  findings: AuditFinding[]
  summary: {
    blocker_count: number
    warning_count: number
    info_count: number
  }
  next_actions: string[]
  metadata: {
    trigger: string
  }
}
type DocsSeverity = "critical" | "high" | "medium" | "low" | "info"
type DocsCheck = {
  id: string
  severity: DocsSeverity
  category: string
  title: string
  evidence: string
  fix: string
  blocking: boolean
}
type DocsResult = {
  run_id: string
  timestamp: string
  mode: "guide" | "spec" | "release-notes" | "qa"
  status: "pass" | "warn" | "fail"
  title: string
  content: string
  checks: DocsCheck[]
  summary: {
    blocker_count: number
    warning_count: number
    info_count: number
  }
  next_actions: string[]
}

type ThemeShape = ReturnType<typeof useTheme>["theme"]
type TranscriptPosition = {
  current: number
  total: number
  label: string
  live: boolean
}

function SessionQuickAction(props: {
  theme: ThemeShape
  label: string
  onPress: () => void
  primary?: boolean
  muted?: boolean
}) {
  return (
    <box
      onMouseUp={props.onPress}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={props.primary ? props.theme.primary : props.theme.backgroundElement}
    >
      <text
        fg={
          props.primary
            ? props.theme.selectedListItemText
            : props.muted
              ? props.theme.textMuted
              : props.theme.text
        }
      >
        {props.label}
      </text>
    </box>
  )
}

function describeToolNarrative(part: ToolPart) {
  const input = (part.state.input ?? {}) as Record<string, any>
  switch (part.tool) {
    case "read":
      return {
        now: `Reading ${input.filePath ?? "the relevant file"} to gather context.`,
        next: "Next I will use that context to refine the plan or answer.",
      }
    case "glob":
      return {
        now: `Finding files that match ${input.pattern ?? "the requested pattern"}.`,
        next: "Next I will inspect the most relevant matches.",
      }
    case "grep":
      return {
        now: `Searching file contents for ${input.pattern ?? "the requested pattern"}.`,
        next: "Next I will inspect the strongest matches.",
      }
    case "list":
      return {
        now: `Listing ${input.path ?? "the working directory"} to understand the project structure.`,
        next: "Next I will focus on the directories or files that matter most.",
      }
    case "webfetch":
      return {
        now: `Fetching ${input.url ?? "the requested page"} to inspect its contents.`,
        next: "Next I will extract the details needed for the task.",
      }
    case "websearch":
      return {
        now: `Searching the web for ${input.query ?? "the requested topic"}.`,
        next: "Next I will compare the most relevant results.",
      }
    case "codesearch":
      return {
        now: `Searching code for ${input.query ?? "the requested symbols or patterns"}.`,
        next: "Next I will inspect the best matches in detail.",
      }
    case "task":
      return {
        now: "Preparing the next execution step and deciding which path is safest.",
        next: "Next I will move into execution or ask for approval if needed.",
      }
    case "todowrite":
      return {
        now: "Updating the working checklist to keep the task organized.",
        next: "Next I will continue with the next queued step.",
      }
    case "question":
      return {
        now: "Preparing a focused question because I need one decision from you.",
        next: "Next I will wait for your input before continuing.",
      }
    case "skill":
      return {
        now: `Loading ${input.name ?? "the requested skill"} to follow the right workflow.`,
        next: "Next I will continue using that workflow.",
      }
    case "write":
      return {
        now: `Writing ${input.filePath ?? "the target file"}.`,
        next: "Next I will verify the written result and summarize what changed.",
      }
    case "edit":
      return {
        now: `Editing ${input.filePath ?? "the target file"}.`,
        next: "Next I will verify the edit and summarize what changed.",
      }
    case "apply_patch":
      return {
        now: "Applying the prepared patch to the workspace.",
        next: "Next I will verify the patch result and summarize the affected files.",
      }
    case "bash":
      return {
        now: "Running a shell command needed for this task.",
        next: "Next I will inspect the command output and continue.",
      }
    default:
      if (VERIFY_TOOLS.has(part.tool)) {
        return {
          now: "Verifying results before continuing.",
          next: "Next I will summarize the verified result.",
        }
      }
      return {
        now: "Working through the next step of the request.",
        next: "Next I will continue with the following execution step.",
      }
  }
}

function toolTargetLabel(part: ToolPart) {
  const input = (part.state.input ?? {}) as Record<string, any>
  const raw =
    input.filePath ??
    input.path ??
    input.filename ??
    input.url ??
    input.query ??
    input.pattern ??
    input.name
  if (!raw || typeof raw !== "string") return undefined
  if (part.tool === "read" || part.tool === "write" || part.tool === "edit") return path.basename(raw)
  return raw
}

function toolOutputText(part: ToolPart) {
  if (part.state.status !== "completed") return ""
  const output = part.state.output
  if (typeof output === "string") return output
  if (typeof output === "number" || typeof output === "boolean") return String(output)
  if (!output) return ""
  try {
    return JSON.stringify(output)
  } catch {
    return ""
  }
}

function matchCount(text: string) {
  const hit = text.match(/\b(\d+)\s+matches?\b/i)
  return hit ? Number(hit[1]) : undefined
}

function describeToolFinding(part: ToolPart) {
  const target = toolTargetLabel(part)
  const output = toolOutputText(part)
  switch (part.tool) {
    case "grep": {
      const count = matchCount(output)
      return count ? `Found ${count} relevant matches to inspect.` : "Found the strongest matches to inspect."
    }
    case "glob": {
      const count = matchCount(output)
      return count ? `Found ${count} relevant files for this pass.` : "Found the files that matter for this pass."
    }
    case "list":
      return target ? `Found the relevant folders under ${target}.` : "Found the relevant folders for this review."
    case "read":
      return target ? `Found the key details in ${target}.` : "Found the key details in the relevant file."
    case "webfetch":
    case "websearch":
      return "Found relevant source material for this request."
    case "codesearch":
      return "Found the code locations most relevant to this request."
    case "bash":
      return "Found the command output needed for the next step."
    case "write":
    case "edit":
    case "apply_patch":
      return "Found the files that were updated for this task."
    default:
      return undefined
  }
}

function describeToolFocus(part: ToolPart) {
  const target = toolTargetLabel(part)
  switch (part.tool) {
    case "read":
      return target ? `checking ${target}` : "checking the relevant file"
    case "glob":
      return "checking matching files"
    case "grep":
      return "checking relevant matches"
    case "list":
      return target ? `checking ${target}` : "checking project structure"
    case "webfetch":
      return "checking fetched page contents"
    case "websearch":
      return "checking the strongest web results"
    case "codesearch":
      return "checking the strongest code matches"
    case "task":
    case "todowrite":
    case "question":
    case "skill":
      return "planning the next step"
    case "write":
    case "edit":
    case "apply_patch":
      return "applying changes"
    case "bash":
      return "running a verification command"
    default:
      if (VERIFY_TOOLS.has(part.tool)) return "verifying the result"
      return "working through the next step"
  }
}

function describeOperationalMilestone(args: {
  asked: string
  completedTools: ToolPart[]
  pendingTool?: ToolPart
  hasReasoning: boolean
  explainMode: boolean
}) {
  const asked = args.asked.toLowerCase()
  const lastCompleted = args.completedTools.at(-1)
  let found = lastCompleted ? describeToolFinding(lastCompleted) : undefined

  if (lastCompleted && /release|readiness|ship|launch|ga|beta/.test(asked)) {
    switch (lastCompleted.tool) {
      case "glob":
      case "list":
        found = "Found the release surfaces and docs that define the readiness scope."
        break
      case "read":
        found = "Found the product and release details that set the current bar."
        break
      case "grep":
        found = "Found the command and workflow surfaces that need release coverage."
        break
      case "bash":
        found = "Found repository state and gate output that affect release readiness."
        break
    }
  } else if (lastCompleted && /stream|streaming|delta|reasoning|render/.test(asked)) {
    switch (lastCompleted.tool) {
      case "read":
      case "grep":
      case "codesearch":
        found = "Found the stream and delta path that controls what users actually see."
        break
      case "bash":
        found = "Found runtime output that shows how the stream behaves in practice."
        break
    }
  } else if (lastCompleted && /review|repo|repository|architecture|summarize/.test(asked)) {
    switch (lastCompleted.tool) {
      case "glob":
      case "list":
        found = "Found the main project surfaces that matter for this review."
        break
      case "read":
        found = "Found the details that shape the current repo review."
        break
      case "grep":
        found = "Found the strongest code and config signals to inspect."
        break
    }
  } else if (lastCompleted && /fix|debug|error|failing|broken|test|bug|issue/.test(asked)) {
    switch (lastCompleted.tool) {
      case "read":
      case "grep":
      case "codesearch":
        found = "Found the most likely source of the problem."
        break
      case "bash":
        found = "Found output that narrows the failing path."
        break
    }
  }

  const checking = args.pendingTool
    ? describeToolFocus(args.pendingTool)
    : args.hasReasoning
      ? args.explainMode
        ? "figuring out the safest next step"
        : "narrowing the safest next step"
      : undefined

  let next: string | undefined
  if (args.pendingTool) {
    next = describeToolNarrative(args.pendingTool).next.replace(/^Next I will /i, "I’ll ")
  } else if (found) {
    next = args.explainMode
      ? "I’ll turn that into a clear next step."
      : "I’ll turn that into a concrete next step."
  }

  return { found, checking, next }
}

function describeReasoningNarrative() {
  return {
    now: "Understanding the request and deciding the safest next step.",
    next: "Next I will move into planning or execution.",
  }
}

function formatNarrativePhases(phases: string[]) {
  const labels = phases.map((phase) => {
    switch (phase) {
      case "inspect":
        return "inspection"
      case "plan":
        return "planning"
      case "execute":
        return "execution"
      case "verify":
        return "verification"
      default:
        return phase
    }
  })
  if (labels.length <= 1) return labels[0] ?? "the work"
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`
}

function describeOperationalCompletion(args: {
  asked: string
  phases: string[]
  writes: number
  verifies: number
  hasError: boolean
}) {
  if (args.hasError) return "I worked through the request and surfaced the point where execution broke."

  const asked = args.asked.toLowerCase()
  const phaseText = args.phases.length > 0 ? formatNarrativePhases(args.phases) : "the work"

  if (/release|readiness|ship|launch|ga|beta/.test(asked)) {
    return `I reviewed DAX release readiness across scope, quality gates, packaging, and docs so the blockers and next steps stay concrete.`
  }
  if (/stream|streaming|delta|reasoning|render/.test(asked)) {
    return `I traced the streaming path end to end so we can separate what already works from what still feels buffered or noisy.`
  }
  if (/review|repo|repository|architecture|summarize/.test(asked)) {
    return `I reviewed the repo in phases across ${phaseText}, so the result stays anchored to the actual codebase.`
  }
  if (/readme|docs|documentation|audit/.test(asked)) {
    return `I checked the relevant docs and code context through ${phaseText} before summarizing what matters.`
  }
  if (/mcp|auth|oauth|provider/.test(asked)) {
    return `I checked the integration path in phases, covering ${phaseText} before calling out the important issues.`
  }
  if (/fix|debug|error|failing|broken|test|bug|issue/.test(asked)) {
    return `I narrowed the problem through ${phaseText} so the result focuses on the likeliest cause and safest next move.`
  }
  if (args.writes > 0) {
    return `I worked through ${phaseText} and verified the result before wrapping up the changes.`
  }
  if (args.verifies > 0) {
    return `I verified the outcome across ${phaseText} before summarizing what matters.`
  }
  return `I kept the result grounded in verified context across ${phaseText}.`
}

function formatMilestoneName(phase: string) {
  switch (phase) {
    case "inspect":
      return "inspection"
    case "plan":
      return "planning"
    case "execute":
      return "execution"
    case "verify":
      return "verification"
    default:
      return phase
  }
}

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private speed: number) {}

  tick(_now?: number): number {
    return this.speed
  }

  reset(): void {}
}

const context = createContext<{
  width: number
  sessionID: string
  conceal: () => boolean
  showThinking: () => boolean
  showTimestamps: () => boolean
  showDetails: () => boolean
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
  const themeState = useTheme()
  const theme = new Proxy({} as any, {
    get: (_target, prop: string) => (themeState.theme as any)[prop],
  })
  const syntax = themeState.syntax
  const promptRef = usePromptRef()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const preferredName = createMemo(() =>
    resolvePreferredName({
      sessionID: route.sessionID,
      configUsername: sync.data.config.username,
      kvGet: kv.get,
    }),
  )
  const children = createMemo(() => {
    const s = session()
    if (!s) return []
    const parentID = s.parentID ?? s.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => (route.sessionID ? (sync.data.message[route.sessionID] ?? []) : []))
  const todo = createMemo(() => sync.data.todo[route.sessionID] ?? [])
  const permissions = createMemo(() => {
    if (!session() || session()?.parentID) return []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })
  const questions = createMemo(() => {
    if (!session() || session()?.parentID) return []
    return children().flatMap((x) => sync.data.question[x.id] ?? [])
  })

  const pending = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id
  })

  const chatActive = createMemo(() => pending() !== undefined)

  const lastAssistant = createMemo(() => {
    return messages().findLast((x) => x.role === "assistant")
  })

  const dimensions = useTerminalDimensions()
  const [sidebar, setSidebar] = kv.signal<"auto" | "hide">("sidebar", "hide")
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [conceal, setConceal] = createSignal(true)
  const [showThinking, setShowThinking] = kv.signal("thinking_visibility", true)
  const [timestamps, setTimestamps] = kv.signal<"hide" | "show">("timestamps", "hide")
  const [showDetails, setShowDetails] = kv.signal("tool_details_visibility", true)
  const [showAssistantMetadata, setShowAssistantMetadata] = kv.signal("assistant_metadata_visibility", true)
  const [showEli12Summary, setShowEli12Summary] = kv.signal(DAX_SETTING.eli12_summary_visibility, false)
  const [showScrollbar, setShowScrollbar] = kv.signal("scrollbar_visible", false)
  const [diffWrapMode] = kv.signal<"word" | "none">("diff_wrap_mode", "word")
  const [animationsEnabled, setAnimationsEnabled] = kv.signal("animations_enabled", true)
  const [paneVisibility, setPaneVisibility] = kv.signal<PaneVisibility>(DAX_SETTING.session_pane_visibility, "auto")
  const [paneMode, setPaneMode] = kv.signal<PaneMode>(DAX_SETTING.session_pane_mode, "artifact")
  const [paneFollowMode, setPaneFollowMode] = kv.signal<PaneFollowMode>(DAX_SETTING.session_pane_follow_mode, "smart")
  const [slowStream, setSlowStream] = kv.signal(DAX_SETTING.session_stream_slow, true)
  const [raoFocusRequestID, setRaoFocusRequestID] = createSignal<string | undefined>(undefined)
  const { currentPun } = useUIActivity()
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const promptDisabled = createMemo(() => !!session()?.parentID)
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
  const sessionStatusType = createMemo(() => sync.data.session_status?.[route.sessionID]?.type ?? "idle")
  const stageState = createMemo<{ stage: StreamStage; reason: string }>(() => {
    if (permissions().length > 0 || questions().length > 0) {
      return {
        stage: "waiting",
        reason: permissions().length > 0 ? "waiting for approval" : "waiting for user input",
      }
    }

    if (sessionStatusType() === "retry") {
      return { stage: "retrying", reason: "recovering from a failed attempt" }
    }

    const pendingID = pending()
    if (pendingID) {
      const parts = sync.data.part[pendingID] ?? []
      const pendingTool = parts.findLast((part) => part.type === "tool" && part.state.status === "pending")
      const completedExecutionInTurn = parts.some(
        (part) => part.type === "tool" && part.state.status === "completed" && EXECUTE_TOOLS.has(part.tool),
      )

      if (pendingTool && pendingTool.type === "tool") {
        const tool = pendingTool.tool
        if (PLAN_TOOLS.has(tool)) return { stage: "planning", reason: describeToolFocus(pendingTool) }
        if (EXECUTE_TOOLS.has(tool)) return { stage: "executing", reason: describeToolFocus(pendingTool) }
        if (VERIFY_TOOLS.has(tool) && completedExecutionInTurn) {
          return { stage: "verifying", reason: describeToolFocus(pendingTool) }
        }
        if (EXPLORE_TOOLS.has(tool)) return { stage: "exploring", reason: describeToolFocus(pendingTool) }
        return { stage: "executing", reason: describeToolFocus(pendingTool) }
      }

      const hasReasoning = parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0)
      if (hasReasoning) return { stage: "thinking", reason: "understanding your request" }
      return { stage: "thinking", reason: "preparing the next response" }
    }

    if (sessionStatusType() === "busy") {
      return { stage: "thinking", reason: "working on your request" }
    }

    return { stage: "done", reason: "task complete" }
  })
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
  const orchestrationPhase = createMemo(() => streamStageToOrchestrationPhase(displayStageState().stage))
  const stageColor = createMemo(() => {
    const phase = streamStageToOrchestrationPhase(displayStageState().stage)
    if (phase === "waiting") return theme.warning
    if (phase === "complete") return theme.success
    if (phase === "understand") return theme.secondary
    return theme.accent
  })
  const streamStatus = createMemo(() => {
    const pendingID = pending()
    if (!pendingID) return "idle"
    const parts = sync.data.part[pendingID] ?? []
    const pendingTool = parts.findLast((part) => part.type === "tool" && part.state.status === "pending")
    if (pendingTool && pendingTool.type === "tool") return describeToolFocus(pendingTool)
    const completedTool = parts.findLast((part) => part.type === "tool" && part.state.status === "completed")
    if (completedTool && completedTool.type === "tool") return describeToolFinding(completedTool)?.toLowerCase() ?? `${completedTool.tool} completed`
    if (parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0)) return "reasoning"
    return "responding"
  })
  const [smartFollowActive, setSmartFollowActive] = createSignal(true)
  const [pendingUpdates, setPendingUpdates] = createSignal(0)
  const [streamParts, setStreamParts] = createSignal<Record<string, Part[]>>({})
  const [transcriptPosition, setTranscriptPosition] = createSignal<TranscriptPosition>({
    current: 0,
    total: 0,
    label: "start",
    live: true,
  })

  const wide = createMemo(() => dimensions().width > 120)
  const hasRaoNeed = createMemo(() => permissions().length > 0 || questions().length > 0)
  const sidebarVisible = createMemo(() => {
    if (session()?.parentID) return false
    // Preserve horizontal room by default when side pane is active.
    if (paneVisibility() !== "hidden" && !sidebarOpen()) return false
    if (sidebarOpen()) return true
    if (sidebar() === "auto" && wide()) return true
    return false
  })
  const showTimestamps = createMemo(() => timestamps() === "show")
  const contentWidth = createMemo(() => dimensions().width - (sidebarVisible() ? 42 : 0) - 4)
  const liveStacked = createMemo(() => contentWidth() < 90)
  const stripCompact = createMemo(() => contentWidth() < 112)
  const stripTight = createMemo(() => contentWidth() < 132)
  const shellCompact = createMemo(() => contentWidth() < 108)
  const shellTight = createMemo(() => contentWidth() < 86)
  const stripInnerWidth = createMemo(() => Math.max(0, contentWidth()))
  const stripColumns = createMemo(() => {
    const w = stripInnerWidth()
    if (w >= 120) return 4
    if (w >= 64) return 2
    return 1
  })
  const stripGap = createMemo(() => (stripColumns() === 1 ? 0 : 1))
  const stripSectionWidth = createMemo(() => {
    const cols = stripColumns()
    const inner = Math.max(0, stripInnerWidth() - stripGap() * (cols - 1))
    return Math.max(0, Math.floor(inner / cols))
  })
  const revertDiffReady = createMemo(() => !!session()?.revert?.diff)
  const paneWidthProfile = createMemo(() => {
    if (liveStacked()) {
      return { main: 7, side: 3, fraction: 0.32 }
    }
    if (paneVisibility() === "pinned") {
      if (paneMode() === "rao" || paneMode() === "diff") {
        return { main: 3, side: 2, fraction: 0.38 }
      }
      return { main: 4, side: 1, fraction: 0.24 }
    }
    if (hasRaoNeed() || revertDiffReady()) {
      return { main: 5, side: 2, fraction: 0.28 }
    }
    return { main: 6, side: 1, fraction: 0.18 }
  })
  const safePaneWidthProfile = createMemo(() => paneWidthProfile() ?? { main: 6, side: 1, fraction: 0.18 })
  const livePaneWidth = createMemo(() => {
    const total = contentWidth()
    const gapAndBorders = 6
    return Math.max(28, Math.floor((total - gapAndBorders) * safePaneWidthProfile().fraction))
  })
  const mainPaneGrow = createMemo(() => safePaneWidthProfile().main)
  const sidePaneGrow = createMemo(() => safePaneWidthProfile().side)
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
  const selectedTheme = createMemo(() => themeState.selected)
  const selectedThemeShort = createMemo(() => {
    const name = selectedTheme()
    if (name.length <= 14) return name
    return `${name.slice(0, 11)}...`
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

  function cyclePaneMode() {
    const modes = availablePaneModes()
    if (!modes.length) return
    const i = modes.indexOf(paneMode())
    const next = modes[(Math.max(i, 0) + 1) % modes.length]
    if (!next) return
    setPaneMode(() => next)
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

  createEffect(() => {
    if (paneMode() !== "audit") return
    if (auditPaneEnabled()) return
    setPaneMode(() => "artifact")
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
      lastSwitch = part.id
    } else if (part.tool === "plan_enter") {
      local.agent.set("plan")
      lastSwitch = part.id
    }
  })

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef | undefined
  const keybind = useKeybind()
  const keyHint = (name: Parameters<typeof keybind.print>[0]) => {
    const printed = keybind.print(name)
    return printed ? `[${printed}]` : ""
  }

  // Allow exit when in child session (prompt is hidden)
  const exit = useExit()

  createEffect(() => {
    return exit.message.set(
      [
        "",
        `  ${UI.Style.TEXT_NORMAL_BOLD}DAX session closed${UI.Style.TEXT_NORMAL}`,
        `  ${UI.Style.TEXT_DIM}resume: dax -s ${session()?.id}${UI.Style.TEXT_NORMAL}`,
      ].join("\n"),
    )
  })

  useKeyboard((evt) => {
    if (!session()?.parentID) return
    if (keybind.match("app_exit", evt)) {
      exit()
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
  const scrollToMessageDirect = (direction: "next" | "prev") => {
    const targetID = findNextVisibleMessage(direction)

    if (!targetID) {
      scroll.scrollBy(direction === "next" ? scroll.height : -scroll.height)
      return
    }

    const child = scroll.getChildren().find((c) => c.id === targetID)
    if (child) scroll.scrollBy(child.y - scroll.y - 1)
  }

  const scrollToMessage = (direction: "next" | "prev", dialog: ReturnType<typeof useDialog>) => {
    scrollToMessageDirect(direction)
    dialog.clear()
  }

  const jumpToLastUserMessage = () => {
    const messageList = sync.data.message[route.sessionID]
    if (!messageList || !messageList.length) return

    for (let i = messageList.length - 1; i >= 0; i--) {
      const message = messageList[i]
      if (!message || message.role !== "user") continue

      const parts = sync.data.part[message.id]
      if (!parts || !Array.isArray(parts)) continue

      const hasValidTextPart = parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)

      if (!hasValidTextPart) continue

      const child = scroll.getChildren().find((candidate) => candidate.id === message.id)
      if (child) scroll.scrollBy(child.y - scroll.y - 1)
      break
    }
  }

  const updateTranscriptPosition = () => {
    if (!scroll || scroll.isDestroyed) {
      setTranscriptPosition({ current: 0, total: 0, label: "start", live: true })
      return
    }

    const messageList = messages()
    const visibleMessages = messageList.filter((message) => {
      const parts = sync.data.part[message.id]
      if (!parts || !Array.isArray(parts)) return false
      return parts.some((part) => part && part.type === "text" && !part.synthetic && !part.ignored)
    })
    if (visibleMessages.length === 0) {
      setTranscriptPosition({ current: 0, total: 0, label: "start", live: true })
      return
    }

    const children = scroll
      .getChildren()
      .filter((child) => child.id && visibleMessages.some((message) => message.id === child.id))
      .sort((a, b) => a.y - b.y)

    if (children.length === 0) {
      setTranscriptPosition({
        current: 1,
        total: visibleMessages.length,
        label: visibleMessages[0]?.role === "assistant" ? "assistant" : "user",
        live: true,
      })
      return
    }

    const anchor =
      children.find((child) => child.y >= scroll.y + 1) ??
      [...children].reverse().find((child) => child.y <= scroll.y + 1) ??
      children[0]

    const anchorID = anchor?.id
    const index = Math.max(
      0,
      visibleMessages.findIndex((message) => message.id === anchorID),
    )
    const anchorMessage = visibleMessages[index]
    const live = scroll.y + scroll.height >= scroll.scrollHeight - 3

    setTranscriptPosition({
      current: index + 1,
      total: visibleMessages.length,
      label: live ? "live" : anchorMessage?.role === "assistant" ? "assistant" : "user",
      live,
    })
  }

  function toBottom() {
    setTimeout(() => {
      if (!scroll || scroll.isDestroyed) return
      scroll.scrollTo(scroll.scrollHeight)
    }, 50)
  }

  const local = useLocal()
  const [pmTab, setPmTab] = kv.signal<PMTab>(DAX_SETTING.session_pm_tab, "note")
  const auditPaneEnabled = createMemo(
    () => Flag.DAX_AUDIT_BETA || (sync.data.config as Record<string, any>).audit?.enabled === true,
  )
  const availablePaneModes = createMemo(() =>
    PANE_MODES.filter((mode) => (mode === "audit" ? auditPaneEnabled() : true)),
  )

  const messageText = (messageID: string) => {
    const parts = sync.data.part[messageID] ?? []
    let text = ""
    for (const part of parts) {
      if (part.type !== "text" || part.synthetic) continue
      text += part.text
    }
    return text.trim()
  }

  const parseAuditResult = (text: string): AuditResult | undefined => {
    if (!text) return
    const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1]
    const candidate = fenced ?? text
    try {
      const parsed = JSON.parse(candidate) as AuditResult
      if (!parsed || !Array.isArray(parsed.findings) || !parsed.summary) return
      return parsed
    } catch {
      return
    }
  }
  const parseDocsResult = (text: string): DocsResult | undefined => {
    if (!text) return
    const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1]
    const candidate = fenced ?? text
    try {
      const parsed = JSON.parse(candidate) as DocsResult
      if (!parsed || !Array.isArray(parsed.checks) || !parsed.summary || !parsed.mode) return
      return parsed
    } catch {
      return
    }
  }

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

  const auditHistory = createMemo(() => {
    const messageList = messages()
    const items: Array<{
      commandText: string
      responseText: string
      result?: AuditResult
      createdAt: number
    }> = []

    for (const message of messageList) {
      if (message.role !== "user") continue
      const commandText = messageText(message.id)
      if (!commandText.startsWith("/audit")) continue
      const response = messageList.find((candidate) => candidate.role === "assistant" && candidate.parentID === message.id)
      if (!response) continue
      const responseText = messageText(response.id)
      if (!responseText) continue
      items.push({
        commandText,
        responseText,
        result: parseAuditResult(responseText),
        createdAt: response.time.created,
      })
    }

    return items
  })

  const latestAudit = createMemo(() => auditHistory().findLast((entry) => entry.result !== undefined))
  const auditSummary = createMemo(() => latestAudit()?.result?.summary)
  const sessionDiffs = createMemo(() => sync.data.session_diff[route.sessionID] ?? [])
  const sessionDiffSummary = createMemo(() => ({
    files: sessionDiffs().length,
    additions: sessionDiffs().reduce((sum, item) => sum + item.additions, 0),
    deletions: sessionDiffs().reduce((sum, item) => sum + item.deletions, 0),
  }))
  const auditFindings = createMemo(() => {
    const result = latestAudit()?.result
    if (!result) return [] as AuditFinding[]
    const order: Record<AuditSeverity, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
      info: 4,
    }
    return [...result.findings].sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1
      return order[a.severity] - order[b.severity]
    })
  })
  const docsHistory = createMemo(() => {
    const messageList = messages()
    const items: Array<{
      commandText: string
      responseText: string
      result?: DocsResult
      createdAt: number
    }> = []

    for (const message of messageList) {
      if (message.role !== "user") continue
      const commandText = messageText(message.id)
      if (!commandText.startsWith("/docs")) continue
      const response = messageList.find((candidate) => candidate.role === "assistant" && candidate.parentID === message.id)
      if (!response) continue
      const responseText = messageText(response.id)
      if (!responseText) continue
      items.push({
        commandText,
        responseText,
        result: parseDocsResult(responseText),
        createdAt: response.time.created,
      })
    }
    return items
  })
  const latestDocsQa = createMemo(() =>
    docsHistory().findLast((entry) => entry.result && entry.result.mode === "qa"),
  )

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
      const response = messageList.find((candidate) => candidate.role === "assistant" && candidate.parentID === message.id)
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

  const latestPmListResponse = createMemo(() => pmHistory().findLast((entry) => entry.subcommand === "list"))
  const latestPmRulesResponse = createMemo(() =>
    pmHistory().findLast((entry) => entry.subcommand === "rules" && entry.commandText.trim() === "/pm rules"),
  )
  const latestPmRulesAddResponse = createMemo(() =>
    pmHistory().findLast((entry) => entry.subcommand === "rules" && entry.commandText.trim().startsWith("/pm rules add ")),
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

  const prefillPmNote = () => {
    prompt?.set({
      input: "/pm note Project constants | Product codename is ... | release,context",
      parts: [],
    })
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
    const commandLine = trimmed.slice(1)
    const [name, ...rest] = commandLine.split(" ")
    if (!name) return
    const variant = local.model.variant.current()
    const args = rest.join(" ").trim()

    await sdk.client.session
      .command({
        sessionID: route.sessionID,
        command: name,
        arguments: args,
        agent: local.agent.current().name,
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
  const openApprovalsReview = () => {
    dialog.replace(() => (
      <DialogApprovals
        permissions={permissions()}
        questions={questions()}
        explainMode={explainMode()}
        onOpenLive={(requestID) => {
          setRaoFocusRequestID(requestID)
          setPaneMode(() => "rao")
          setPaneVisibility(() => "pinned")
          dialog.clear()
        }}
      />
    ))
  }
  const openDiffReview = () => {
    const diffs = sync.data.session_diff[route.sessionID] ?? []
    dialog.replace(() => (
      <DialogDiff
        diffs={diffs}
        explainMode={explainMode()}
        onOpenPane={() => {
          setPaneMode(() => "diff")
          setPaneVisibility(() => "pinned")
          dialog.clear()
        }}
      />
    ))
  }
  const openTimelineReview = () => {
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
  const openPmPane = () => {
    setPaneMode(() => "pm")
    setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
    keepPromptFocused()
  }
  const openDocsReview = () => {
    setPaneMode(() => "audit")
    setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
    keepPromptFocused()
  }
  const openMcpInspect = () => command.trigger("mcp.inspect")
  const toggleExplainMode = () => {
    const isEli12 = explainMode()
    kv.set(DAX_SETTING.explain_mode, isEli12 ? "normal" : "eli12")
    toast.show({
      message: isEli12 ? "Explain mode off" : "Explain mode on",
      variant: "success",
      duration: 1800,
    })
  }
  const toggleTraceVisibility = () => {
    const next = !showDetails()
    setShowDetails(() => next)
    toast.show({
      message: next ? "Trace visible" : "Trace hidden",
      variant: "info",
      duration: 1800,
    })
  }
  const openPrimaryReview = () => {
    if (hasRaoNeed()) return openApprovalsReview()
    if (sessionDiffs().length > 0) return openDiffReview()
    if (mcpNeedsAttention()) return openMcpInspect()
    if (latestDocsQa()?.result) return openDocsReview()
    if (todo().length > 0) return openPmPane()
  }

  const editPreferredName = () => {
    prompt?.set({
      input: preferredName() ? `/name ${preferredName()}` : "/name ",
      parts: [],
    })
    toast.show({
      variant: "info",
      message: preferredName()
        ? `Update how DAX addresses you. Current name: ${preferredName()}.`
        : "Set the name DAX should use for you in this session.",
      duration: 2400,
    })
  }
  const transcriptNavigatorVisible = createMemo(
    () => pendingUpdates() > 0 || (!transcriptPosition().live && transcriptPosition().total > 10),
  )
  const actionStripState = createMemo(() => {
    if (permissions().length > 0) {
      return {
        state: "needs approval",
        detail: `${permissions().length} request${permissions().length === 1 ? "" : "s"} waiting`,
        primaryLabel: SESSION_COMMAND_LABELS.reviewApprovals,
        primaryAction: openApprovalsReview,
      }
    }
    if (questions().length > 0) {
      return {
        state: "blocked",
        detail: `${questions().length} question${questions().length === 1 ? "" : "s"} waiting`,
        primaryLabel: SESSION_COMMAND_LABELS.reviewApprovals,
        primaryAction: openApprovalsReview,
      }
    }
    if (sessionStatusType() === "retry") {
      return {
        state: "blocked",
        detail: nextActionForErrorMessage((sync.data.session_status?.[route.sessionID] as { message?: string } | undefined)?.message),
        primaryLabel: SESSION_COMMAND_LABELS.jumpTimeline,
        primaryAction: openTimelineReview,
      }
    }
    if (pendingUpdates() > 0 && paneFollowMode() === "smart" && !smartFollowActive()) {
      return {
        state: "waiting",
        detail: `${pendingUpdates()} new update${pendingUpdates() === 1 ? "" : "s"} ready`,
        primaryLabel: SESSION_COMMAND_LABELS.jumpLive,
        primaryAction: jumpToLive,
      }
    }
    if (pending() || sessionStatusType() === "busy") {
      return {
        state: "waiting",
        detail: `DAX is ${streamStatus()}`,
        primaryLabel: SESSION_COMMAND_LABELS.jumpTimeline,
        primaryAction: openTimelineReview,
      }
    }
    return undefined
  })

  command.register(() => [
    {
      title: SESSION_COMMAND_LABELS.reviewApprovals,
      value: "session.review.approvals",
      keybind: SESSION_COMMAND_BINDINGS.reviewApprovals,
      category: "Session",
      onSelect: (dialog) => {
        openApprovalsReview()
      },
    },
    {
      title: SESSION_COMMAND_LABELS.reviewDiff,
      value: "session.review.diff",
      keybind: SESSION_COMMAND_BINDINGS.reviewDiff,
      category: "Session",
      onSelect: (dialog) => {
        openDiffReview()
      },
    },
    {
      title: SESSION_COMMAND_LABELS.inspectMcp,
      value: "session.inspect.mcp",
      keybind: SESSION_COMMAND_BINDINGS.inspectMcp,
      category: "Session",
      onSelect: (dialog) => {
        openMcpInspect()
        dialog.clear()
      },
    },
    {
      title: SESSION_COMMAND_LABELS.reviewDocs,
      value: "session.review.docs",
      category: "Session",
      enabled: auditPaneEnabled(),
      onSelect: (dialog) => {
        openDocsReview()
        dialog.clear()
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
      title: SESSION_COMMAND_LABELS.jumpTimeline,
      value: "session.jump.timeline",
      keybind: SESSION_COMMAND_BINDINGS.jumpTimeline,
      category: "Session",
      onSelect: (dialog) => {
        openTimelineReview()
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
      title: `Pane mode: ${paneLabel("artifact")}${paneMode() === "artifact" ? " (active)" : ""}`,
      value: "session.pane.mode.artifact",
      category: "View",
      onSelect: (dialog) => {
        setPaneMode(() => "artifact")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
        toast.show({ message: `Pane mode: ${paneLabel("artifact")}`, variant: "success" })
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
      title: `Pane mode: ${paneLabel("rao")}${paneMode() === "rao" ? " (active)" : ""}`,
      value: "session.pane.mode.rao",
      category: "View",
      onSelect: (dialog) => {
        setPaneMode(() => "rao")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
        toast.show({ message: `Pane mode: ${paneLabel("rao")}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane mode: ${paneLabel("pm")}${paneMode() === "pm" ? " (active)" : ""}`,
      value: "session.pane.mode.pm",
      category: "View",
      onSelect: (dialog) => {
        setPaneMode(() => "pm")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
        toast.show({ message: `Pane mode: ${paneLabel("pm")}`, variant: "success" })
        dialog.clear()
      },
    },
    {
      title: `Pane mode: ${paneLabel("audit")}${paneMode() === "audit" ? " (active)" : ""}`,
      value: "session.pane.mode.audit",
      category: "View",
      enabled: auditPaneEnabled(),
      onSelect: (dialog) => {
        setPaneMode(() => "audit")
        setPaneVisibility((prev) => (prev === "hidden" ? "pinned" : prev))
        toast.show({ message: `Pane mode: ${paneLabel("audit")}`, variant: "success" })
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
      title: explainMode() ? "Thinking hidden in ELI12 mode" : showThinking() ? "Hide thinking" : "Show thinking",
      value: "session.toggle.thinking",
      keybind: "display_thinking",
      category: "Session",
      onSelect: (dialog) => {
        if (explainMode()) {
          toast.show({
            variant: "info",
            message: "Thinking is hidden while ELI12 mode is enabled",
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
      title: SESSION_COMMAND_LABELS.jumpLastRequest,
      value: "session.jump.request",
      keybind: SESSION_COMMAND_BINDINGS.jumpLastRequest,
      category: "Session",
      hidden: false,
      onSelect: () => jumpToLastUserMessage(),
    },
    {
      title: SESSION_COMMAND_LABELS.next,
      value: "session.jump.next",
      keybind: SESSION_COMMAND_BINDINGS.next,
      category: "Session",
      hidden: false,
      onSelect: (dialog) => scrollToMessage("next", dialog),
    },
    {
      title: SESSION_COMMAND_LABELS.previous,
      value: "session.jump.previous",
      keybind: SESSION_COMMAND_BINDINGS.previous,
      category: "Session",
      hidden: false,
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
    } catch (error) {
      return []
    }
  })
  const headerDetail = createMemo(() => {
    if (permissions().length + questions().length > 0) {
      return `${permissions().length + questions().length} approval${permissions().length + questions().length === 1 ? "" : "s"}`
    }
    if (pendingUpdates() > 0 && paneFollowMode() === "smart" && !smartFollowActive()) {
      return `${pendingUpdates()} update${pendingUpdates() === 1 ? "" : "s"} ready`
    }
    if (sessionDiffs().length > 0 && paneVisibility() !== "pinned") {
      return `${sessionDiffs().length} changed file${sessionDiffs().length === 1 ? "" : "s"}`
    }
    const mcpBlocked = Object.values(sync.data.mcp).filter(
      (x) => x.status === "failed" || x.status === "needs_auth" || x.status === "needs_client_registration",
    ).length
    if (mcpBlocked > 0) {
      return `${mcpBlocked} MCP issue${mcpBlocked === 1 ? "" : "s"}`
    }
    const pendingID = pending()
    if (pendingID) {
      const pendingMessage = messages().find(
        (message): message is AssistantMessage => message.id === pendingID && message.role === "assistant",
      )
      const parentID = pendingMessage?.parentID
      const askedPart =
        parentID &&
        (sync.data.part[parentID] ?? []).find((part) => part.type === "text" && "text" in part && part.text.trim())
      const asked = askedPart && "text" in askedPart ? askedPart.text : ""
      const parts = sync.data.part[pendingID] ?? []
      const completedTools = parts.filter((part): part is ToolPart => part.type === "tool" && part.state.status === "completed")
      const pendingTool = parts.findLast((part): part is ToolPart => part.type === "tool" && part.state.status === "pending")
      const milestone = describeOperationalMilestone({
        asked,
        completedTools,
        pendingTool,
        hasReasoning: parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0),
        explainMode: explainMode(),
      })
      if (milestone.found) return `Found: ${milestone.found}`
      if (milestone.checking) return `Checking: ${milestone.checking}`
      if (milestone.next) return `Next: ${milestone.next}`
    }
    return undefined
  })
  const mcpNeedsAttention = createMemo(
    () =>
      Object.values(sync.data.mcp).some(
        (x) => x.status === "failed" || x.status === "needs_auth" || x.status === "needs_client_registration",
      ),
  )
  const reviewBarVisible = createMemo(
    () =>
      hasRaoNeed() ||
      sessionDiffs().length > 0 ||
      mcpNeedsAttention() ||
      !!latestDocsQa()?.result ||
      todo().length > 0,
  )
  const headerActions = createMemo(() => {
    const actions: Array<{ label: string; onPress: () => void; primary?: boolean }> = [
      { label: explainMode() ? "Expert" : "Explain", onPress: toggleExplainMode },
      { label: showDetails() ? "Trace on" : "Trace", onPress: toggleTraceVisibility },
    ]
    if (reviewBarVisible()) {
      actions.push({
        label: explainMode() ? "Review now" : "Review",
        onPress: openPrimaryReview,
        primary: hasRaoNeed(),
      })
    } else {
      actions.push({
        label: preferredName() ? preferredName()! : "Name",
        onPress: editPreferredName,
      })
    }
    return actions.slice(0, 3)
  })

  const revertRevertedMessages = createMemo(() => {
    const messageID = revertMessageID()
    if (!messageID) return []
    return messages().filter((x) => x.id >= messageID && x.role === "user")
  })

  const revert = createMemo(() => {
    const info = revertInfo()
    if (!info) return
    if (!info.messageID) return
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

  const liveArtifact = createMemo(() => {
    for (const msg of [...messages()].reverse()) {
      if (msg.role !== "assistant") continue
      const tool = [...(sync.data.part[msg.id] ?? [])].reverse().find((x): x is ToolPart => x.type === "tool")
      if (!tool) continue
      const input = (tool.state.input ?? {}) as Record<string, any>
      const pathHint = input.path || input.file || input.filename || input.target || ""
      const output = tool.state.status === "completed" ? tool.state.output : tool.state.input
      let body = ""
      if (typeof output === "string") body = output
      else {
        try {
          body = JSON.stringify(output ?? {}, null, 2)
        } catch {
          body = ""
        }
      }
      return {
        active: true,
        title: pathHint ? `${tool.tool} · ${pathHint}` : `${tool.tool} · latest`,
        body: body || (tool.state.status === "completed" ? "Completed." : "Running..."),
      }
    }
    return {
      active: false,
      title: "No active artifact",
      body: "Ask DAX to make a change and this pane will display the generated artifact stream.",
    }
  })
  const hasDiffNeed = createMemo(() => !!revert()?.diff)
  const hasArtifactNeed = createMemo(() => liveArtifact().active && chatActive() && paneVisibility() === "pinned")
  const showPane = createMemo(() => {
    if (paneVisibility() === "hidden") return false
    if (paneVisibility() === "pinned") return true
    return hasRaoNeed() || hasDiffNeed()
  })
  const activePaneMode = createMemo<PaneMode>(() => {
    if (paneVisibility() === "pinned") return paneMode()
    if (hasRaoNeed()) return "rao"
    if (hasDiffNeed()) return "diff"
    return paneMode()
  })
  const paneExpanded = createMemo(() => paneVisibility() === "pinned")
  const paneSummaryMode = createMemo(() => showPane() && !paneExpanded())
  const visiblePaneModes = createMemo(() => {
    const modes = new Set<PaneMode>(["artifact"])
    if (activePaneMode() === "diff" || hasDiffNeed() || sessionDiffs().length > 0) modes.add("diff")
    if (activePaneMode() === "rao" || hasRaoNeed()) modes.add("rao")
    if (activePaneMode() === "pm" || todo().length > 0 || recentPmCommands().length > 0) modes.add("pm")
    if (activePaneMode() === "audit" || !!latestAudit()?.result || !!latestDocsQa()?.result) modes.add("audit")
    return availablePaneModes().filter((mode) => modes.has(mode))
  })

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
  createEffect(() => {
    updateTranscriptPosition()
    const timer = setInterval(updateTranscriptPosition, 150)
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

  return (
    <context.Provider
      value={{
        get width() {
          return contentWidth()
        },
        sessionID: route.sessionID,
        conceal,
        showThinking: () => showThinking() && !explainMode(),
        showTimestamps,
        showDetails,
        diffWrapMode,
        sync,
      }}
    >
      <box flexDirection="row">
        <box flexGrow={1} minHeight={0} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
          <Header
            stageLabel={stageLabel()}
            stageReason={displayStageState().reason}
            detail={headerDetail()}
            emphasis={hasRaoNeed() || pendingUpdates() > 0 ? "normal" : "muted"}
            actions={headerActions()}
          />
          <Show when={transcriptNavigatorVisible()}>
              <box
                flexDirection="row"
                gap={1}
                alignItems="center"
                flexWrap="wrap"
                flexShrink={0}
                paddingLeft={1}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                border={["top"]}
                borderColor={theme.borderSubtle}
                backgroundColor={theme.backgroundPanel}
              >
                <text fg={transcriptPosition().live ? theme.success : theme.textMuted}>
                  {transcriptPosition().total > 0 ? `${transcriptPosition().current}/${transcriptPosition().total}` : "0/0"}
                </text>
                <Show when={!shellTight()}>
                  <text fg={transcriptPosition().live ? theme.success : theme.textMuted}>{transcriptPosition().label}</text>
                </Show>
                <SessionQuickAction
                  theme={theme}
                  label={shellTight() ? SESSION_COMMAND_LABELS.previous : `${SESSION_COMMAND_LABELS.previous} ${keyHint(SESSION_COMMAND_BINDINGS.previous)}`.trim()}
                  onPress={() => scrollToMessageDirect("prev")}
                  muted
                />
                <SessionQuickAction
                  theme={theme}
                  label={shellTight() ? SESSION_COMMAND_LABELS.next : `${SESSION_COMMAND_LABELS.next} ${keyHint(SESSION_COMMAND_BINDINGS.next)}`.trim()}
                  onPress={() => scrollToMessageDirect("next")}
                  muted
                />
                <SessionQuickAction
                  theme={theme}
                  label={shellCompact() ? "Request" : `${SESSION_COMMAND_LABELS.jumpLastRequest} ${keyHint(SESSION_COMMAND_BINDINGS.jumpLastRequest)}`.trim()}
                  onPress={jumpToLastUserMessage}
                  muted
                />
                <Show when={pendingUpdates() > 0 || !smartFollowActive()}>
                  <SessionQuickAction theme={theme} label={SESSION_COMMAND_LABELS.jumpLive} onPress={jumpToLive} muted />
                </Show>
              </box>
            </Show>
            <Show when={reviewBarVisible()}>
              <box
                flexDirection="row"
                gap={1}
                alignItems="center"
                flexWrap="wrap"
                flexShrink={0}
                paddingLeft={1}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                border={["top"]}
                borderColor={theme.borderSubtle}
                backgroundColor={theme.backgroundPanel}
              >
                <Show when={hasRaoNeed()}>
                  <SessionQuickAction
                    theme={theme}
                    label={
                      shellTight()
                        ? "Approvals"
                        : `${SESSION_COMMAND_LABELS.reviewApprovals} ${keyHint(SESSION_COMMAND_BINDINGS.reviewApprovals) || keyHint("command_list")}`.trim()
                    }
                    onPress={openApprovalsReview}
                    primary
                  />
                </Show>
                <Show when={sessionDiffs().length > 0}>
                  <SessionQuickAction
                    theme={theme}
                    label={shellTight() ? "Diff" : `${SESSION_COMMAND_LABELS.reviewDiff} ${keyHint(SESSION_COMMAND_BINDINGS.reviewDiff)}`.trim()}
                    onPress={openDiffReview}
                  />
                </Show>
                <Show when={mcpNeedsAttention()}>
                  <SessionQuickAction
                    theme={theme}
                    label={shellTight() ? "MCP" : `${SESSION_COMMAND_LABELS.inspectMcp} ${keyHint(SESSION_COMMAND_BINDINGS.inspectMcp)}`.trim()}
                    onPress={openMcpInspect}
                  />
                </Show>
                <Show when={!!latestDocsQa()?.result}>
                  <SessionQuickAction
                    theme={theme}
                    label={shellTight() ? "Docs" : SESSION_COMMAND_LABELS.reviewDocs}
                    onPress={openDocsReview}
                  />
                </Show>
                <Show when={!shellTight() && todo().length > 0}>
                  <SessionQuickAction theme={theme} label={memoryLabel(explainMode())} onPress={openPmPane} />
                </Show>
              </box>
            </Show>
            <box flexGrow={1} minHeight={0}>
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
                      <text fg={theme.background}>Reset pane</text>
                    </box>
                  </box>
                )}
              >
                <Switch>
                  <Match when={showPane()}>
                <box
                  flexGrow={1}
                  flexDirection={liveStacked() ? "column" : "row"}
                  minHeight={0}
                  border={["top", "right", "bottom", "left"]}
                  borderColor={theme.borderSubtle}
                >
                  <box
                    flexGrow={mainPaneGrow()}
                    minHeight={0}
                    border={liveStacked() ? ["bottom"] : ["right"]}
                    borderColor={theme.borderSubtle}
                    padding={0}
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
                      <For each={messages()}>
                        {(message, index) => (
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
                                      <box flexDirection="row" gap={1} flexWrap="wrap">
                                        <text fg={theme.text}>{keybind.print("messages_redo")}</text>
                                        <text fg={theme.textMuted}>to restore</text>
                                      </box>
                                      <Show when={revert()!.diffFiles?.length}>
                                        <box marginTop={1}>
                                          <For each={revert()!.diffFiles}>
                                            {(file) => (
                                              <box flexDirection="row" gap={1} flexWrap="wrap">
                                                <text fg={theme.text}>{file.filename}</text>
                                                <Show when={file.additions > 0}>
                                                  <text fg={theme.diffAdded}>+{file.additions}</text>
                                                </Show>
                                                <Show when={file.deletions > 0}>
                                                  <text fg={theme.diffRemoved}>-{file.deletions}</text>
                                                </Show>
                                              </box>
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
                                phase={orchestrationPhase()}
                                stageLabel={stageLabel()}
                                stageColor={stageColor()}
                                streamStatus={streamStatus()}
                                explainMode={explainMode()}
                              />
                              <AssistantMessage
                                last={lastAssistant()?.id === message.id}
                                message={message as AssistantMessage}
                                parts={renderParts(message)}
                              />
                            </Match>
                          </Switch>
                        )}
                      </For>
                    </scrollbox>
                  </box>
                  <scrollbox
                    flexGrow={sidePaneGrow()}
                    minHeight={0}
                    backgroundColor={tint(theme.backgroundPanel, theme.borderSubtle, 0.03)}
                    scrollAcceleration={scrollAcceleration()}
                  >
                    <box padding={1} gap={1} backgroundColor={tint(theme.backgroundPanel, theme.borderSubtle, 0.03)} flexDirection="column">
                      <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                        <For each={visiblePaneModes()}>
                          {(mode) => (
                            <box
                              onMouseUp={() => {
                                setPaneMode(() => mode)
                                if (paneVisibility() === "hidden") {
                                  setPaneVisibility(() => "auto")
                                }
                              }}
                              backgroundColor={activePaneMode() === mode ? theme.backgroundElement : undefined}
                              paddingLeft={1}
                              paddingRight={1}
                            >
                              <text
                                fg={activePaneMode() === mode ? theme.primary : theme.textMuted}
                                attributes={activePaneMode() === mode ? TextAttributes.BOLD : undefined}
                              >
                                {paneTitle(mode)}
                              </text>
                            </box>
                          )}
                        </For>
                        <Show when={paneSummaryMode()}>
                          <box
                            onMouseUp={() => setPaneVisibility(() => "pinned")}
                            backgroundColor={theme.backgroundElement}
                            paddingLeft={1}
                            paddingRight={1}
                          >
                            <text fg={theme.primary}>Open</text>
                          </box>
                        </Show>
                        <Show when={!paneSummaryMode()}>
                          <box
                            onMouseUp={() => setPaneVisibility(() => "hidden")}
                            backgroundColor={theme.backgroundElement}
                            paddingLeft={1}
                            paddingRight={1}
                          >
                            <text fg={theme.textMuted}>Hide</text>
                          </box>
                        </Show>
                      </box>
                      <Switch>
                        <Match when={activePaneMode() === "artifact"}>
                          <Show
                            when={paneSummaryMode()}
                            fallback={
                              <>
                                <text fg={theme.primary}>{liveArtifact().title}</text>
                                <text fg={theme.textMuted} wrapMode="word">
                                  {liveArtifact().body}
                                </text>
                              </>
                            }
                          >
                            <text fg={theme.primary}>Artifact</text>
                            <text fg={theme.text}>{liveArtifact().title}</text>
                            <text fg={theme.textMuted} wrapMode="word">
                              {liveArtifact().active ? "Latest artifact ready. Open detail for full output." : "No live artifact yet."}
                            </text>
                          </Show>
                        </Match>
                        <Match when={activePaneMode() === "diff"}>
                          <Show
                            when={paneSummaryMode()}
                            fallback={
                          <Show
                            when={revert()?.diff}
                            fallback={
                              <Show
                                when={sessionDiffs().length > 0}
                                fallback={<text fg={theme.textMuted}>No tracked file changes yet for this session.</text>}
                              >
                                <box flexDirection="column" gap={1} flexGrow={1}>
                                  <text fg={theme.primary}>What changed</text>
                                  <box flexDirection="row" gap={1} flexWrap="wrap">
                                    <text fg={theme.textMuted}>{sessionDiffSummary().files} files</text>
                                    <text fg={theme.textMuted}>·</text>
                                    <text fg={theme.diffAdded}>+{sessionDiffSummary().additions}</text>
                                    <text fg={theme.textMuted}>·</text>
                                    <text fg={theme.diffRemoved}>-{sessionDiffSummary().deletions}</text>
                                  </box>
                                  <For each={sessionDiffs()}>
                                    {(item) => (
                                      <box
                                        flexDirection="row"
                                        justifyContent="space-between"
                                        backgroundColor={theme.backgroundElement}
                                        paddingLeft={1}
                                        paddingRight={1}
                                      >
                                        <text fg={theme.text}>{item.file}</text>
                                        <box flexDirection="row" gap={1}>
                                          <Show when={item.additions > 0}>
                                            <text fg={theme.diffAdded}>+{item.additions}</text>
                                          </Show>
                                          <Show when={item.deletions > 0}>
                                            <text fg={theme.diffRemoved}>-{item.deletions}</text>
                                          </Show>
                                        </box>
                                      </box>
                                    )}
                                  </For>
                                </box>
                              </Show>
                            }
                          >
                            <box flexDirection="column" gap={1} flexGrow={1} width="100%">
                              <Show when={revert()?.diffFiles?.length}>
                                <box flexDirection="column" gap={0}>
                                  <For each={revert()?.diffFiles ?? []}>
                                    {(file) => (
                                      <box flexDirection="row" gap={1} flexWrap="wrap">
                                        <text fg={theme.text}>{file.filename}</text>
                                        <Show when={file.additions > 0}>
                                          <text fg={theme.diffAdded}>+{file.additions}</text>
                                        </Show>
                                        <Show when={file.deletions > 0}>
                                          <text fg={theme.diffRemoved}>-{file.deletions}</text>
                                        </Show>
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
                                    diff={revert()!.diff ?? ""}
                                    view={paneDiffView()}
                                    filetype={paneDiffFiletype()}
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
                            }
                          >
                            <text fg={theme.primary}>Diff</text>
                            <Show
                              when={revert()?.diff || sessionDiffs().length > 0}
                              fallback={<text fg={theme.textMuted}>No tracked file changes yet for this session.</text>}
                            >
                              <text fg={theme.text}>
                                {revert()?.diff
                                  ? `${revert()?.diffFiles?.length ?? 0} file change${(revert()?.diffFiles?.length ?? 0) === 1 ? "" : "s"} ready to review`
                                  : `${sessionDiffSummary().files} file change${sessionDiffSummary().files === 1 ? "" : "s"} in this session`}
                              </text>
                              <box flexDirection="row" gap={1} flexWrap="wrap">
                                <text fg={theme.diffAdded}>+{revert()?.diff ? revert()?.diffFiles?.reduce((sum, file) => sum + file.additions, 0) ?? 0 : sessionDiffSummary().additions}</text>
                                <text fg={theme.textMuted}>·</text>
                                <text fg={theme.diffRemoved}>-{revert()?.diff ? revert()?.diffFiles?.reduce((sum, file) => sum + file.deletions, 0) ?? 0 : sessionDiffSummary().deletions}</text>
                              </box>
                            </Show>
                          </Show>
                        </Match>
                        <Match when={activePaneMode() === "rao"}>
                          <Show
                            when={paneSummaryMode()}
                            fallback={
                              <box flexGrow={1} minHeight={0}>
                                <RAOPane
                                  permissions={permissions()}
                                  questions={questions()}
                                  sessionID={route.sessionID}
                                  initialRequestID={raoFocusRequestID()}
                                />
                              </box>
                            }
                          >
                            <text fg={theme.primary}>{paneTitle("rao")}</text>
                            <text fg={permissions().length + questions().length > 0 ? theme.warning : theme.text}>
                              {permissions().length + questions().length > 0
                                ? `${permissions().length + questions().length} item${permissions().length + questions().length === 1 ? "" : "s"} awaiting operator review`
                                : "No approvals waiting."}
                            </text>
                          </Show>
                        </Match>
                        <Match when={activePaneMode() === "pm"}>
                          <Show
                            when={paneSummaryMode()}
                            fallback={
                          <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
                            <text fg={theme.text}>Project Memory</text>
                            <text fg={theme.textMuted} wrapMode="word">
                              {pmTab() === "note"
                                ? "Capture durable constraints and handoff context."
                                : pmTab() === "list"
                                  ? `Recent notes: ${parsedPmList().empty ? "none yet" : parsedPmList().rows.length}.`
                                  : `Rules: ${parsedPmRules().empty ? "none yet" : parsedPmRules().rows.length}.`}
                            </text>
                            <box flexDirection="row" gap={1} flexWrap="wrap">
                              <For each={["note", "list", "rules"] as PMTab[]}>
                                {(tab) => (
                                  <box
                                    onMouseUp={() => setPmTab(() => tab)}
                                    backgroundColor={pmTab() === tab ? theme.backgroundElement : undefined}
                                    paddingLeft={1}
                                    paddingRight={1}
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
                            <Show
                              when={paneExpanded()}
                              fallback={
                                <box flexDirection="row" gap={1} flexWrap="wrap">
                                  <Match when={pmTab() === "note"}>
                                    <box
                                      onMouseUp={prefillPmNote}
                                      backgroundColor={theme.backgroundElement}
                                      paddingLeft={1}
                                      paddingRight={1}
                                    >
                                      <text fg={theme.primary}>Template</text>
                                    </box>
                                    <box
                                      onMouseUp={() => runPmCommand("/pm note")}
                                      backgroundColor={theme.backgroundElement}
                                      paddingLeft={1}
                                      paddingRight={1}
                                    >
                                      <text fg={theme.accent}>Run /pm note</text>
                                    </box>
                                  </Match>
                                  <Match when={pmTab() === "list"}>
                                    <box
                                      onMouseUp={() => runPmCommand("/pm list")}
                                      backgroundColor={theme.backgroundElement}
                                      paddingLeft={1}
                                      paddingRight={1}
                                    >
                                      <text fg={theme.accent}>Run /pm list</text>
                                    </box>
                                  </Match>
                                  <Match when={pmTab() === "rules"}>
                                    <box
                                      onMouseUp={() => runPmCommand("/pm rules")}
                                      backgroundColor={theme.backgroundElement}
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
                                      paddingLeft={1}
                                      paddingRight={1}
                                    >
                                      <text fg={theme.primary}>Add rule template</text>
                                    </box>
                                  </Match>
                                </box>
                              }
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
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text fg={theme.primary}>Template</text>
                                  </box>
                                  <box
                                    onMouseUp={() => runPmCommand("/pm note")}
                                    backgroundColor={theme.backgroundElement}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text fg={theme.accent}>Run /pm note</text>
                                  </box>
                                </box>
                              </Match>
                              <Match when={pmTab() === "list"}>
                                <text fg={theme.textMuted} wrapMode="word">
                                  List recent PM notes and tags for this workspace.
                                </text>
                                <box flexDirection="row" gap={1} flexWrap="wrap">
                                  <box
                                    onMouseUp={() => runPmCommand("/pm list")}
                                    backgroundColor={theme.backgroundElement}
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
                                    fallback={<text fg={theme.textMuted} wrapMode="word">{parsedPmList().info}</text>}
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
                                    fallback={<text fg={theme.textMuted} wrapMode="word">{parsedPmRules().info}</text>}
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
                                            pattern: {row.pattern}
                                          </text>
                                          <Show when={row.source}>
                                            <text fg={theme.textMuted}>source: {row.source}</text>
                                          </Show>
                                        </box>
                                      )}
                                    </For>
                                  </Show>
                                </box>
                              </Match>
                              </Switch>
                              <box border={["top"]} borderColor={theme.borderSubtle} paddingTop={1} flexDirection="column" gap={1}>
                                <text fg={theme.textMuted}>Recent PM activity</text>
                                <Show
                                  when={recentPmCommands().length > 0}
                                  fallback={<text fg={theme.textMuted}>No PM commands yet in this session.</text>}
                                >
                                  <For each={recentPmCommands()}>
                                    {(entry) => (
                                      <box
                                        onMouseUp={() => prompt?.set({ input: entry.text, parts: [] })}
                                        paddingLeft={1}
                                        paddingRight={1}
                                        backgroundColor={theme.backgroundElement}
                                      >
                                        <text fg={theme.text} wrapMode="word">
                                          {entry.text}
                                        </text>
                                      </box>
                                    )}
                                  </For>
                                </Show>
                              </box>
                            </Show>
                          </box>
                            }
                          >
                            <text fg={theme.primary}>Project memory</text>
                            <text fg={theme.textMuted} wrapMode="word">
                              {parsedPmList().empty
                                ? "No saved PM notes yet."
                                : `${parsedPmList().rows.length} recent note${parsedPmList().rows.length === 1 ? "" : "s"} available.`}
                            </text>
                            <text fg={theme.textMuted} wrapMode="word">
                              {parsedPmRules().empty
                                ? "No persistent rules yet."
                                : `${parsedPmRules().rows.length} rule${parsedPmRules().rows.length === 1 ? "" : "s"} configured.`}
                            </text>
                          </Show>
                        </Match>
                        <Match when={activePaneMode() === "audit"}>
                          <Show
                            when={paneSummaryMode()}
                            fallback={
                          <box flexGrow={1} minHeight={0} flexDirection="column" gap={1}>
                            <text fg={theme.text}>Audit</text>
                            <Show
                              when={auditPaneEnabled()}
                              fallback={
                                <text fg={theme.textMuted} wrapMode="word">
                                  Audit beta is disabled. Enable `DAX_AUDIT_BETA=1` or `config.audit.enabled=true`.
                                </text>
                              }
                              >
                                <box flexDirection="row" gap={1} flexWrap="wrap">
                                  <box
                                  onMouseUp={() => runAuditCommand("/audit")}
                                  backgroundColor={theme.backgroundElement}
                                  paddingLeft={1}
                                  paddingRight={1}
                                >
                                  <text fg={theme.accent}>Run /audit</text>
                                </box>
                                <box
                                  onMouseUp={() => runAuditCommand("/audit gate")}
                                  backgroundColor={theme.backgroundElement}
                                  paddingLeft={1}
                                  paddingRight={1}
                                >
                                  <text fg={theme.primary}>Run /audit gate</text>
                                </box>
                                <For each={["strict", "balanced", "advisory"] as const}>
                                  {(profile) => (
                                    <box
                                      onMouseUp={() => runAuditCommand(`/audit profile ${profile}`)}
                                      backgroundColor={theme.backgroundElement}
                                      paddingLeft={1}
                                      paddingRight={1}
                                    >
                                      <text fg={theme.textMuted}>profile:{profile}</text>
                                    </box>
                                  )}
                                </For>
                              </box>
                              <Show when={paneExpanded()}>
                                <box flexDirection="row" gap={1} flexWrap="wrap">
                                  <box
                                    onMouseUp={() => runAuditCommand("/docs qa")}
                                    backgroundColor={theme.backgroundElement}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text fg={theme.accent}>Run /docs qa</text>
                                  </box>
                                  <box
                                    onMouseUp={() => runAuditCommand("/docs qa --strict")}
                                    backgroundColor={theme.backgroundElement}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text fg={theme.warning}>/docs qa --strict</text>
                                  </box>
                                  <box
                                    onMouseUp={() => runAuditCommand("/docs guide")}
                                    backgroundColor={theme.backgroundElement}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text fg={theme.textMuted}>/docs guide</text>
                                  </box>
                                  <box
                                    onMouseUp={() => runAuditCommand("/docs spec")}
                                    backgroundColor={theme.backgroundElement}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text fg={theme.textMuted}>/docs spec</text>
                                  </box>
                                  <box
                                    onMouseUp={() => runAuditCommand("/docs release-notes")}
                                    backgroundColor={theme.backgroundElement}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text fg={theme.textMuted}>/docs release-notes</text>
                                  </box>
                                  <box
                                    onMouseUp={() => runAuditCommand("/docs prd")}
                                    backgroundColor={theme.backgroundElement}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text fg={theme.textMuted}>/docs prd</text>
                                  </box>
                                  <box
                                    onMouseUp={() => runAuditCommand("/docs rfc")}
                                    backgroundColor={theme.backgroundElement}
                                    paddingLeft={1}
                                    paddingRight={1}
                                  >
                                    <text fg={theme.textMuted}>/docs rfc</text>
                                  </box>
                                </box>
                              </Show>
                              <Show
                                when={latestAudit()?.result}
                                fallback={<text fg={theme.textMuted}>No parsed audit result yet in this session.</text>}
                              >
                                {(latest) => (
                                  <box flexDirection="column" gap={1}>
                                    <text fg={theme.text}>
                                      status: {latest().status} | profile: {latest().profile}
                                    </text>
                                    <Show when={auditSummary()}>
                                      {(summary) => (
                                        <text fg={theme.textMuted}>
                                          blockers: {summary().blocker_count} · warnings: {summary().warning_count} · info:{" "}
                                          {summary().info_count}
                                        </text>
                                      )}
                                    </Show>
                                    <Show when={paneExpanded()}>
                                      <box
                                        border={["top"]}
                                        borderColor={theme.borderSubtle}
                                        paddingTop={1}
                                        flexDirection="column"
                                        gap={1}
                                      >
                                        <text fg={theme.textMuted}>Findings</text>
                                        <Show
                                          when={auditFindings().length > 0}
                                          fallback={<text fg={theme.textMuted}>No findings.</text>}
                                        >
                                          <For each={auditFindings().slice(0, 8)}>
                                            {(finding) => (
                                              <box
                                                flexDirection="column"
                                                paddingLeft={1}
                                                paddingRight={1}
                                                backgroundColor={theme.backgroundElement}
                                              >
                                                <text
                                                  fg={
                                                    finding.blocking
                                                      ? theme.error
                                                      : finding.severity === "high"
                                                        ? theme.warning
                                                        : theme.text
                                                  }
                                                >
                                                  {finding.blocking ? "BLOCKER" : finding.severity.toUpperCase()} | {finding.title}
                                                </text>
                                                <text fg={theme.textMuted} wrapMode="word">
                                                  {finding.id} · {finding.category}
                                                </text>
                                                <text fg={theme.textMuted} wrapMode="word">
                                                  fix: {finding.fix}
                                                </text>
                                              </box>
                                            )}
                                          </For>
                                        </Show>
                                      </box>
                                    </Show>
                                  </box>
                                )}
                              </Show>
                              <box
                                border={["top"]}
                                borderColor={theme.borderSubtle}
                                paddingTop={1}
                                flexDirection="column"
                                gap={1}
                              >
                                <text fg={theme.textMuted}>Docs QA</text>
                                <Show
                                  when={latestDocsQa()?.result}
                                  fallback={<text fg={theme.textMuted}>No docs QA result yet in this session.</text>}
                                >
                                  {(result) => (
                                    <box flexDirection="column" gap={1}>
                                      <text fg={theme.text}>
                                        status: {result().status} | blockers: {result().summary.blocker_count} | warnings:{" "}
                                        {result().summary.warning_count}
                                      </text>
                                      <Show when={paneExpanded()}>
                                        <Show
                                          when={result().checks.length > 0}
                                          fallback={<text fg={theme.textMuted}>No docs QA findings.</text>}
                                        >
                                          <For each={result().checks.slice(0, 4)}>
                                            {(check) => (
                                              <box
                                                flexDirection="column"
                                                paddingLeft={1}
                                                paddingRight={1}
                                                backgroundColor={theme.backgroundElement}
                                              >
                                                <text fg={check.blocking ? theme.error : theme.text}>
                                                  {check.blocking ? "BLOCKER" : check.severity.toUpperCase()} | {check.title}
                                                </text>
                                                <text fg={theme.textMuted} wrapMode="word">
                                                  {check.evidence}
                                                </text>
                                              </box>
                                            )}
                                          </For>
                                        </Show>
                                      </Show>
                                    </box>
                                  )}
                                </Show>
                              </box>
                            </Show>
                          </box>
                            }
                          >
                            <text fg={theme.primary}>Audit</text>
                            <Show
                              when={latestAudit()?.result}
                              fallback={<text fg={theme.textMuted}>No audit result yet in this session.</text>}
                            >
                              {(latest) => (
                                <>
                                  <text fg={theme.text}>
                                    {latest().status === "fail" ? "Audit needs attention." : latest().status === "warn" ? "Audit has warnings." : "Audit passed."}
                                  </text>
                                  <text fg={theme.textMuted}>
                                    blockers: {latest().summary.blocker_count} · warnings: {latest().summary.warning_count}
                                  </text>
                                </>
                              )}
                            </Show>
                            <Show when={latestDocsQa()?.result}>
                              {(result) => (
                                <text fg={theme.textMuted}>
                                  Docs QA: {result().status} · blockers {result().summary.blocker_count}
                                </text>
                              )}
                            </Show>
                          </Show>
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
                  <For each={messages()}>
                    {(message, index) => (
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
                                  <box flexDirection="row" gap={1} flexWrap="wrap">
                                    <text fg={theme.text}>{keybind.print("messages_redo")}</text>
                                    <text fg={theme.textMuted}>to restore</text>
                                  </box>
                                  <Show when={revert()!.diffFiles?.length}>
                                    <box marginTop={1}>
                                      <For each={revert()!.diffFiles}>
                                        {(file) => (
                                          <box flexDirection="row" gap={1} flexWrap="wrap">
                                            <text fg={theme.text}>{file.filename}</text>
                                            <Show when={file.additions > 0}>
                                              <text fg={theme.diffAdded}>+{file.additions}</text>
                                            </Show>
                                            <Show when={file.deletions > 0}>
                                              <text fg={theme.diffRemoved}>-{file.deletions}</text>
                                            </Show>
                                          </box>
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
                            phase={orchestrationPhase()}
                            stageLabel={stageLabel()}
                            stageColor={stageColor()}
                            streamStatus={streamStatus()}
                            explainMode={explainMode()}
                          />
                          <AssistantMessage
                            last={lastAssistant()?.id === message.id}
                            message={message as AssistantMessage}
                            parts={renderParts(message)}
                          />
                        </Match>
                      </Switch>
                    )}
                  </For>
                </scrollbox>
              </Match>
                </Switch>
              </ErrorBoundary>
            </box>
            <box flexShrink={0}>
              <Show when={actionStripState()}>
                {(strip) => (
                  <box
                    flexDirection="column"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                    paddingBottom={1}
                    border={["top"]}
                    borderColor={theme.borderSubtle}
                  >
                    <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                      <text
                        fg={
                          strip().state === "needs approval"
                            ? theme.warning
                            : strip().state === "blocked"
                              ? theme.error
                              : theme.accent
                        }
                      >
                        {strip().state}
                      </text>
                      <text fg={theme.textMuted}>{strip().detail}</text>
                    </box>
                    <box flexDirection="row" gap={1} flexWrap="wrap">
                      <SessionQuickAction
                        theme={theme}
                        label={strip().primaryLabel}
                        onPress={strip().primaryAction}
                        primary
                      />
                      <Show when={strip().state !== "connected" && sessionDiffs().length > 0}>
                        <SessionQuickAction theme={theme} label={SESSION_COMMAND_LABELS.reviewDiff} onPress={openDiffReview} />
                      </Show>
                      <Show when={strip().state === "blocked" && todo().length > 0}>
                        <SessionQuickAction theme={theme} label={`Open ${memoryLabel(explainMode())}`} onPress={openPmPane} />
                      </Show>
                      <Show when={strip().state === "blocked" && Object.keys(sync.data.mcp).length > 0}>
                        <SessionQuickAction theme={theme} label={SESSION_COMMAND_LABELS.inspectMcp} onPress={openMcpInspect} />
                      </Show>
                      <Show when={strip().state === "blocked" && auditPaneEnabled()}>
                        <SessionQuickAction theme={theme} label={SESSION_COMMAND_LABELS.reviewDocs} onPress={openDocsReview} />
                      </Show>
                      <Show when={pendingUpdates() > 0 || !smartFollowActive()}>
                        <SessionQuickAction theme={theme} label={SESSION_COMMAND_LABELS.jumpLive} onPress={jumpToLive} muted />
                      </Show>
                    </box>
                  </box>
                )}
              </Show>
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
                onSubmit={() => {
                  toBottom()
                }}
                sessionID={route.sessionID}
              />
            </box>
            <Show when={!sidebarVisible() || !wide()}>
              <Footer />
            </Show>
          <Toast />
        </box>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar
                sessionID={route.sessionID}
                onInspectApprovals={openApprovalsReview}
                onInspectDiff={openDiffReview}
                onInspectMcp={openMcpInspect}
                onOpenPm={openPmPane}
                onOpenTimeline={openTimelineReview}
                onJumpLive={jumpToLive}
                onNavigateMessage={scrollToMessageDirect}
                onJumpLastUser={jumpToLastUserMessage}
                timelineHint={keyHint("session_timeline")}
                prevHint={keyHint("messages_previous")}
                nextHint={keyHint("messages_next")}
                lastUserHint={keyHint("messages_last_user")}
                commandHint={keyHint("command_list")}
              />
            </Match>
            <Match when={!wide()}>
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
                  onInspectApprovals={openApprovalsReview}
                  onInspectDiff={openDiffReview}
                  onInspectMcp={openMcpInspect}
                  onOpenPm={openPmPane}
                  onOpenTimeline={openTimelineReview}
                  onJumpLive={jumpToLive}
                  onNavigateMessage={scrollToMessageDirect}
                  onJumpLastUser={jumpToLastUserMessage}
                  timelineHint={keyHint("session_timeline")}
                  prevHint={keyHint("messages_previous")}
                  nextHint={keyHint("messages_next")}
                  lastUserHint={keyHint("messages_last_user")}
                  commandHint={keyHint("command_list")}
                />
              </box>
            </Match>
          </Switch>
        </Show>
      </box>
    </context.Provider>
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
  const kv = useKV()
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => (queued() ? theme.accent : local.agent.color(props.message.agent)))
  const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())
  const preferredName = createMemo(() =>
    resolvePreferredName({
      sessionID: props.message.sessionID,
      configUsername: sync.data.config.username,
      kvGet: kv.get,
    }),
  )

  const compaction = createMemo(() => props.parts.find((x) => x.type === "compaction"))

  return (
    <>
      <Show when={text()}>
        <box id={props.message.id} marginTop={props.index === 0 ? 0 : 1}>
          <box
            onMouseOver={() => {
              setHover(true)
            }}
            onMouseOut={() => {
              setHover(false)
            }}
            onMouseUp={props.onMouseUp}
            paddingTop={0}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <box flexDirection="row" gap={1} marginBottom={1}>
              <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                {preferredName() ?? "You"}
              </text>
              <Show when={ctx.showTimestamps()}>
                <text fg={theme.textMuted}>{Locale.todayTimeOrDateTime(props.message.time.created)}</text>
              </Show>
              <Show when={queued()}>
                <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                  QUEUED
                </text>
              </Show>
            </box>
            <text fg={theme.text}>{text()?.text}</text>
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
                      <box flexDirection="row" gap={0}>
                        <text fg={theme.background} backgroundColor={bg()}>
                          {" "}{MIME_BADGE[file.mime] ?? file.mime}{" "}
                        </text>
                        <text fg={theme.textMuted} backgroundColor={theme.backgroundElement}>
                          {" "}{file.filename}{" "}
                        </text>
                      </box>
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
  phase: OrchestrationPhase
  stageLabel: string
  stageColor: RGBA
  streamStatus: string
  explainMode: boolean
}

function StageTimeline(props: StageTimelineProps) {
  const { theme } = useTheme()
  const showFlow = createMemo(() => ORCHESTRATION_FLOW.includes(props.phase))
  const stageNames = createMemo(() => ORCHESTRATION_FLOW.map((stage) => labelOrchestrationPhase(stage, props.explainMode)))
  const activeIndex = createMemo(() => ORCHESTRATION_FLOW.indexOf(props.phase))
  const statusText = createMemo(() => (props.streamStatus === "idle" ? undefined : props.streamStatus))
  const reason = createMemo(() => props.stageState.reason)
  const baseBackground = createMemo(() => theme.backgroundElement ?? theme.backgroundPanel ?? theme.background)

  return (
    <Show when={props.visible}>
      <box paddingLeft={2} paddingRight={2} paddingTop={0} paddingBottom={1} flexDirection="column" gap={0}>
        <Switch>
          <Match when={showFlow()}>
            <box flexDirection="row" flexWrap="wrap" gap={1} alignItems="center">
              <For each={ORCHESTRATION_FLOW}>
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
                      ? tint(baseBackground(), props.stageColor, 0.55)
                      : state === "complete"
                        ? tint(baseBackground(), theme.primary, 0.35)
                        : tint(baseBackground(), theme.borderSubtle, 0.15)
                  const fg = state === "active" ? props.stageColor : state === "complete" ? theme.text : theme.textMuted
                  return (
                    <box flexDirection="row" alignItems="center" gap={1}>
                      <box paddingLeft={1} paddingRight={1} paddingBottom={0} paddingTop={0} backgroundColor={bg}>
                        <text fg={fg}>{stageNames()[idx]}</text>
                      </box>
                      <Show when={idx < ORCHESTRATION_FLOW.length - 1}>
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
                backgroundColor={tint(baseBackground(), props.stageColor, 0.5)}
              >
                <text fg={props.stageColor}>{props.stageLabel}</text>
              </box>
            </box>
          </Match>
        </Switch>
        <box flexDirection="row" gap={1} flexWrap="wrap">
          <text fg={theme.textMuted}>{props.stageLabel}</text>
          <Show when={reason()}>
            <text fg={theme.textMuted}>· {reason()}</text>
          </Show>
          <Show when={statusText()}>
            <text fg={theme.textMuted}>· {statusText()}</text>
          </Show>
        </box>
      </box>
    </Show>
  )
}

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
  const ctx = use()
  const local = useLocal()
  const { theme } = useTheme()
  const sync = useSync()
  const kv = useKV()
  const messages = createMemo(() => sync.data.message[props.message.sessionID] ?? [])
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const showEli12Summary = createMemo(() => kv.get(DAX_SETTING.eli12_summary_visibility, false))
  const parent = createMemo(() => messages().find((x) => x.id === props.message.parentID && x.role === "user"))
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
  const allToolParts = createMemo(() => props.parts.filter((part): part is ToolPart => part.type === "tool"))
  const completedToolParts = createMemo(() => allToolParts().filter((part) => part.state.status === "completed"))
  const pendingTool = createMemo<ToolPart | undefined>(() => {
    return props.parts.findLast((part): part is ToolPart => part.type === "tool" && part.state.status === "pending")
  })
  const hasToolActivity = createMemo(() => allToolParts().length > 0)
  const hasExecuteTool = createMemo(() => allToolParts().some((part) => EXECUTE_TOOLS.has(part.tool)))
  const hasVerifyTool = createMemo(() => allToolParts().some((part) => VERIFY_TOOLS.has(part.tool)))
  const hasReasoning = createMemo(() => props.parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0))
  const doing = createMemo(() => {
    if (props.message.error) return "Hit an error while executing."
    if (pendingTool())
      return "Executing the next step for your request."
    if (hasReasoning()) return "Understanding the request and preparing the next step."
    if (props.last && !props.message.time.completed) return "Still working on your request."
    return "Delivered an answer for this step."
  })
  const next = createMemo(() => {
    if (props.message.error) return "Retry, or adjust your request and run again."
    if (props.last && !props.message.time.completed) return "Wait for completion or press esc twice to stop."
    return "Continue with a follow-up request."
  })
  const final = createMemo(() => {
    return props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish)
  })
  const liveNarrativeStep = createMemo(() => {
    const tool = pendingTool()
    if (tool && tool.type === "tool") {
      return describeToolNarrative(tool)
    }
    if (hasReasoning() && props.last && !props.message.time.completed) {
      return describeReasoningNarrative()
    }
    return undefined
  })
  const operationalMilestone = createMemo(() =>
    describeOperationalMilestone({
      asked: asked(),
      completedTools: completedToolParts(),
      pendingTool: pendingTool(),
      hasReasoning: hasReasoning(),
      explainMode: explainMode(),
    }),
  )
  const errorMessage = createMemo(() => {
    const value = props.message.error?.data.message
    return typeof value === "string" ? value : undefined
  })
  const changeSummary = createMemo(() => {
    const summary = parent()?.summary
    const diffs = summary && typeof summary === "object" && "diffs" in summary && Array.isArray(summary.diffs) ? summary.diffs : []
    return {
      diffs,
      files: diffs.length,
      additions: diffs.reduce((sum: number, item) => sum + item.additions, 0),
      deletions: diffs.reduce((sum: number, item) => sum + item.deletions, 0),
      topFiles: diffs.slice(0, 3),
    }
  })
  const hasNativeEli12 = createMemo(() =>
    props.parts.some(
      (x) =>
        x.type === "text" &&
        /\b(you asked|what i'm doing|what happens next|your options)\b/i.test((x as TextPart).text ?? ""),
    ),
  )
  const showSummary = createMemo(() => explainMode() && showEli12Summary() && props.last && !hasNativeEli12())
  const narrative = createMemo(() =>
    buildAssistantNarrative({
      asked: asked(),
      mode: props.message.mode,
      hasPendingTool: !!pendingTool(),
      hasToolActivity: hasToolActivity(),
      toolCount: allToolParts().length,
      hasExecuteTool: hasExecuteTool(),
      hasVerifyTool: hasVerifyTool(),
      hasReasoning: hasReasoning(),
      hasError: !!props.message.error,
      completed: !!props.message.time.completed || !!final(),
      doing: doing(),
      next: next(),
      liveStep:
        liveNarrativeStep() ??
        (operationalMilestone().checking || operationalMilestone().next
          ? {
              now: operationalMilestone().checking ?? doing(),
              next: operationalMilestone().next ?? next(),
            }
          : undefined),
    }),
  )
  const narrativeIntensity = createMemo<AssistantNarrativeIntensity>(() => narrative()?.intensity ?? "guided")
  const [traceExpanded, setTraceExpanded] = createSignal(false)
  const traceSummary = createMemo(() => {
    const tools = completedToolParts()
    const reads = tools.filter((part) => EXPLORE_TOOLS.has(part.tool)).length
    const plans = tools.filter((part) => PLAN_TOOLS.has(part.tool)).length
    const writes = tools.filter((part) => EXECUTE_TOOLS.has(part.tool)).length
    const verifies = tools.filter((part) => VERIFY_TOOLS.has(part.tool)).length
    const shell = tools.filter((part) => part.tool === "bash").length
    const notable = Array.from(new Set(tools.map((part) => part.tool))).slice(0, 4)
    const phases = [
      reads > 0 ? "inspect" : undefined,
      plans > 0 ? "plan" : undefined,
      writes > 0 || shell > 0 ? "execute" : undefined,
      verifies > 0 ? "verify" : undefined,
    ].filter(Boolean) as string[]
    return {
      total: tools.length,
      reads,
      plans,
      writes,
      verifies,
      shell,
      notable,
      phases,
    }
  })
  const operationalSummary = createMemo(() => {
    if (narrativeIntensity() !== "operational") return undefined
    if (!props.message.time.completed && !final()) return undefined
    return describeOperationalCompletion({
      asked: asked(),
      phases: traceSummary().phases,
      writes: traceSummary().writes,
      verifies: traceSummary().verifies,
      hasError: !!props.message.error,
    })
  })
  const showCollapsedTrace = createMemo(
    () =>
      narrativeIntensity() === "operational" &&
      !!props.message.time.completed &&
      completedToolParts().length > 0 &&
      (completedToolParts().length >= 3 || traceSummary().writes > 0 || traceSummary().verifies > 0),
  )

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
      if (part.type === "tool") {
        if (ctx.showDetails()) return true
        return part.state.status !== "completed"
      }
      return true
    }),
  )
  const hasTextContent = createMemo(() =>
    props.parts.some((part) => part.type === "text" && part.text.trim().length > 0),
  )
  const shouldRender = createMemo(() => {
    if (narrativeIntensity() === "operational" && !ctx.showDetails()) {
      if (!props.last && !props.message.error && !hasTextContent()) {
        return false
      }

      const hasPendingTool = !!pendingTool()
      const hasVisibleNarrative =
        !!operationalSummary() ||
        (!props.message.time.completed &&
          !!(operationalMilestone().found || operationalMilestone().checking || operationalMilestone().next))

      if (!props.last && !props.message.error && !hasTextContent() && !hasPendingTool && !hasVisibleNarrative) {
        return false
      }

      if (!props.last && !props.message.error && !hasTextContent() && !hasPendingTool) {
        return false
      }
    }

    return hasRenderablePart() || !!props.message.error || final() || props.last
  })

  return (
    <Show when={shouldRender()}>
      <Show when={narrative()?.intensity === "guided" && narrative()?.preamble}>
        {(line) => (
          <box
            paddingTop={1}
            paddingBottom={0}
            paddingLeft={3}
            paddingRight={1}
            marginTop={0}
          >
            <text fg={theme.text} wrapMode="word">
              {line()}
            </text>
          </box>
        )}
      </Show>
      <Show
        when={
          narrative()?.intensity === "operational" &&
          !props.message.time.completed &&
          (operationalMilestone().found || operationalMilestone().checking || operationalMilestone().next)
        }
      >
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          marginTop={0}
          flexDirection="column"
          gap={0}
          backgroundColor={tint(theme.backgroundPanel, theme.secondary, 0.08)}
          border={["left", "top"]}
          borderColor={theme.secondary}
        >
          <Show when={operationalMilestone().found}>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <text fg={theme.textMuted}>Found</text>
              <text fg={theme.text} wrapMode="word">
                {operationalMilestone().found}
              </text>
            </box>
          </Show>
          <Show when={operationalMilestone().checking}>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <text fg={theme.textMuted}>{explainMode() ? "Checking now" : "Checking"}</text>
              <text fg={theme.secondary} wrapMode="word">
                {operationalMilestone().checking}
              </text>
            </box>
          </Show>
          <Show when={operationalMilestone().next}>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <text fg={theme.textMuted}>Next</text>
              <text fg={theme.text} wrapMode="word">
                {operationalMilestone().next}
              </text>
            </box>
          </Show>
        </box>
      </Show>
      <Show when={operationalSummary()}>
        {(line) => (
          <box paddingTop={1} paddingBottom={0} paddingLeft={3} paddingRight={1} marginTop={0}>
            <text fg={theme.text} wrapMode="word">
              {line()}
            </text>
          </box>
        )}
      </Show>
      <Show when={showCollapsedTrace() && !traceExpanded()}>
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          marginTop={0}
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          backgroundColor={tint(theme.backgroundPanel, theme.borderSubtle, 0.08)}
          border={["left"]}
          borderColor={theme.borderSubtle}
          onMouseUp={() => setTraceExpanded(true)}
        >
          <box flexDirection="column" gap={0}>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <text fg={theme.text}>Trace {traceSummary().total} actions</text>
              <Show when={traceSummary().reads > 0}>
                <text fg={theme.textMuted}>· {traceSummary().reads} reads/searches</text>
              </Show>
              <Show when={traceSummary().plans > 0}>
                <text fg={theme.textMuted}>· {traceSummary().plans} planning steps</text>
              </Show>
              <Show when={traceSummary().writes > 0}>
                <text fg={theme.textMuted}>· {traceSummary().writes} changes</text>
              </Show>
              <Show when={traceSummary().verifies > 0}>
                <text fg={theme.textMuted}>· {traceSummary().verifies} verification steps</text>
              </Show>
            </box>
            <Show when={traceSummary().notable.length > 0}>
              <text fg={theme.textMuted}>Includes: {traceSummary().notable.join(", ")}</text>
            </Show>
              <Show when={traceSummary().phases.length > 0}>
              <text fg={theme.textMuted}>Milestones: {traceSummary().phases.map(formatMilestoneName).join(" → ")}</text>
            </Show>
          </box>
          <text fg={theme.secondary}>Show trace</text>
        </box>
      </Show>
      <Show when={showSummary()}>
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          marginTop={1}
          backgroundColor={tint(theme.backgroundPanel, theme.accent, 0.06)}
        >
          <box flexDirection="column" gap={0}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                ELI12
              </text>
              <text fg={theme.text}>summary</text>
            </box>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <text fg={theme.textMuted}>You asked:</text>
              <text fg={theme.text}>{asked()}</text>
            </box>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <text fg={theme.textMuted}>DAX did:</text>
              <text fg={theme.text}>{doing()}</text>
            </box>
            <box flexDirection="row" gap={1} flexWrap="wrap">
              <text fg={theme.textMuted}>Next step:</text>
              <text fg={theme.text}>{next()}</text>
            </box>
            <Show when={changeSummary().files > 0}>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <text fg={theme.textMuted}>Changed:</text>
                <text fg={theme.text}>{changeSummary().files} files,</text>
                <text fg={theme.diffAdded}>+{changeSummary().additions}</text>
                <text fg={theme.text}>and</text>
                <text fg={theme.diffRemoved}>-{changeSummary().deletions}</text>
              </box>
              <For each={changeSummary().topFiles}>
                {(item) => (
                  <box flexDirection="row" gap={1} flexWrap="wrap">
                    <text fg={theme.textMuted}>• {item.file} (</text>
                    <text fg={theme.diffAdded}>+{item.additions}</text>
                    <text fg={theme.textMuted}>/</text>
                    <text fg={theme.diffRemoved}>-{item.deletions}</text>
                    <text fg={theme.textMuted}>)</text>
                  </box>
                )}
              </For>
            </Show>
          </box>
        </box>
      </Show>

      <Show when={narrativeIntensity() === "operational" && (traceExpanded() || !!props.message.error)}>
        <box flexDirection="row" gap={1} alignItems="center" marginTop={1} marginBottom={0} paddingLeft={2}>
          <text fg={theme.primary} attributes={TextAttributes.BOLD}>
            DAX
          </text>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.textMuted}>{Locale.titlecase(props.message.mode)}</text>
          <text fg={theme.textMuted}>·</text>
          <text fg={theme.textMuted}>{props.message.modelID}</text>
        </box>
      </Show>

      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          const shouldRenderPart = createMemo(() => {
            if (narrativeIntensity() !== "operational") return true
            if (ctx.showDetails()) return true
            if (traceExpanded()) return true
            if (part.type === "text") return true
            if (part.type === "tool") return false
            if (part.type === "reasoning") return false
            return true
          })
          return (
            <Show when={component() && shouldRenderPart()}>
              <Dynamic
                last={index() === props.parts.length - 1}
                component={component()}
                part={part as any}
                message={props.message}
              />
            </Show>
          )
        }}
      </For>
      <Show when={showCollapsedTrace() && traceExpanded()}>
        <box paddingLeft={2} marginTop={0} onMouseUp={() => setTraceExpanded(false)}>
          <text fg={theme.secondary}>Hide trace</text>
        </box>
      </Show>
      <Show when={props.message.error && props.message.error.name !== "MessageAbortedError"}>
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          marginTop={1}
          backgroundColor={tint(theme.background, theme.error, 0.1)}
        >
          <text fg={theme.error}>{errorMessage() ?? "An unknown error occurred."}</text>
          <text fg={theme.textMuted} wrapMode="word">
            Recommended next step: {nextActionForErrorMessage(errorMessage())}
          </text>
        </box>
      </Show>
      <Switch>
        <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
          <Show when={narrativeIntensity() === "operational" && (traceExpanded() || !!props.message.error)}>
            <box
              flexDirection="row"
              gap={1}
              alignItems="center"
              marginTop={1}
              marginBottom={1}
              paddingLeft={2}
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
              <text fg={theme.text}>{Locale.titlecase(props.message.mode)}</text>
              <text fg={theme.textMuted}>·</text>
              <text fg={theme.textMuted}>{props.message.modelID}</text>
              <Show when={duration()}>
                <text fg={theme.textMuted}>·</text>
                <text fg={theme.textMuted}>{Locale.duration(duration())}</text>
              </Show>
              <Show when={generatedTokens() > 0}>
                <text fg={theme.textMuted}>·</text>
                <text fg={theme.textMuted}>{`${generatedTokens().toLocaleString()} tok`}</text>
              </Show>
              <Show when={tokensPerSecond() > 0}>
                <text fg={theme.textMuted}>·</text>
                <text fg={theme.textMuted}>{`${tokensPerSecond().toFixed(0)}/s`}</text>
              </Show>
              <Show when={props.message.error?.name === "MessageAbortedError"}>
                <text fg={theme.textMuted}>·</text>
                <text fg={theme.textMuted}>interrupted</text>
              </Show>
            </box>
          </Show>
        </Match>
      </Switch>
    </Show>
  )
}

const PART_MAPPING = {
  text: TextPart,
  tool: ToolPart,
  reasoning: ReasoningPart,
}

function ReasoningPart(props: { last: boolean; part: ReasoningPart; message: AssistantMessage }) {
  const { theme, subtleSyntax } = useTheme()
  const ctx = use()
  const parentParts = createMemo(() => {
    return (ctx.sync.data.part[props.message.id] ?? []) as Part[]
  })
  const content = createMemo(() => {
    return props.part.text.replace("[REDACTED]", "").trim()
  })
  const showWorkingNote = createMemo(() =>
    buildAssistantNarrative({
      asked: "",
      mode: props.message.mode,
      hasPendingTool: parentParts().some((part) => part.type === "tool" && (part as ToolPart).state.status === "pending"),
      hasToolActivity: parentParts().some((part) => part.type === "tool"),
      toolCount: parentParts().filter((part) => part.type === "tool").length,
      hasExecuteTool: parentParts().some((part) => part.type === "tool" && EXECUTE_TOOLS.has((part as ToolPart).tool)),
      hasVerifyTool: parentParts().some((part) => part.type === "tool" && VERIFY_TOOLS.has((part as ToolPart).tool)),
      hasReasoning: true,
      hasError: !!props.message.error,
      completed: !!props.message.time.completed,
      doing: "Understanding the request and preparing the next step.",
      next: "Continue with a follow-up request.",
    })?.showWorkingNote ?? true,
  )
  const background = createMemo(() => tint(theme.backgroundPanel, theme.secondary, theme.thinkingOpacity ?? 0.35))

  return (
    <Show when={content() && ctx.showThinking() && showWorkingNote()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        paddingRight={2}
        marginTop={1}
        flexDirection="column"
        backgroundColor={background()}
        border={["left"]}
        borderColor={theme.secondary}
      >
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={subtleSyntax()}
          content={"_Progress note:_ " + content()}
          conceal={ctx.conceal()}
          fg={theme.secondary}
        />
      </box>
    </Show>
  )
}

function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const { theme, syntax } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box id={"text-" + props.part.id} paddingLeft={3} paddingRight={1} marginTop={1} flexShrink={0}>
        <Switch>
          <Match when={Flag.DAX_EXPERIMENTAL_MARKDOWN}>
            <markdown
              syntaxStyle={syntax()}
              streaming={true}
              content={props.part.text.trim()}
              conceal={ctx.conceal()}
            />
          </Match>
          <Match when={!Flag.DAX_EXPERIMENTAL_MARKDOWN}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={true}
              syntaxStyle={syntax()}
              content={props.part.text.trim()}
              conceal={ctx.conceal()}
              fg={theme.text}
            />
          </Match>
        </Switch>
      </box>
    </Show>
  )
}

// Pending messages moved to individual tool pending functions

function ToolPart(props: { last: boolean; part: ToolPart; message: AssistantMessage }) {
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
  }

  return (
    <Show when={!shouldHide()}>
      <Switch>
        <Match when={props.part.tool === "bash"}>
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
}
function GenericTool(props: ToolProps<any>) {
  return (
    <InlineTool icon="⚙" pending="Executing tool..." complete={true} part={props.part}>
      {props.tool} {input(props.input)}
    </InlineTool>
  )
}

function ToolTitle(props: { fallback: string; when: any; icon: string; children: JSX.Element }) {
  const { theme } = useTheme()
  return (
    <text paddingLeft={3} fg={props.when ? theme.textMuted : theme.text}>
      <Show fallback={<>~ {props.fallback}</>} when={props.when}>
        {props.icon} {props.children}
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
    if (permission()) return theme.warning
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
          {props.icon} {props.children}
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
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error : undefined))
  const accent = createMemo(() => (props.part ? toolAccentColor(props.part.tool, theme) : theme.borderActive))
  const baseBackground = createMemo(() => tint(theme.backgroundPanel, accent(), 0.08))
  const hoverBackground = createMemo(() => tint(theme.backgroundPanel, accent(), 0.2))
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? hoverBackground() : baseBackground()}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={accent()}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
    >
      <Show
        when={props.spinner}
        fallback={
          <text paddingLeft={3} fg={theme.textMuted}>
            {props.title}
          </text>
        }
      >
        <Spinner color={accent()}>{props.title.replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
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

function Bash(props: ToolProps<typeof BashTool>) {
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

  const workdirDisplay = createMemo(() => {
    const workdir = props.input.workdir
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
    const desc = props.input.description ?? "Shell"
    const wd = workdirDisplay()
    if (!wd) return `# ${desc}`
    if (desc.includes(wd)) return `# ${desc}`
    return `# ${desc} in ${wd}`
  })

  return (
    <Switch>
      <Match when={props.metadata.output !== undefined}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={isRunning()}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {props.input.command}</text>
            <Show when={output()}>
              <text fg={theme.text}>{limited()}</text>
            </Show>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Running shell command..." complete={props.input.command} part={props.part}>
          {props.input.command}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Write(props: ToolProps<typeof WriteTool>) {
  const { theme, syntax } = useTheme()
  const code = createMemo(() => {
    if (!props.input.content) return ""
    return props.input.content
  })

  const diagnostics = createMemo(() => {
    const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
    return props.metadata.diagnostics?.[filePath] ?? []
  })

  return (
    <Switch>
      <Match when={props.metadata.diagnostics !== undefined}>
        <BlockTool title={"# Wrote " + normalizePath(props.input.filePath!)} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(props.input.filePath!)}
              syntaxStyle={syntax()}
              content={code()}
            />
          </line_number>
          <Show when={diagnostics().length}>
            <For each={diagnostics()}>
              {(diagnostic) => (
                <text fg={theme.error}>
                  Error [{diagnostic.range.start.line}:{diagnostic.range.start.character}]: {diagnostic.message}
                </text>
              )}
            </For>
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Writing file..." complete={props.input.filePath} part={props.part}>
          Write {normalizePath(props.input.filePath!)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps<typeof GlobTool>) {
  return (
    <InlineTool icon="✱" pending="Finding matching files..." complete={props.input.pattern} part={props.part}>
      Glob "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.count}>
        ({props.metadata.count} {props.metadata.count === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function Read(props: ToolProps<typeof ReadTool>) {
  const { theme } = useTheme()
  const loaded = createMemo(() => {
    if (props.part.state.status !== "completed") return []
    if (props.part.state.time.compacted) return []
    const value = props.metadata.loaded
    if (!value || !Array.isArray(value)) return []
    return value.filter((p): p is string => typeof p === "string")
  })
  return (
    <>
      <InlineTool icon="→" pending="Reading file..." complete={props.input.filePath} part={props.part}>
        Read {normalizePath(props.input.filePath!)} {input(props.input, ["filePath"])}
      </InlineTool>
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
  return (
    <InlineTool icon="✱" pending="Searching file contents..." complete={props.input.pattern} part={props.part}>
      Grep "{props.input.pattern}" <Show when={props.input.path}>in {normalizePath(props.input.path)} </Show>
      <Show when={props.metadata.matches}>
        ({props.metadata.matches} {props.metadata.matches === 1 ? "match" : "matches"})
      </Show>
    </InlineTool>
  )
}

function List(props: ToolProps<typeof ListTool>) {
  const dir = createMemo(() => {
    if (props.input.path) {
      return normalizePath(props.input.path)
    }
    return ""
  })
  return (
    <InlineTool icon="→" pending="Listing directory contents..." complete={props.input.path !== undefined} part={props.part}>
      List {dir()}
    </InlineTool>
  )
}

function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool icon="%" pending="Fetching web content..." complete={(props.input as any).url} part={props.part}>
      WebFetch {(props.input as any).url}
    </InlineTool>
  )
}

function CodeSearch(props: ToolProps<any>) {
  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={input.query} part={props.part}>
      Exa Code Search "{input.query}" <Show when={metadata.results}>({metadata.results} results)</Show>
    </InlineTool>
  )
}

function WebSearch(props: ToolProps<any>) {
  const input = props.input as any
  const metadata = props.metadata as any
  return (
    <InlineTool icon="◈" pending="Searching the web..." complete={input.query} part={props.part}>
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
      <Match when={props.input.description || props.input.subagent_type}>
        <BlockTool
          title={"# " + Locale.titlecase(props.input.subagent_type ?? "unknown") + " Task"}
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
              {props.input.description} ({tools().length} toolcalls)
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
            </text>
            <text fg={theme.textMuted}>view subagents</text>
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="#" pending="Delegating work..." complete={props.input.subagent_type} part={props.part}>
          {props.input.subagent_type} Task {props.input.description}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Edit(props: ToolProps<typeof EditTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

  const view = createMemo(() => {
    const diffStyle = ctx.sync.data.config.tui?.diff_style
    if (diffStyle === "stacked") return "unified"
    // Default to "auto" behavior
    return ctx.width > 120 ? "split" : "unified"
  })

  const ft = createMemo(() => filetype(props.input.filePath))

  const diffContent = createMemo(() => props.metadata.diff)

  const diagnostics = createMemo(() => {
    const filePath = Filesystem.normalizePath(props.input.filePath ?? "")
    const arr = props.metadata.diagnostics?.[filePath] ?? []
    return arr.filter((x) => x.severity === 1).slice(0, 3)
  })

  return (
    <Switch>
      <Match when={props.metadata.diff !== undefined}>
        <BlockTool title={"← Edit " + normalizePath(props.input.filePath!)} part={props.part}>
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
          <Show when={diagnostics().length}>
            <box>
              <For each={diagnostics()}>
                {(diagnostic) => (
                  <text fg={theme.error}>
                    Error [{diagnostic.range.start.line + 1}:{diagnostic.range.start.character + 1}]{" "}
                    {diagnostic.message}
                  </text>
                )}
              </For>
            </box>
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Editing file..." complete={props.input.filePath} part={props.part}>
          Edit {normalizePath(props.input.filePath!)} {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps<typeof ApplyPatchTool>) {
  const ctx = use()
  const { theme, syntax } = useTheme()

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
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Applying patch..." complete={false} part={props.part}>
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
            <For each={props.input.todos ?? []}>
              {(todo) => <TodoItem status={todo.status} content={todo.content} />}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating task list..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps<typeof QuestionTool>) {
  const { theme } = useTheme()
  const count = createMemo(() => props.input.questions?.length ?? 0)

  function format(answer?: string[]) {
    if (!answer?.length) return "(no answer)"
    return answer.join(", ")
  }

  return (
    <Switch>
      <Match when={props.metadata.answers}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={props.input.questions ?? []}>
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
        <InlineTool icon="→" pending="Requesting input..." complete={count()} part={props.part}>
          Asked {count()} question{count() !== 1 ? "s" : ""}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Skill(props: ToolProps<typeof SkillTool>) {
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={props.input.name} part={props.part}>
      Skill "{props.input.name}"
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
