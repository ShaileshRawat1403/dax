import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useKV } from "../../context/kv"
import { DAX_SETTING, sessionWorkflowModeKey } from "@/dax/settings"
import { isEli12Mode } from "@/dax/intent"
import type { PromptInfo } from "./history"
import type { PromptProps } from "./index"
import { Locale } from "@/util/locale"
import { useTheme } from "@tui/context/theme"
import { useKeybind } from "@tui/context/keybind"
import { createColors } from "../../ui/spinner.ts"

export const PLACEHOLDERS = [
  "Ask for one concrete outcome",
  "Describe the change you want in plain language",
  "Tell DAX what to check, fix, or explain",
]
export const ELI12_PLACEHOLDER = "Tell DAX what you need in plain language"
export const WORKFLOW_MODES = ["plan", "build", "explore", "docs", "audit"]
export const WORKFLOW_MODE_HINT = "Tab: cycle mode"
export const WORKFLOW_AGENT_MODES = new Set(WORKFLOW_MODES)
export const ELI12_PREFIX = `SYSTEM: DAX - ELI12 Streaming Mode (Deterministic, Concrete, Non-Technical)

You are DAX.
Your job is to help a non-technical person complete real work safely using terminal commands and step-by-step guidance.

Core principle:
- Keep it simple, confident, and concrete.
- No jargon unless you define it in one short line.
- No long explanations. Prefer small steps with quick checks.

Streaming behavior:
- Output in short chunks that could be streamed live.
- Each chunk should be useful on its own.
- Do not dump a big plan all at once.
- After 1-3 steps, pause and ask for the next required output.

Tone and clarity rules:
- Write like you are guiding a smart 12-year-old who is new to computers.
- Use plain words. Avoid fancy language.
- Avoid em dashes.
- If you must use a technical word, explain it immediately in brackets.
  Example: "cache [temporary files]"

Safety rules:
- Never suggest destructive commands without:
  1) showing a safe "check" command first
  2) explaining what will be deleted in plain words
  3) offering a safer alternative when possible
- For deletion, prefer moving to a quarantine folder before permanent removal.
- Always tell the user how to verify results.

Decision workflow (always follow):
1) Understand the goal in one sentence.
2) Show what to check first (read-only command).
3) Explain what the output means in plain words.
4) Suggest the smallest safe action.
5) Ask the user to paste the next output before continuing.

Output format:
- Use small headings and bullets.
- When there are multiple findings, choices, or next steps, prefer bullets over prose blocks.
- Use a compact markdown table for comparisons, status snapshots, or tradeoffs.
- Use short milestone or checklist formatting when tracking progress.
- Keep paragraphs short. Split after 2-3 compact sentences.
- Highlight key decisions, risks, and next actions with bold keywords.
- Prefer plain text labels over decorative emojis in production output.
- Prefer this layout:

What we are trying to do:
What we will check:
Command to run:
What you should see:
Stop rule (if relevant):

Stop rules:
- If you are unsure, stop and ask for the exact output.
- If the action can cause data loss, stop and require explicit approval.

Do not:
- Do not mention policies, system messages, or internal rules.
- Do not reference "chain-of-thought".
- Do not provide time estimates.
- Do not ask unnecessary questions.

Primary success criteria:
- The user stays safe.
- The user understands what is happening.
- The user can execute one step at a time without confusion.`

export const ELI12_TEMPLATE_RE = /^SYSTEM:\s*DAX\s*-\s*ELI12[\s\S]*?Primary success criteria:[\s\S]*?without confusion\.\s*/i

export const REFINE_PREFIX = `SYSTEM: DAX - Auto-Refine Mode (Structured Execution)

The user has provided a raw, brief, or unstructured prompt.
Your task is to internally refine this into a comprehensive, step-by-step execution plan before taking action.
- Do not output the refined prompt to the user; keep it in your thoughts.
- Execute the task using best practices, filling in any missing gaps logically.
- Ensure all edge cases are handled before completing the task.`

export function usePromptState(props: PromptProps) {
  const sync = useSync()
  const kv = useKV()
  const local = useLocal()
  const { theme } = useTheme()
  const keybind = useKeybind()

  const [store, setStore] = createStore<{
    prompt: PromptInfo
    mode: "normal" | "shell"
    extmarkToPartIndex: Map<number, number>
    interrupt: number
    placeholder: number
  }>({
    placeholder: Math.floor(Math.random() * PLACEHOLDERS.length),
    prompt: {
      input: "",
      parts: [],
    },
    mode: "normal",
    extmarkToPartIndex: new Map(),
    interrupt: 0,
  })

  const status = createMemo(() => sync.data.session_status?.[props.sessionID ?? ""] ?? { type: "idle" })
  const workflowModeKey = createMemo(() => sessionWorkflowModeKey(props.sessionID))
  const workflowMode = createMemo(() => kv.get(workflowModeKey(), "plan"))
  const setWorkflowMode = (next: string) => kv.set(workflowModeKey(), next)
  const explainMode = createMemo(() => isEli12Mode(kv.get(DAX_SETTING.explain_mode, "normal")))
  const setExplainMode = (enabled: boolean) => {
    kv.set(DAX_SETTING.explain_mode, enabled ? "eli12" : "normal")
  }

  const isPanePinned = createMemo(() => props.panePinned ?? kv.get(DAX_SETTING.session_pane_visibility) === "pinned")
  const activePaneMode = createMemo(() => props.activePaneMode ?? kv.get(DAX_SETTING.session_pane_mode))

  const sessionMessages = createMemo(() => (props.sessionID ? (sync.data.message[props.sessionID] ?? []) : []))
  const sessionTodos = createMemo(() => (props.sessionID ? (sync.data.todo[props.sessionID] ?? []) : []))
  const pendingPermissions = createMemo(
    () => props.approvalAttentionCount ?? (props.sessionID ? (sync.data.permission[props.sessionID] ?? []) : []).length,
  )
  const pendingQuestions = createMemo(
    () => props.questionAttentionCount ?? (props.sessionID ? (sync.data.question[props.sessionID] ?? []) : []).length,
  )

  const messageText = (messageID: string) => {
    const parts = sync.data.part[messageID] ?? []
    return parts
      .filter((part: any) => part?.type === "text" && !part.synthetic && !part.ignored)
      .map((part: any) => part.text ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  }

  const recentHistory = () =>
    sessionMessages()
      .filter((message) => message.role === "user")
      .slice(-3)
      .map((message) => messageText(message.id))
      .filter(Boolean)

  const recentActivity = () =>
    sessionMessages()
      .slice(-6)
      .map((message) => {
        const text = messageText(message.id)
        if (text) return text
        const tool = (sync.data.part[message.id] ?? []).findLast((part: any) => part?.type === "tool")
        if (tool?.type === "tool") return `${tool.tool} ${tool.state.status}`
        return ""
      })
      .filter(Boolean)
      .slice(-4)

  const recentTools = () =>
    sessionMessages()
      .flatMap((message) => sync.data.part[message.id] ?? [])
      .filter((part: any) => part?.type === "tool")
      .slice(-4)
      .map((part: any) => `${part.tool} ${part.state.status}`)

  const currentFocus = () => {
    const inProgressTodo = sessionTodos().find((item: any) => item?.status === "in_progress")
    if (inProgressTodo?.content) return inProgressTodo.content
    const lastAssistant = [...sessionMessages()].reverse().find((message) => message.role === "assistant")
    if (!lastAssistant) return undefined
    const lastTool = [...(sync.data.part[lastAssistant.id] ?? [])].reverse().find((part: any) => part?.type === "tool")
    if (lastTool?.type === "tool") return `${lastTool.tool} ${lastTool.state.status}`
    const text = messageText(lastAssistant.id)
    return text ? text.slice(0, 120) : undefined
  }

  const lastUserMessage = createMemo(() => {
    if (!props.sessionID) return undefined
    const messages = sync.data.message[props.sessionID]
    if (!messages) return undefined
    return messages.findLast((m) => m.role === "user")
  })

  const highlight = createMemo(() => {
    if (keybind.leader) return theme.border
    if (store.mode === "shell") return theme.primary
    return local.agent.color(local.agent.current().name)
  })

  const showVariant = createMemo(() => {
    const variants = local.model.variant.list()
    if (variants.length === 0) return false
    const current = local.model.variant.current()
    return !!current
  })

  const activeWorkflowLabel = createMemo(() => {
    const current = local.agent.current()?.name
    if (current && WORKFLOW_AGENT_MODES.has(current)) return Locale.titlecase(current)
    return Locale.titlecase(workflowMode())
  })

  const showInputHint = createMemo(() => !store.prompt.input && !props.sessionID)

  const homeCueFrames = createMemo(() => {
    const dots = "⠈⠐⠠⢀"
    const heads = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    return heads.map((h, i) => {
      const p = i % 4
      return `${dots.slice(0, p)}${h}${dots.slice(p + 1)}`
    })
  })

  const homeCueColor = createMemo(() => {
    return createColors({
      color: theme.primary,
      trailSteps: 5,
      inactiveFactor: 0.35,
      holdStart: 0,
      holdEnd: 0,
      enableFading: true,
      minAlpha: 0.25,
    })
  })

  return {
    store,
    setStore,
    status,
    workflowModeKey,
    workflowMode,
    setWorkflowMode,
    explainMode,
    setExplainMode,
    isPanePinned,
    activePaneMode,
    sessionMessages,
    sessionTodos,
    pendingPermissions,
    pendingQuestions,
    recentHistory,
    recentActivity,
    recentTools,
    currentFocus,
    lastUserMessage,
    highlight,
    showVariant,
    activeWorkflowLabel,
    showInputHint,
    homeCueFrames,
    homeCueColor,
  }
}
