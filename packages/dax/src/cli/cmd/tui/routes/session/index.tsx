import {
  batch,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  on,
  Show,
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
import { Clipboard } from "../../util/clipboard"
import { Toast, useToast } from "../../ui/toast"
import { useKV } from "../../context/kv.tsx"
import { Editor } from "../../util/editor"
import stripAnsi from "strip-ansi"
import { Footer } from "./footer.tsx"
import { usePromptRef } from "../../context/prompt"
import { useExit } from "../../context/exit"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { PermissionPrompt } from "./permission"
import { QuestionPrompt } from "./question"
import { DialogExportOptions } from "../../ui/dialog-export-options"
import { formatTranscript } from "../../util/transcript"
import { UI } from "@/cli/ui.ts"
import { labelStage, type StreamStage } from "@/dax/workflow/stage"
import {
  PANE_MODE,
  type PaneFollowMode,
  type PaneMode,
  type PaneVisibility,
  paneLabel as daxPaneLabel,
  paneTitle as daxPaneTitle,
  insightsLabel,
  memoryLabel,
} from "@/dax/presentation/pane"
import { isEli12Mode } from "@/dax/intent"
import { DAX_SETTING } from "@/dax/settings"

addDefaultParsers(parsers.parsers)

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
  const EXPLORE_TOOLS = new Set(["read", "glob", "grep", "list", "webfetch", "websearch", "codesearch"])
  const PLAN_TOOLS = new Set(["task", "todowrite", "question", "skill"])
  const EXECUTE_TOOLS = new Set(["write", "edit", "apply_patch", "bash"])
  const VERIFY_TOOLS = new Set(["read", "grep", "list", "glob"])

  const route = useRouteData("session")
  const { navigate } = useRoute()
  const sync = useSync()
  const kv = useKV()
  const themeState = useTheme()
  const { theme, syntax } = themeState
  const promptRef = usePromptRef()
  const session = createMemo(() => sync.session.get(route.sessionID))
  const children = createMemo(() => {
    const parentID = session()?.parentID ?? session()?.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  })
  const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])
  const permissions = createMemo(() => {
    if (session()?.parentID) return []
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])
  })
  const questions = createMemo(() => {
    if (session()?.parentID) return []
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
  const [paneVisibility, setPaneVisibility] = kv.signal<PaneVisibility>(
    DAX_SETTING.session_pane_visibility,
    "auto",
  )
  const [paneMode, setPaneMode] = kv.signal<PaneMode>(DAX_SETTING.session_pane_mode, "artifact")
  const [paneFollowMode, setPaneFollowMode] = kv.signal<PaneFollowMode>(DAX_SETTING.session_pane_follow_mode, "smart")
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
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
        if (PLAN_TOOLS.has(tool)) return { stage: "planning", reason: `${tool} in progress` }
        if (EXECUTE_TOOLS.has(tool)) return { stage: "executing", reason: `${tool} in progress` }
        if (VERIFY_TOOLS.has(tool) && completedExecutionInTurn) {
          return { stage: "verifying", reason: `${tool} after execution` }
        }
        if (EXPLORE_TOOLS.has(tool)) return { stage: "exploring", reason: `${tool} in progress` }
        return { stage: "executing", reason: `${tool} in progress` }
      }

      const hasReasoning = parts.some((part) => part.type === "reasoning" && part.text.trim().length > 0)
      if (hasReasoning) return { stage: "thinking", reason: "reasoning stream active" }
      return { stage: "thinking", reason: "response stream active" }
    }

    if (sessionStatusType() === "busy") {
      return { stage: "thinking", reason: "session processing" }
    }

    return { stage: "done", reason: "idle" }
  })
  const STAGE_MIN_DWELL_MS = 800
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
    if (stage === "waiting") return theme.warning
    if (stage === "retrying") return theme.error
    if (stage === "done") return theme.success
    return theme.accent
  })
  const [smartFollowActive, setSmartFollowActive] = createSignal(true)
  const [pendingUpdates, setPendingUpdates] = createSignal(0)

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
  const stripStacked = createMemo(() => contentWidth() < 176)
  const stripCompact = createMemo(() => contentWidth() < 126)
  const stripTight = createMemo(() => contentWidth() < 146)
  const livePaneWidth = createMemo(() => {
    const total = contentWidth()
    const gapAndBorders = 6
    return Math.max(38, Math.floor((total - gapAndBorders) / 2))
  })
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

  function cycleTheme(step: 1 | -1) {
    const themes = Object.keys(themeState.all()).sort()
    if (!themes.length) return
    const current = themeState.selected
    const currentIndex = themes.indexOf(current)
    const baseIndex = currentIndex >= 0 ? currentIndex : 0
    const next = themes[(baseIndex + step + themes.length) % themes.length]
    if (!next) return
    themeState.set(next)
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
      prompt.set(route.initialPrompt)
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
      lastSwitch = part.id
    } else if (part.tool === "plan_enter") {
      local.agent.set("plan")
      lastSwitch = part.id
    }
  })

  let scroll: ScrollBoxRenderable
  let prompt: PromptRef
  const keybind = useKeybind()

  // Allow exit when in child session (prompt is hidden)
  const exit = useExit()

  createEffect(() => {
    const title = Locale.truncate(session()?.title ?? "", 50)
    return exit.message.set(
      [
        ``,
        `  █▀▀█  ${UI.Style.TEXT_DIM}${title}${UI.Style.TEXT_NORMAL}`,
        `  █  █  ${UI.Style.TEXT_DIM}dax -s ${session()?.id}${UI.Style.TEXT_NORMAL}`,
        `  ▀▀▀▀  `,
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
        dialog.replace(() => (
          <DialogTimeline
            onMove={(messageID) => {
              const child = scroll.getChildren().find((child) => {
                return child.id === messageID
              })
              if (child) scroll.scrollBy(child.y - scroll.y - 1)
            }}
            sessionID={route.sessionID}
            setPrompt={(promptInfo) => prompt.set(promptInfo)}
          />
        ))
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
        prompt.set(
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
          prompt.set({ input: "", parts: [] })
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
      title: "Jump to last user message",
      value: "session.messages_last_user",
      keybind: "messages_last_user",
      category: "Session",
      hidden: true,
      onSelect: () => {
        const messages = sync.data.message[route.sessionID]
        if (!messages || !messages.length) return

        // Find the most recent user message with non-ignored, non-synthetic text parts
        for (let i = messages.length - 1; i >= 0; i--) {
          const message = messages[i]
          if (!message || message.role !== "user") continue

          const parts = sync.data.part[message.id]
          if (!parts || !Array.isArray(parts)) continue

          const hasValidTextPart = parts.some(
            (part) => part && part.type === "text" && !part.synthetic && !part.ignored,
          )

          if (hasValidTextPart) {
            const child = scroll.getChildren().find((child) => {
              return child.id === message.id
            })
            if (child) scroll.scrollBy(child.y - scroll.y - 1)
            break
          }
        }
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
  const hasArtifactNeed = createMemo(() => liveArtifact().active && chatActive())
  const showPane = createMemo(() => {
    if (paneVisibility() === "hidden") return false
    if (paneVisibility() === "pinned") return true
    return hasRaoNeed() || hasDiffNeed() || hasArtifactNeed()
  })
  const activePaneMode = createMemo<PaneMode>(() => {
    if (paneVisibility() === "pinned") return paneMode()
    if (hasRaoNeed()) return "rao"
    if (hasDiffNeed()) return "diff"
    if (hasArtifactNeed()) return "artifact"
    return paneMode()
  })

  const dialog = useDialog()
  const renderer = useRenderer()

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
        <box flexGrow={1} paddingBottom={1} paddingTop={1} paddingLeft={2} paddingRight={2} gap={1}>
          <Show when={session()}>
            <Show when={!sidebarVisible() || !wide()}>
              <Header />
            </Show>
            <box
              flexDirection="column"
              gap={0}
              alignItems="stretch"
              backgroundColor={theme.backgroundPanel}
              border={["top", "right", "bottom", "left"]}
              borderColor={theme.borderSubtle}
              paddingLeft={1}
              paddingRight={1}
              paddingTop={0}
              paddingBottom={0}
            >
              <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                  DAX
                </text>
                <Show when={!stripTight()}>
                  <text fg={theme.textMuted}>workspace</text>
                </Show>
                <Show when={!stripCompact()}>
                  <text fg={permissions().length > 0 || questions().length > 0 ? theme.warning : theme.success}>
                    {`${insightsLabel(explainMode())} ${permissions().length + questions().length}`}
                  </text>
                  <text fg={theme.text}>{memoryLabel(explainMode())}</text>
                </Show>
                <text fg={stageColor()}>{stageLabel()}</text>
              </box>
              <box
                flexDirection={stripStacked() ? "column" : "row"}
                gap={stripStacked() ? 0 : 2}
                alignItems={stripStacked() ? "flex-start" : "center"}
                paddingRight={0}
              >
                <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                  <text fg={theme.textMuted}>pane:</text>
                  <box onMouseUp={() => setPaneVisibility(() => "auto")}>
                    <text fg={paneVisibility() === "auto" ? theme.primary : theme.textMuted}>[auto]</text>
                  </box>
                  <box onMouseUp={() => setPaneVisibility(() => "pinned")}>
                    <text fg={paneVisibility() === "pinned" ? theme.primary : theme.textMuted}>[pin]</text>
                  </box>
                  <box onMouseUp={() => setPaneVisibility(() => "hidden")}>
                    <text fg={paneVisibility() === "hidden" ? theme.primary : theme.textMuted}>[hide]</text>
                  </box>
                </box>
                <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                  <text fg={theme.textMuted}>mode:</text>
                  <For each={PANE_MODES}>
                    {(mode) => (
                      <box onMouseUp={() => setPaneMode(() => mode)}>
                        <text
                          fg={paneMode() === mode ? theme.accent : theme.textMuted}
                          attributes={paneMode() === mode ? TextAttributes.BOLD : undefined}
                        >
                          [{paneLabel(mode)}]
                        </text>
                      </box>
                    )}
                  </For>
                </box>
                <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                  <text fg={theme.textMuted}>follow:</text>
                  <box
                    onMouseUp={() => {
                      setPaneFollowMode(() => "smart")
                      setSmartFollowActive(true)
                      setPendingUpdates(0)
                    }}
                  >
                    <text fg={paneFollowMode() === "smart" ? theme.accent : theme.textMuted}>[smart]</text>
                  </box>
                  <box
                    onMouseUp={() => {
                      setPaneFollowMode(() => "live")
                      setSmartFollowActive(true)
                      setPendingUpdates(0)
                    }}
                  >
                    <text fg={paneFollowMode() === "live" ? theme.accent : theme.textMuted}>[live]</text>
                  </box>
                  <Show when={paneFollowMode() === "smart" && !smartFollowActive()}>
                    <box onMouseUp={jumpToLive}>
                      <text fg={theme.primary}>[jump live{pendingUpdates() > 0 ? `:${pendingUpdates()}` : ""}]</text>
                    </box>
                  </Show>
                </box>
                <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                  <text fg={theme.textMuted}>theme:</text>
                  <box onMouseUp={() => cycleTheme(-1)}>
                    <text fg={theme.textMuted}>[theme-]</text>
                  </box>
                  <text fg={theme.primary}>[{selectedThemeShort()}]</text>
                  <box onMouseUp={() => cycleTheme(1)}>
                    <text fg={theme.textMuted}>[theme+]</text>
                  </box>
                </box>
              </box>
            </box>
            <Switch>
              <Match when={showPane()}>
                <box
                  flexGrow={1}
                  flexDirection={liveStacked() ? "column" : "row"}
                  border={["top", "right", "bottom", "left"]}
                  borderColor={theme.borderSubtle}
                >
                  <box
                    width={liveStacked() ? "100%" : livePaneWidth()}
                    flexGrow={liveStacked() ? 0 : 1}
                    border={liveStacked() ? ["bottom"] : ["right"]}
                    borderColor={theme.borderSubtle}
                    padding={0}
                  >
                    <scrollbox
                      ref={(r) => (scroll = r)}
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
                                      setPrompt={(promptInfo) => prompt.set(promptInfo)}
                                    />
                                  ))
                                }}
                                message={message as UserMessage}
                                parts={sync.data.part[message.id] ?? []}
                                pending={pending()}
                              />
                            </Match>
                            <Match when={message.role === "assistant"}>
                              <AssistantMessage
                                last={lastAssistant()?.id === message.id}
                                message={message as AssistantMessage}
                                parts={sync.data.part[message.id] ?? []}
                              />
                            </Match>
                          </Switch>
                        )}
                      </For>
                    </scrollbox>
                  </box>
                  <box
                    width={liveStacked() ? "100%" : livePaneWidth()}
                    flexGrow={liveStacked() ? 0 : 1}
                    padding={1}
                    gap={1}
                    backgroundColor={theme.backgroundPanel}
                  >
                    <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
                      <For each={["auto", "pin", "hide"] as const}>
                        {(mode) => (
                          <box
                            onMouseUp={() => {
                              if (mode === "auto") setPaneVisibility(() => "auto")
                              if (mode === "pin") setPaneVisibility(() => "pinned")
                              if (mode === "hide") setPaneVisibility(() => "hidden")
                            }}
                            backgroundColor={
                              (mode === "auto" && paneVisibility() === "auto") ||
                              (mode === "pin" && paneVisibility() === "pinned") ||
                              (mode === "hide" && paneVisibility() === "hidden")
                                ? theme.backgroundElement
                                : undefined
                            }
                          >
                            <text
                              fg={
                                (mode === "auto" && paneVisibility() === "auto") ||
                                (mode === "pin" && paneVisibility() === "pinned") ||
                                (mode === "hide" && paneVisibility() === "hidden")
                                  ? theme.primary
                                  : theme.textMuted
                              }
                            >
                              [{mode}]
                            </text>
                          </box>
                        )}
                      </For>
                      <For each={PANE_MODES}>
                        {(mode) => (
                          <box
                            onMouseUp={() => {
                              setPaneMode(() => mode)
                              if (paneVisibility() === "hidden") {
                                setPaneVisibility(() => "pinned")
                              }
                            }}
                            backgroundColor={activePaneMode() === mode ? theme.backgroundElement : undefined}
                          >
                            <text fg={activePaneMode() === mode ? theme.primary : theme.textMuted}>[{paneLabel(mode)}]</text>
                          </box>
                        )}
                      </For>
                      <text fg={theme.textMuted}>·</text>
                      <text fg={theme.textMuted}>
                        {`${insightsLabel(explainMode())} ${permissions().length + questions().length}`}
                      </text>
                      <text fg={theme.textMuted}>·</text>
                      <text fg={stageColor()}>{stageLabel()}</text>
                      <text fg={theme.textMuted}>({displayStageState().reason})</text>
                    </box>
                    <Switch>
                      <Match when={activePaneMode() === "artifact"}>
                        <text fg={theme.primary}>{liveArtifact().title}</text>
                        <text fg={theme.textMuted} wrapMode="word">
                          {liveArtifact().body}
                        </text>
                      </Match>
                      <Match when={activePaneMode() === "diff"}>
                        <Show
                          when={revert()?.diff}
                          fallback={<text fg={theme.textMuted}>No active diff for this turn.</text>}
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
                      </Match>
                      <Match when={activePaneMode() === "rao"}>
                        <text fg={theme.text}>Run Audit Override</text>
                        <text fg={theme.textMuted}>Status: {sessionStatusType()}</text>
                        <text fg={permissions().length > 0 ? theme.warning : theme.textMuted}>
                          Pending approvals: {permissions().length}
                        </text>
                        <text fg={questions().length > 0 ? theme.warning : theme.textMuted}>
                          Pending questions: {questions().length}
                        </text>
                      </Match>
                      <Match when={activePaneMode() === "pm"}>
                        <text fg={theme.text}>Project Memory</text>
                        <text fg={theme.textMuted}>/pm note /pm list /pm rules</text>
                        <text fg={theme.textMuted} wrapMode="word">
                          Capture constraints and handoff context so execution stays consistent across sessions.
                        </text>
                      </Match>
                    </Switch>
                  </box>
                </box>
              </Match>
              <Match when={true}>
                <scrollbox
                  ref={(r) => (scroll = r)}
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
                                  <text fg={theme.textMuted}>
                                    <span style={{ fg: theme.text }}>{keybind.print("messages_redo")}</span> to restore
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
                                  setPrompt={(promptInfo) => prompt.set(promptInfo)}
                                />
                              ))
                            }}
                            message={message as UserMessage}
                            parts={sync.data.part[message.id] ?? []}
                            pending={pending()}
                          />
                        </Match>
                        <Match when={message.role === "assistant"}>
                          <AssistantMessage
                            last={lastAssistant()?.id === message.id}
                            message={message as AssistantMessage}
                            parts={sync.data.part[message.id] ?? []}
                          />
                        </Match>
                      </Switch>
                    )}
                  </For>
                </scrollbox>
              </Match>
            </Switch>
            <box flexShrink={0}>
              <Show when={permissions().length > 0}>
                <PermissionPrompt request={permissions()[0]} />
              </Show>
              <Show when={permissions().length === 0 && questions().length > 0}>
                <QuestionPrompt request={questions()[0]} />
              </Show>
              <Prompt
                visible={!session()?.parentID && permissions().length === 0 && questions().length === 0}
                ref={(r) => {
                  prompt = r
                  promptRef.set(r)
                  // Apply initial prompt when prompt component mounts (e.g., from fork)
                  if (route.initialPrompt) {
                    r.set(route.initialPrompt)
                  }
                }}
                disabled={permissions().length > 0 || questions().length > 0}
                onSubmit={() => {
                  toBottom()
                }}
                sessionID={route.sessionID}
              />
            </box>
            <Show when={!sidebarVisible() || !wide()}>
              <Footer />
            </Show>
          </Show>
          <Toast />
        </box>
        <Show when={sidebarVisible()}>
          <Switch>
            <Match when={wide()}>
              <Sidebar sessionID={route.sessionID} />
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
                <Sidebar sessionID={route.sessionID} />
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
  const { theme } = useTheme()
  const [hover, setHover] = createSignal(false)
  const queued = createMemo(() => props.pending && props.message.id > props.pending)
  const color = createMemo(() => (queued() ? theme.accent : local.agent.color(props.message.agent)))
  const metadataVisible = createMemo(() => queued() || ctx.showTimestamps())

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
            paddingTop={1}
            paddingBottom={1}
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={hover() ? theme.backgroundElement : theme.backgroundPanel}
            flexShrink={0}
          >
            <box flexDirection="row" gap={1} marginBottom={1}>
              <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                You
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

function AssistantMessage(props: { message: AssistantMessage; parts: Part[]; last: boolean }) {
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
  const doing = createMemo(() => {
    if (props.message.error) return "Hit an error while executing."
    if (props.parts.some((x) => x.type === "tool" && x.state.status === "pending"))
      return "Running tools for this task."
    if (props.parts.some((x) => x.type === "reasoning")) return "Analyzing and preparing an answer."
    if (props.last && !props.message.time.completed) return "Still working on your request."
    return "Delivered an answer for this step."
  })
  const next = createMemo(() => {
    if (props.message.error) return "Retry, or adjust your request and run again."
    if (props.last && !props.message.time.completed) return "Wait for completion or press esc twice to stop."
    return "Continue with a follow-up request."
  })
  const choice = createMemo(() => {
    if (props.message.error) return "1) Retry  2) Change request  3) Stop"
    if (props.last && !props.message.time.completed) return "1) Wait  2) Interrupt  3) Add guidance"
    return "1) Ask next step  2) Refine output  3) /undo"
  })
  const hasNativeEli12 = createMemo(() =>
    props.parts.some(
      (x) =>
        x.type === "text" &&
        /\b(you asked|what i'm doing|what happens next|your options)\b/i.test((x as TextPart).text ?? ""),
    ),
  )
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

  return (
    <>
      <Show when={showSummary()}>
        <box
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
        >
          <box flexDirection="column" gap={0}>
            <text fg={theme.text}>
              <span style={{ fg: theme.accent, bold: true }}>ELI12</span> summary
            </text>
            <text fg={theme.text}>
              <span style={{ fg: theme.textMuted }}>Asked: </span>
              {asked()}
            </text>
            <text fg={theme.text}>
              <span style={{ fg: theme.textMuted }}>Doing: </span>
              {doing()}
            </text>
            <text fg={theme.text}>
              <span style={{ fg: theme.textMuted }}>Next: </span>
              {next()}
            </text>
          </box>
        </box>
      </Show>

      <box flexDirection="row" gap={1} alignItems="center" marginTop={1} paddingLeft={2}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          DAX
        </text>
        <text fg={theme.textMuted}>·</text>
        <text fg={theme.textMuted}>{Locale.titlecase(props.message.mode)}</text>
        <text fg={theme.textMuted}>·</text>
        <text fg={theme.textMuted}>{props.message.modelID}</text>
      </box>

      <For each={props.parts}>
        {(part, index) => {
          const component = createMemo(() => PART_MAPPING[part.type as keyof typeof PART_MAPPING])
          return (
            <Show when={component()}>
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
        <Match when={props.last || final() || props.message.error?.name === "MessageAbortedError"}>
          <box flexDirection="row" gap={1} alignItems="center" paddingLeft={2} flexWrap="wrap">
            <text
              fg={props.message.error?.name === "MessageAbortedError" ? theme.textMuted : local.agent.color(props.message.agent)}
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
        </Match>
      </Switch>
    </>
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
  const sync = useSync()
  const content = createMemo(() => {
    return props.part.text.replace("[REDACTED]", "").trim()
  })

  const hasPendingTool = createMemo(() => {
    const parts = sync.data.part[props.message.id] ?? []
    return parts.some((x) => x.type === "tool" && x.state.status === "pending")
  })

  return (
    <Show when={content() && ctx.showThinking() && hasPendingTool()}>
      <box
        id={"text-" + props.part.id}
        paddingLeft={2}
        paddingRight={2}
        marginTop={1}
        flexDirection="column"
        backgroundColor={tint(theme.background, theme.primary, 0.05)}
      >
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={subtleSyntax()}
          content={"_Thinking:_ " + content()}
          conceal={ctx.conceal()}
          fg={theme.textMuted}
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
      <box id={"text-" + props.part.id} paddingLeft={3} marginTop={1} flexShrink={0}>
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
    <InlineTool icon="⚙" pending="Writing command..." complete={true} part={props.part}>
      {props.tool} {input(props.input)}
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
      paddingLeft={3}
      renderBefore={function () {
        const el = this as BoxRenderable
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
      <text paddingLeft={3} fg={fg()} attributes={denied() ? TextAttributes.STRIKETHROUGH : undefined}>
        <Show fallback={<>~ {props.pending}</>} when={props.complete}>
          <span style={{ fg: props.iconColor }}>{props.icon}</span> {props.children}
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
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
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
        <Spinner color={theme.textMuted}>{props.title.replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
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
        <InlineTool icon="$" pending="Writing command..." complete={props.input.command} part={props.part}>
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
        <InlineTool icon="←" pending="Preparing write..." complete={props.input.filePath} part={props.part}>
          Write {normalizePath(props.input.filePath!)}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps<typeof GlobTool>) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={props.input.pattern} part={props.part}>
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
    <InlineTool icon="✱" pending="Searching content..." complete={props.input.pattern} part={props.part}>
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
    <InlineTool icon="→" pending="Listing directory..." complete={props.input.path !== undefined} part={props.part}>
      List {dir()}
    </InlineTool>
  )
}

function WebFetch(props: ToolProps<typeof WebFetchTool>) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={(props.input as any).url} part={props.part}>
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
              <span style={{ fg: theme.textMuted }}> view subagents</span>
            </text>
          </Show>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="#" pending="Delegating..." complete={props.input.subagent_type} part={props.part}>
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
        <InlineTool icon="←" pending="Preparing edit..." complete={props.input.filePath} part={props.part}>
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
            <For each={props.input.todos ?? []}>
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
        <InlineTool icon="→" pending="Asking questions..." complete={count()} part={props.part}>
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
