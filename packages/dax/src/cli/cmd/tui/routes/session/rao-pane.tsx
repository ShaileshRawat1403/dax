import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground, tint } from "../../context/theme"
import type { PermissionRequest, QuestionRequest, QuestionAnswer } from "@dax-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { useDialog } from "../../ui/dialog"
import { parsePolicyProfile, type PolicyProfile } from "@/dax/approval"
import { DAX_SETTING } from "@/dax/settings"
import { useKV } from "../../context/kv"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Global } from "@/global"
import { analyzePackageInstallCommand, analyzePythonInstallCommand } from "../../util/environment"

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

type PermissionRiskLevel = "normal" | "privacy" | "critical"

type RAOItem =
  | { type: "permission"; data: PermissionRequest; index: number }
  | { type: "question"; data: QuestionRequest; index: number }

function classifyPermissionRisk(request: PermissionRequest, input: Record<string, unknown>, profile: PolicyProfile) {
  const permission = request.permission
  const sensitivePathPattern =
    /(^|\/)\.env($|\.)|(^|\/)\.ssh(\/|$)|id_rsa|id_ed25519|credentials|token|secret|\.npmrc|\.aws/i

  const risk = (level: PermissionRiskLevel, reason: string, suggestion?: string) => ({ level, reason, suggestion })
  const elevatePrivacy = (reason: string, suggestion?: string) =>
    risk(profile === "strict" ? "critical" : "privacy", reason, suggestion)
  const normal = () => risk("normal", "")

  if (permission === "external_directory") {
    return elevatePrivacy("Outside-project directory access may expose local private files.")
  }
  if (permission === "webfetch" || permission === "websearch" || permission === "codesearch") {
    return elevatePrivacy("This may send project context or queries to external services.")
  }
  if (permission === "doom_loop") {
    return risk("critical", "Continuing after repeated failures can cause unintended repeated actions.")
  }
  if (permission === "read") {
    const filePath = String(input.filePath ?? "")
    if (sensitivePathPattern.test(filePath)) {
      return risk("privacy", "Reading this file may expose secrets or credentials.")
    }
    return normal()
  }
  if (permission === "edit") {
    const filepath = String(request.metadata?.filepath ?? "")
    if (sensitivePathPattern.test(filepath)) {
      return risk("critical", "Editing a sensitive file can impact credentials or security settings.")
    }
    return normal()
  }
  if (permission === "shell") {
    const command = String(input.command ?? "").toLowerCase()
    const pythonInstall = analyzePythonInstallCommand(command)
    if (pythonInstall?.kind === "missing-venv") {
      return risk("critical", pythonInstall.reason, pythonInstall.recommendation)
    }
    if (pythonInstall?.kind === "explicit-global") {
      return elevatePrivacy(pythonInstall.reason)
    }
    const packageInstall = analyzePackageInstallCommand(command)
    if (packageInstall?.kind === "global-install") {
      return elevatePrivacy(packageInstall.reason, packageInstall.suggestion)
    }
    if (
      /rm\s+-rf|sudo\s+|chmod\s+|chown\s+|dd\s+if=|mkfs|shutdown|reboot|halt|killall|pkill|git\s+push|git\s+reset\s+--hard|curl.+\|\s*(bash|sh)/.test(
        command,
      )
    ) {
      return risk("critical", "This command can change system state or perform destructive operations.")
    }
    if (/printenv|cat\s+.*\.env|gh\s+auth|aws\s+|gcloud\s+|scp\s+|rsync\s+/.test(command)) {
      return elevatePrivacy("This command may access or transmit credentials or private data.")
    }
    return normal()
  }
  return normal()
}

function normalizePath(input?: string) {
  if (!input) return ""
  const cwd = process.cwd()
  const home = Global.Path.home
  const absolute = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const relative = path.relative(cwd, absolute)
  if (!relative) return "."
  if (!relative.startsWith("..")) return relative
  if (home && (absolute === home || absolute.startsWith(home + path.sep))) {
    return absolute.replace(home, "~")
  }
  return absolute
}

// ──────────────────────────────────────────────────────────────────────────────
// Approval card — rendered only for the currently selected permission request
// ──────────────────────────────────────────────────────────────────────────────
function PermissionCard(props: {
  request: PermissionRequest
  input: Record<string, unknown>
  risk: { level: PermissionRiskLevel; reason: string; suggestion?: string }
  onApproveOnce: () => void
  onApproveAlways: () => void
  onDeny: () => void
}) {
  const { theme } = useTheme()
  const [hovered, setHovered] = createSignal<"once" | "always" | "deny" | null>(null)

  const riskColor = () => {
    if (props.risk.level === "critical") return theme.error
    if (props.risk.level === "privacy") return theme.warning
    return theme.border
  }

  const riskBg = () => {
    if (props.risk.level === "critical") return tint(theme.background, theme.error, 0.08)
    if (props.risk.level === "privacy") return tint(theme.background, theme.warning, 0.08)
    return theme.backgroundElement
  }

  const icon = () => {
    const perm = props.request.permission
    if (perm === "shell") return "#"
    if (perm === "edit") return "✎"
    if (perm === "read") return "→"
    if (perm === "glob" || perm === "grep") return "✱"
    if (perm === "webfetch") return "%"
    if (perm === "websearch") return "◈"
    if (perm === "codesearch") return "◇"
    if (perm === "task") return "◉"
    if (perm === "external_directory") return "←"
    if (perm === "doom_loop") return "⟳"
    return "⚙"
  }

  const title = () => {
    const perm = props.request.permission
    const i = props.input
    if (perm === "shell") return (i.description as string) ?? "Run command"
    if (perm === "edit") return `Edit ${normalizePath(props.request.metadata?.filepath as string)}`
    if (perm === "read") return `Read ${normalizePath(i.filePath as string)}`
    if (perm === "glob") return `Glob "${i.pattern ?? ""}"`
    if (perm === "grep") return `Grep "${i.pattern ?? ""}"`
    if (perm === "list") return `List ${normalizePath(i.path as string)}`
    if (perm === "webfetch") return `Fetch ${i.url ?? ""}`
    if (perm === "websearch" || perm === "codesearch") return `Search "${i.query ?? ""}"`
    if (perm === "task") return `${i.subagent_type ?? "Task"}: ${i.description ?? ""}`
    if (perm === "external_directory") {
      const meta = props.request.metadata ?? {}
      const parent = typeof meta["parentDir"] === "string" ? meta["parentDir"] : undefined
      const filepath = typeof meta["filepath"] === "string" ? meta["filepath"] : undefined
      const pattern = props.request.patterns?.[0]
      const derived =
        typeof pattern === "string" ? (pattern.includes("*") ? path.dirname(pattern) : pattern) : undefined
      return `Access external dir: ${normalizePath(parent ?? filepath ?? derived)}`
    }
    if (perm === "doom_loop") return "Continue after repeated failures"
    return perm
  }

  const hasAlways = () => props.request.always && props.request.always.length > 0

  return (
    <box
      flexDirection="column"
      gap={1}
      backgroundColor={riskBg()}
      border={["top", "right", "bottom", "left"]}
      borderColor={riskColor()}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      {/* Header: icon + title */}
      <box flexDirection="row" gap={1} alignItems="center">
        <text
          fg={props.risk.level === "critical" ? theme.error : props.risk.level === "privacy" ? theme.warning : theme.accent}
          attributes={TextAttributes.BOLD}
        >
          {icon()}
        </text>
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="word">
          {title()}
        </text>
      </box>

      {/* Shell command detail */}
      <Show when={props.request.permission === "shell" && props.input.command}>
        <box paddingLeft={2} paddingRight={1}>
          <text fg={theme.textMuted} wrapMode="word">
            $ {String(props.input.command)}
          </text>
        </box>
      </Show>

      {/* Risk callout */}
      <Show when={props.risk.level !== "normal"}>
        <box
          flexDirection="column"
          gap={0}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={
            props.risk.level === "critical"
              ? tint(theme.background, theme.error, 0.15)
              : tint(theme.background, theme.warning, 0.12)
          }
          border={["left"]}
          borderColor={props.risk.level === "critical" ? theme.error : theme.warning}
        >
          <text
            fg={props.risk.level === "critical" ? theme.error : theme.warning}
            attributes={TextAttributes.BOLD}
          >
            {props.risk.level === "critical" ? "⚠ Critical action" : "⚠ Privacy-sensitive"}
          </text>
          <text fg={theme.textMuted} wrapMode="word">
            {props.risk.reason}
          </text>
          <Show when={props.risk.suggestion}>
            <text fg={theme.text} wrapMode="word">
              Suggestion: {props.risk.suggestion}
            </text>
          </Show>
        </box>
      </Show>

      {/* Context note */}
      <text fg={theme.textMuted} wrapMode="word">
        Allow once to continue this step, allow always to trust this pattern, or deny to pause the run.
      </text>

      {/* Action buttons */}
      <box flexDirection="row" gap={1} paddingTop={0} flexWrap="wrap">
        <box
          backgroundColor={hovered() === "once" ? tint(theme.primary, theme.text, 0.15) : theme.primary}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={0}
          paddingBottom={0}
          borderStyle="rounded"
          borderColor={theme.primary}
          onMouseOver={() => setHovered("once")}
          onMouseOut={() => setHovered(null)}
          onMouseUp={() => props.onApproveOnce()}
        >
          <text fg={selectedForeground(theme, theme.primary)} attributes={TextAttributes.BOLD}>
            Y  Allow once
          </text>
        </box>

        <Show when={hasAlways()}>
          <box
            backgroundColor={hovered() === "always" ? tint(theme.accent, theme.text, 0.15) : theme.accent}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={0}
            paddingBottom={0}
            borderStyle="rounded"
            borderColor={theme.accent}
            onMouseOver={() => setHovered("always")}
            onMouseOut={() => setHovered(null)}
            onMouseUp={() => props.onApproveAlways()}
          >
            <text fg={selectedForeground(theme, theme.accent)} attributes={TextAttributes.BOLD}>
              A  Allow always
            </text>
          </box>
        </Show>

        <box
          backgroundColor={hovered() === "deny" ? tint(theme.error, theme.text, 0.12) : tint(theme.backgroundElement, theme.error, 0.1)}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={0}
          paddingBottom={0}
          borderStyle="rounded"
          borderColor={theme.error}
          onMouseOver={() => setHovered("deny")}
          onMouseOut={() => setHovered(null)}
          onMouseUp={() => props.onDeny()}
        >
          <text fg={theme.error} attributes={TextAttributes.BOLD}>
            N  Deny
          </text>
        </box>
      </box>

      {/* Keyboard hint */}
      <box flexDirection="row" gap={2} paddingTop={0}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text}>Y</text>
          <text fg={theme.textMuted}>allow once</text>
        </box>
        <Show when={hasAlways()}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>A</text>
            <text fg={theme.textMuted}>allow always</text>
          </box>
        </Show>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text}>N / Esc</text>
          <text fg={theme.textMuted}>deny</text>
        </box>
      </box>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Question card
// ──────────────────────────────────────────────────────────────────────────────
function QuestionCard(props: {
  request: QuestionRequest
  store: { tab: number; selected: number; answers: Array<QuestionAnswer> }
  onSelectTab: (i: number) => void
  onSelectOption: (i: number) => void
  onSubmit: () => void
  onSkip: () => void
}) {
  const { theme } = useTheme()

  const questions = () => props.request.questions ?? []
  const question = () => questions()[props.store.tab]
  const options = () => question()?.options ?? []
  const single = () => questions().length === 1 && questions()[0]?.multiple !== true

  return (
    <box
      flexDirection="column"
      gap={1}
      backgroundColor={theme.backgroundElement}
      border={["top", "right", "bottom", "left"]}
      borderColor={theme.accent}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
        ◌  Question
      </text>

      {/* Multi-question tabs */}
      <Show when={questions().length > 1}>
        <box flexDirection="row" gap={1}>
          <For each={questions()}>
            {(_, i) => (
              <box
                backgroundColor={props.store.tab === i() ? theme.accent : theme.backgroundPanel}
                paddingLeft={1}
                paddingRight={1}
                borderStyle="rounded"
                borderColor={props.store.tab === i() ? theme.accent : theme.borderSubtle}
                onMouseUp={() => props.onSelectTab(i())}
              >
                <text
                  fg={props.store.tab === i() ? selectedForeground(theme, theme.accent) : theme.textMuted}
                  attributes={props.store.tab === i() ? TextAttributes.BOLD : undefined}
                >
                  {i() + 1}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      {/* Question text */}
      <text fg={theme.text} wrapMode="word">
        {question()?.question}
      </text>

      {/* Option list */}
      <box flexDirection="column" gap={0} paddingLeft={1}>
        <For each={options()}>
          {(opt, i) => (
            <box
              flexDirection="row"
              gap={1}
              backgroundColor={
                props.store.selected === i()
                  ? tint(theme.backgroundPanel, theme.accent, 0.12)
                  : undefined
              }
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={() => {
                if (single()) {
                  props.onSelectOption(i())
                  props.onSubmit()
                } else {
                  props.onSelectOption(i())
                }
              }}
            >
              <text fg={props.store.selected === i() ? theme.accent : theme.textMuted}>
                {props.store.selected === i() ? "▸" : " "}
              </text>
              <text fg={theme.text}>{opt.label}</text>
            </box>
          )}
        </For>
      </box>

      {/* Action buttons */}
      <box flexDirection="row" gap={1} paddingTop={1} flexWrap="wrap">
        <box
          backgroundColor={theme.primary}
          paddingLeft={2}
          paddingRight={2}
          borderStyle="rounded"
          borderColor={theme.primary}
          onMouseUp={() => props.onSubmit()}
        >
          <text fg={selectedForeground(theme, theme.primary)} attributes={TextAttributes.BOLD}>
            Enter  Submit
          </text>
        </box>
        <box
          backgroundColor={tint(theme.backgroundElement, theme.error, 0.1)}
          paddingLeft={2}
          paddingRight={2}
          borderStyle="rounded"
          borderColor={theme.error}
          onMouseUp={() => props.onSkip()}
        >
          <text fg={theme.error} attributes={TextAttributes.BOLD}>
            Esc  Skip
          </text>
        </box>
      </box>

      <text fg={theme.textMuted}>↑↓ pick · Enter confirm · click directly</text>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Queue breadcrumb (rendered below the active card when there are multiple items)
// ──────────────────────────────────────────────────────────────────────────────
function QueueBreadcrumb(props: {
  items: RAOItem[]
  selectedIndex: number
  onSelect: (i: number) => void
}) {
  const { theme } = useTheme()

  return (
    <box
      flexDirection="column"
      gap={0}
      border={["top"]}
      borderColor={theme.borderSubtle}
      paddingTop={1}
      marginTop={1}
    >
      <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
        Queue ({props.items.length})
      </text>
      <For each={props.items}>
        {(item, idx) => {
          const isSelected = () => idx() === props.selectedIndex
          return (
            <box
              flexDirection="row"
              gap={1}
              backgroundColor={isSelected() ? tint(theme.backgroundElement, theme.primary, 0.08) : undefined}
              paddingLeft={1}
              paddingRight={1}
              onMouseUp={() => props.onSelect(idx())}
            >
              <text fg={isSelected() ? theme.accent : theme.textMuted}>{isSelected() ? "▸" : " "}</text>
              <text fg={isSelected() ? theme.text : theme.textMuted} attributes={isSelected() ? TextAttributes.BOLD : undefined}>
                {item.type === "permission" ? item.data.permission.replace(/_/g, " ") : "question"}
              </text>
              <Show when={item.type === "permission"}>
                <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
                  {formatAge(Date.now() - (item.data as PermissionRequest).createdAt)}
                </text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Main RAOPane export
// ──────────────────────────────────────────────────────────────────────────────
export function RAOPane(props: {
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  sessionID: string
  initialRequestID?: string
}) {
  const sdk = useSDK()
  const kv = useKV()
  const { theme } = useTheme()
  const sync = useSync()
  const dialog = useDialog()

  const items = createMemo<RAOItem[]>(() => {
    const result: RAOItem[] = []
    props.permissions.forEach((p, i) => result.push({ type: "permission", data: p, index: i }))
    props.questions.forEach((q, i) => result.push({ type: "question", data: q, index: i }))
    return result
  })

  const [selectedIndex, setSelectedIndex] = createSignal(0)

  // Clamp index when items list shrinks
  createEffect(() => {
    const len = items().length
    if (len === 0) return
    const idx = selectedIndex()
    if (idx < 0 || idx >= len) {
      setSelectedIndex(Math.max(0, len - 1))
    }
  })

  // Jump to a specific request when navigated from outside
  createEffect(() => {
    const requestID = props.initialRequestID
    if (!requestID) return
    const index = items().findIndex((item) => item.data.id === requestID)
    if (index >= 0 && index !== selectedIndex()) {
      setSelectedIndex(index)
    }
  })

  // Render only the currently selected item — avoids overlapping hit-areas in the
  // terminal renderer that would cause onMouseUp to be intercepted by invisible siblings.
  const currentItem = createMemo(() => items()[selectedIndex()] ?? null)

  const [questionStore, setQuestionStore] = createStore({
    tab: 0,
    answers: [] as Array<QuestionAnswer>,
    selected: 0,
  })

  const profile = createMemo<PolicyProfile>(() => parsePolicyProfile(kv.get(DAX_SETTING.policy_profile, "balanced")))

  // Resolve tool input for the current permission request
  const currentPermissionInput = createMemo<Record<string, unknown>>(() => {
    const item = currentItem()
    if (!item || item.type !== "permission") return {}
    const tool = item.data.tool
    if (!tool) return {}
    const parts = sync.data.part[tool.messageID] ?? []
    for (const part of parts) {
      if (part.type === "tool" && part.callID === tool.callID && part.state.status !== "pending") {
        return part.state.input ?? {}
      }
    }
    return {}
  })

  const currentRisk = createMemo(() => {
    const item = currentItem()
    if (!item || item.type !== "permission") return { level: "normal" as PermissionRiskLevel, reason: "" }
    return classifyPermissionRisk(item.data, currentPermissionInput(), profile())
  })

  function advanceAfterReply() {
    const len = items().length
    if (selectedIndex() >= len - 1) {
      setSelectedIndex(Math.max(0, len - 2))
    }
  }

  function handlePermissionReply(requestID: string, reply: "once" | "always" | "reject", message?: string) {
    sdk.client.permission.reply({ reply, requestID, message })
    advanceAfterReply()
  }

  function handleQuestionReply(requestID: string, answers: Array<QuestionAnswer>) {
    sdk.client.question.reply({ requestID, answers })
    advanceAfterReply()
  }

  function handleQuestionReject(requestID: string) {
    sdk.client.question.reject({ requestID })
    advanceAfterReply()
  }

  // Keyboard shortcuts — active as long as RAOPane is mounted and dialog is closed
  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    const allItems = items()
    if (allItems.length === 0) return

    const item = currentItem()
    if (!item) return

    // Navigate between queued items
    if (evt.name === "left" || evt.name === "up") {
      if (item.type !== "question" || (item.data.questions ?? []).length === 0) {
        evt.preventDefault()
        setSelectedIndex((prev) => Math.max(0, prev - 1))
        return
      }
    }
    if (evt.name === "right" || evt.name === "down") {
      if (item.type !== "question" || (item.data.questions ?? []).length === 0) {
        evt.preventDefault()
        setSelectedIndex((prev) => Math.min(allItems.length - 1, prev + 1))
        return
      }
    }

    if (item.type === "permission") {
      if (evt.name === "y" || evt.name === "return") {
        evt.preventDefault()
        handlePermissionReply(item.data.id, "once")
        return
      }
      if (evt.name === "a") {
        evt.preventDefault()
        handlePermissionReply(item.data.id, "always")
        return
      }
      if (evt.name === "n" || evt.name === "escape") {
        evt.preventDefault()
        handlePermissionReply(item.data.id, "reject")
        return
      }
    }

    if (item.type === "question") {
      const request = item.data
      const qs = request.questions ?? []
      const currentQ = qs[questionStore.tab]
      const optCount = currentQ?.options?.length ?? 0

      if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
        evt.preventDefault()
        setQuestionStore("selected", (prev) => Math.max(0, prev - 1))
        return
      }
      if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
        evt.preventDefault()
        setQuestionStore("selected", (prev) => Math.min(optCount - 1, prev + 1))
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        const option = currentQ?.options?.[questionStore.selected]
        if (!option) return
        if (qs.length === 1 && currentQ?.multiple !== true) {
          handleQuestionReply(request.id, [[option.label]])
          return
        }
        const answers = [...questionStore.answers]
        answers[questionStore.tab] = [option.label]
        setQuestionStore("answers", answers)
        if (questionStore.tab < qs.length - 1) {
          setQuestionStore("tab", questionStore.tab + 1)
          setQuestionStore("selected", 0)
          return
        }
        handleQuestionReply(request.id, answers as unknown as Array<QuestionAnswer>)
        return
      }
      if (evt.name === "escape") {
        evt.preventDefault()
        handleQuestionReject(request.id)
      }
    }
  })

  return (
    <box flexDirection="column" gap={1} flexGrow={1}>
      {/* Section header */}
      <box flexDirection="column" gap={0} paddingBottom={1} border={["bottom"]} borderColor={theme.borderSubtle}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          Review queue
        </text>
        <text fg={theme.textMuted}>Resolve approvals and questions so DAX can continue safely.</text>
      </box>

      {/* Empty state */}
      <Show when={items().length === 0}>
        <box
          flexDirection="column"
          gap={1}
          padding={1}
          borderStyle="rounded"
          borderColor={theme.borderSubtle}
          backgroundColor={tint(theme.background, theme.success, 0.04)}
        >
          <text fg={theme.success} attributes={TextAttributes.BOLD}>
            ✓  All clear
          </text>
          <text fg={theme.textMuted}>No approvals or open questions right now.</text>
        </box>
      </Show>

      {/* Queue */}
      <Show when={items().length > 0}>
        {/* Navigation bar */}
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>
            {items().length} pending
          </text>
          <text fg={theme.textMuted}>
            ({selectedIndex() + 1}/{items().length})
          </text>
          <box flexGrow={1} />
          <Show when={items().length > 1}>
            <box flexDirection="row" gap={0}>
              <box
                onMouseUp={() => setSelectedIndex(Math.max(0, selectedIndex() - 1))}
                paddingLeft={1}
                paddingRight={1}
                borderStyle="rounded"
                borderColor={theme.borderSubtle}
              >
                <text fg={theme.textMuted}>←</text>
              </box>
              <box
                onMouseUp={() => setSelectedIndex(Math.min(items().length - 1, selectedIndex() + 1))}
                paddingLeft={1}
                paddingRight={1}
                borderStyle="rounded"
                borderColor={theme.borderSubtle}
              >
                <text fg={theme.textMuted}>→</text>
              </box>
            </box>
          </Show>
        </box>

        {/* Multi-item tab strip */}
        <Show when={items().length > 1}>
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <For each={items()}>
              {(item, idx) => {
                const isSelected = () => idx() === selectedIndex()
                const accentColor = () => (item.type === "permission" ? theme.warning : theme.accent)
                return (
                  <box
                    onMouseUp={() => setSelectedIndex(idx())}
                    backgroundColor={isSelected() ? tint(theme.background, accentColor(), 0.14) : theme.backgroundElement}
                    border={["left"]}
                    borderColor={isSelected() ? accentColor() : theme.borderSubtle}
                    paddingLeft={1}
                    paddingRight={1}
                  >
                    <box flexDirection="row" gap={1} alignItems="center">
                      <text
                        fg={isSelected() ? accentColor() : theme.textMuted}
                        attributes={isSelected() ? TextAttributes.BOLD : undefined}
                      >
                        {item.type === "permission" ? "●" : "◌"}
                      </text>
                      <text
                        fg={isSelected() ? theme.text : theme.textMuted}
                        attributes={isSelected() ? TextAttributes.BOLD : undefined}
                      >
                        {item.type === "permission"
                          ? item.data.permission.replace(/_/g, " ")
                          : `Q${item.index + 1}`}
                      </text>
                      <Show when={item.type === "permission"}>
                        {(() => {
                          const ageMs = Date.now() - (item.data as PermissionRequest).createdAt
                          return (
                            <text fg={ageMs > 5 * 60 * 1000 ? theme.warning : theme.textMuted} attributes={TextAttributes.DIM}>
                              {formatAge(ageMs)}
                            </text>
                          )
                        })()}
                      </Show>
                    </box>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>

        {/* Active item — rendered directly (not inside For+Show) to prevent ghost hit-areas */}
        <Switch>
          <Match when={currentItem()?.type === "permission"}>
            {(() => {
              const item = currentItem() as RAOItem & { type: "permission" }
              if (!item) return null
              return (
                <PermissionCard
                  request={item.data}
                  input={currentPermissionInput()}
                  risk={currentRisk()}
                  onApproveOnce={() => handlePermissionReply(item.data.id, "once")}
                  onApproveAlways={() => handlePermissionReply(item.data.id, "always")}
                  onDeny={() => handlePermissionReply(item.data.id, "reject")}
                />
              )
            })()}
          </Match>

          <Match when={currentItem()?.type === "question"}>
            {(() => {
              const item = currentItem() as RAOItem & { type: "question" }
              if (!item) return null
              return (
                <QuestionCard
                  request={item.data}
                  store={questionStore}
                  onSelectTab={(i) => {
                    setQuestionStore("tab", i)
                    setQuestionStore("selected", 0)
                  }}
                  onSelectOption={(i) => setQuestionStore("selected", i)}
                  onSubmit={() => {
                    const qs = item.data.questions ?? []
                    const answers = qs.map((_, i) => questionStore.answers[i] ?? [])
                    handleQuestionReply(item.data.id, answers as unknown as Array<QuestionAnswer>)
                  }}
                  onSkip={() => handleQuestionReject(item.data.id)}
                />
              )
            })()}
          </Match>
        </Switch>

        {/* Queue breadcrumb for multi-item queue */}
        <Show when={items().length > 1}>
          <QueueBreadcrumb
            items={items()}
            selectedIndex={selectedIndex()}
            onSelect={(i) => setSelectedIndex(i)}
          />
        </Show>
      </Show>
    </box>
  )
}
