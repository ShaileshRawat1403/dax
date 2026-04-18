import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { TextAttributes, type TextareaRenderable } from "@opentui/core"
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
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { classifyPermissionRisk, type PermissionRiskLevel } from "../../util/permission-risk"

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  const hours = Math.floor(ms / 3600000)
  const days = Math.floor(ms / 86400000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
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

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type RAOItem =
  | { type: "permission"; data: PermissionRequest; index: number }
  | { type: "question"; data: QuestionRequest; index: number }

// Card lifecycle: deciding → confirming-always or denying → sent
export type CardPhase = "deciding" | "confirming-always" | "denying" | "sent"

function permissionIcon(perm: string) {
  if (perm === "shell") return "#"
  if (perm === "edit" || perm === "apply_patch") return "✎"
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

function permissionTitle(request: PermissionRequest, input: Record<string, unknown>) {
  const perm = request.permission
  const i = input
  if (perm === "shell") return (i.description as string) ?? "Run command"
  if (perm === "edit" || perm === "apply_patch") return `Edit ${normalizePath(request.metadata?.filepath as string)}`
  if (perm === "read") return `Read ${normalizePath(i.filePath as string)}`
  if (perm === "glob") return `Glob "${i.pattern ?? ""}"`
  if (perm === "grep") return `Grep "${i.pattern ?? ""}"`
  if (perm === "list") return `List ${normalizePath(i.path as string)}`
  if (perm === "webfetch") return `Fetch ${i.url ?? ""}`
  if (perm === "websearch" || perm === "codesearch") return `Search "${i.query ?? ""}"`
  if (perm === "task") return `${i.subagent_type ?? "Task"}: ${i.description ?? ""}`
  if (perm === "external_directory") {
    const meta = request.metadata ?? {}
    const parent = typeof meta["parentDir"] === "string" ? meta["parentDir"] : undefined
    const filepath = typeof meta["filepath"] === "string" ? meta["filepath"] : undefined
    const pattern = request.patterns?.[0]
    const derived = typeof pattern === "string" ? (pattern.includes("*") ? path.dirname(pattern) : pattern) : undefined
    return `Access external dir: ${normalizePath(parent ?? filepath ?? derived)}`
  }
  if (perm === "doom_loop") return "Continue after repeated failures"
  return perm
}

// ──────────────────────────────────────────────────────────────────────────────
// PermissionCard — fully controlled by RAOPane
// ──────────────────────────────────────────────────────────────────────────────
function PermissionCard(props: {
  request: PermissionRequest
  input: Record<string, unknown>
  risk: { level: PermissionRiskLevel; reason: string; suggestion?: string }
  cardPhase: CardPhase
  selectedButtonIdx: number
  buttons: Array<"once" | "always" | "deny">
  diffExpanded: boolean
  onSetPhase: (p: CardPhase) => void
  onToggleDiff: () => void
  onApproveOnce: () => void
  onApproveAlways: () => void
  onDeny: (reason?: string) => void
  onSetSelectedBtn: (i: number) => void
  denyTextareaRef: (el: TextareaRenderable) => void
  textareaKeybindings: ReturnType<typeof useTextareaKeybindings>
  ageMs: number
}) {
  const themeState = useTheme()
  const theme = themeState.theme
  const syntax = themeState.syntax
  const dimensions = useTerminalDimensions()

  const riskColor = () => {
    if (props.risk.level === "critical") return theme.error
    if (props.risk.level === "privacy") return theme.warning
    return theme.border
  }

  const riskBg = () => {
    if (props.risk.level === "critical") return tint(theme.background, theme.error, 0.08)
    if (props.risk.level === "privacy") return tint(theme.background, theme.warning, 0.08)
    return tint(theme.background, theme.backgroundElement, 0.15)
  }

  const icon = () => permissionIcon(props.request.permission)
  const title = () => permissionTitle(props.request, props.input)
  const hasAlways = () => props.request.always && props.request.always.length > 0

  const diff = () => (props.request.metadata?.diff as string) ?? ""
  const hasDiff = () => (props.request.permission === "edit" || props.request.permission === "apply_patch") && !!diff()
  const ft = () => filetype(props.request.metadata?.filepath as string)

  const isStale = () => props.ageMs > 5 * 60 * 1000 // > 5 min

  // button label + style per key
  const buttonStyle = (key: "once" | "always" | "deny", idx: number) => {
    const isSelected = idx === props.selectedButtonIdx
    if (key === "once")
      return {
        bg: isSelected ? theme.primary : tint(theme.primary, theme.background, 0.4),
        border: isSelected ? theme.borderActive : theme.primary,
        fg: isSelected ? selectedForeground(theme, theme.primary) : theme.primary,
        label: "Y  Allow once",
      }
    if (key === "always")
      return {
        bg: isSelected ? theme.accent : tint(theme.accent, theme.background, 0.4),
        border: isSelected ? theme.borderActive : theme.accent,
        fg: isSelected ? selectedForeground(theme, theme.accent) : theme.accent,
        label: "A  Allow always",
      }
    return {
      bg: isSelected
        ? tint(theme.backgroundElement, theme.error, 0.22)
        : tint(theme.backgroundElement, theme.error, 0.1),
      border: isSelected ? theme.borderActive : theme.error,
      fg: theme.error,
      label: "N  Deny",
    }
  }

  return (
    <box
      flexDirection="column"
      gap={1}
      backgroundColor={riskBg()}
      borderStyle="round"
      borderColor={props.cardPhase === "sent" ? theme.success : tint(riskColor(), theme.background, 0.3)}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      {/* ── Header ── */}
      <box flexDirection="row" gap={1} alignItems="center" marginBottom={0.5}>
        <box
          backgroundColor={tint(riskColor(), theme.background, 0.1)}
          paddingLeft={1}
          paddingRight={1}
          borderStyle="round"
          borderColor={riskColor()}
        >
          <text
            fg={
              props.risk.level === "critical"
                ? theme.error
                : props.risk.level === "privacy"
                  ? theme.warning
                  : theme.accent
            }
            attributes={TextAttributes.BOLD}
          >
            {icon()}
          </text>
        </box>
        <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="word" flexGrow={1}>
          {title()}
        </text>
        {/* Age badge */}
        <text fg={isStale() ? theme.warning : theme.textMuted} attributes={TextAttributes.DIM}>
          {isStale() ? "⏱ " : ""}
          {formatAge(props.ageMs)}
        </text>
      </box>

      {/* ── Shell command detail ── */}
      <Show when={props.request.permission === "shell" && props.input.command}>
        <box
          paddingLeft={1}
          paddingRight={1}
          paddingTop={0.5}
          paddingBottom={0.5}
          backgroundColor={tint(theme.background, theme.textMuted, 0.04)}
          borderStyle="round"
          borderColor={theme.borderSubtle}
        >
          <text fg={theme.textMuted} wrapMode="word" attributes={TextAttributes.DIM}>
            $ {String(props.input.command)}
          </text>
        </box>
      </Show>

      {/* ── Diff preview for edits ── */}
      <Show when={hasDiff()}>
        <box flexDirection="column" gap={0}>
          <box flexDirection="row" gap={1} onMouseUp={() => props.onToggleDiff()} paddingLeft={1}>
            <text fg={theme.textMuted}>{props.diffExpanded ? "▾" : "▸"}</text>
            <text fg={props.diffExpanded ? theme.text : theme.textMuted}>
              {props.diffExpanded ? "Hide diff" : "Show diff"}
            </text>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              Ctrl+D
            </text>
          </box>
          <Show when={props.diffExpanded}>
            <box
              maxHeight={14}
              border={["top", "right", "bottom", "left"]}
              borderColor={theme.borderSubtle}
              backgroundColor={theme.background}
            >
              <scrollbox height="100%" width="100%">
                <diff
                  diff={diff()}
                  view="unified"
                  filetype={ft()}
                  syntaxStyle={syntax()}
                  showLineNumbers={true}
                  width={Math.max(40, dimensions().width - 8)}
                  wrapMode="word"
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
          </Show>
        </box>
      </Show>

      {/* ── Risk callout ── */}
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
              ? tint(theme.background, theme.error, 0.14)
              : tint(theme.background, theme.warning, 0.1)
          }
          border={["left"]}
          borderColor={props.risk.level === "critical" ? theme.error : theme.warning}
        >
          <text fg={props.risk.level === "critical" ? theme.error : theme.warning} attributes={TextAttributes.BOLD}>
            {props.risk.level === "critical" ? "⚠  Critical action" : "⚠  Privacy-sensitive"}
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

      {/* ════════════════════════════════════════════════════
          PHASE: sent — item will disappear from queue shortly
          ════════════════════════════════════════════════════ */}
      <Show when={props.cardPhase === "sent"}>
        <box
          flexDirection="row"
          gap={1}
          alignItems="center"
          paddingLeft={1}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={tint(theme.background, theme.success, 0.08)}
          border={["left"]}
          borderColor={theme.success}
        >
          <text fg={theme.success} attributes={TextAttributes.BOLD}>
            ✓
          </text>
          <text fg={theme.success}>Decision sent — DAX will continue.</text>
        </box>
      </Show>

      {/* ════════════════════════════════════════════════════
          PHASE: deciding — main action buttons
          ════════════════════════════════════════════════════ */}
      <Show when={props.cardPhase === "deciding"}>
        <text fg={theme.textMuted} wrapMode="word">
          Allow once to continue this step · allow always to trust this pattern · deny to pause.
        </text>

        {/* Buttons row */}
        <box flexDirection="row" gap={1} flexWrap="wrap">
          <For each={props.buttons}>
            {(key, i) => {
              const s = () => buttonStyle(key, i())
              return (
                <box
                  backgroundColor={s().bg}
                  paddingLeft={2}
                  paddingRight={2}
                  borderStyle="rounded"
                  borderColor={s().border}
                  onMouseOver={() => props.onSetSelectedBtn(i())}
                  onMouseUp={() => {
                    props.onSetSelectedBtn(i())
                    if (key === "once") props.onApproveOnce()
                    else if (key === "always") props.onSetPhase("confirming-always")
                    else props.onSetPhase("denying")
                  }}
                >
                  <text fg={s().fg} attributes={TextAttributes.BOLD}>
                    {s().label}
                  </text>
                </box>
              )
            }}
          </For>
        </box>

        {/* Keyboard hint */}
        <box flexDirection="row" gap={2}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>← →</text>
            <text fg={theme.textMuted}>select</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>Enter</text>
            <text fg={theme.textMuted}>confirm</text>
          </box>
          <Show when={hasDiff()}>
            <box flexDirection="row" gap={1}>
              <text fg={theme.text}>Ctrl+D</text>
              <text fg={theme.textMuted}>diff</text>
            </box>
          </Show>
        </box>
      </Show>

      {/* ════════════════════════════════════════════════════
          PHASE: confirming-always — show patterns + confirm
          ════════════════════════════════════════════════════ */}
      <Show when={props.cardPhase === "confirming-always"}>
        <box
          flexDirection="column"
          gap={1}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={tint(theme.background, theme.accent, 0.08)}
          border={["left"]}
          borderColor={theme.accent}
        >
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            Confirm — Allow always
          </text>
          <Show
            when={props.request.always.length === 1 && props.request.always[0] === "*"}
            fallback={
              <box flexDirection="column" gap={0}>
                <text fg={theme.textMuted}>These patterns will be trusted for this session:</text>
                <For each={props.request.always}>{(pattern) => <text fg={theme.text}> · {pattern}</text>}</For>
              </box>
            }
          >
            <text fg={theme.textMuted}>
              All <text fg={theme.text}>{props.request.permission}</text> actions will be allowed until DAX restarts.
            </text>
          </Show>
        </box>

        <box flexDirection="row" gap={1} flexWrap="wrap">
          <box
            backgroundColor={theme.accent}
            paddingLeft={2}
            paddingRight={2}
            borderStyle="rounded"
            borderColor={theme.accent}
            onMouseUp={() => props.onApproveAlways()}
          >
            <text fg={selectedForeground(theme, theme.accent)} attributes={TextAttributes.BOLD}>
              Enter Confirm
            </text>
          </box>
          <box
            backgroundColor={theme.backgroundElement}
            paddingLeft={2}
            paddingRight={2}
            borderStyle="rounded"
            borderColor={theme.borderSubtle}
            onMouseUp={() => props.onSetPhase("deciding")}
          >
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              Esc Cancel
            </text>
          </box>
        </box>
        <text fg={theme.textMuted}>Enter confirm · Esc cancel</text>
      </Show>

      {/* ════════════════════════════════════════════════════
          PHASE: denying — inline reason textarea
          ════════════════════════════════════════════════════ */}
      <Show when={props.cardPhase === "denying"}>
        <box
          flexDirection="column"
          gap={1}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={tint(theme.background, theme.error, 0.07)}
          border={["left"]}
          borderColor={theme.error}
        >
          <text fg={theme.error} attributes={TextAttributes.BOLD}>
            △ Deny — tell DAX what to do differently
          </text>
          <text fg={theme.textMuted}>Optional. Press Enter to confirm, Esc to go back.</text>
          <textarea
            ref={props.denyTextareaRef}
            focused
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.primary}
            keyBindings={props.textareaKeybindings()}
          />
        </box>

        <box flexDirection="row" gap={1} flexWrap="wrap">
          <box
            backgroundColor={tint(theme.backgroundElement, theme.error, 0.15)}
            paddingLeft={2}
            paddingRight={2}
            borderStyle="rounded"
            borderColor={theme.error}
            onMouseUp={() => {
              // Mouse confirm: fire deny (textarea value read by keyboard handler in RAOPane)
              // We signal by calling onDeny with empty string — RAOPane reads the ref
              props.onDeny()
            }}
          >
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              Enter Confirm deny
            </text>
          </box>
          <box
            backgroundColor={theme.backgroundElement}
            paddingLeft={2}
            paddingRight={2}
            borderStyle="rounded"
            borderColor={theme.borderSubtle}
            onMouseUp={() => props.onSetPhase("deciding")}
          >
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              Esc Cancel
            </text>
          </box>
        </box>
      </Show>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Question card
// ──────────────────────────────────────────────────────────────────────────────
function QuestionCard(props: {
  request: QuestionRequest
  store: { tab: number; selected: number; answers: Array<QuestionAnswer> }
  sent: boolean
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
      borderColor={props.sent ? theme.success : theme.accent}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
        ◌ Question
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

      {/* Options list */}
      <box flexDirection="column" gap={0} paddingLeft={1}>
        <For each={options()}>
          {(opt, i) => (
            <box
              flexDirection="row"
              gap={1}
              backgroundColor={
                props.store.selected === i() ? tint(theme.backgroundPanel, theme.accent, 0.12) : undefined
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

      {/* Sent confirmation */}
      <Show when={props.sent}>
        <box
          flexDirection="row"
          gap={1}
          paddingLeft={1}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={tint(theme.background, theme.success, 0.08)}
          border={["left"]}
          borderColor={theme.success}
        >
          <text fg={theme.success} attributes={TextAttributes.BOLD}>
            ✓
          </text>
          <text fg={theme.success}>Answer sent.</text>
        </box>
      </Show>

      {/* Action buttons (hide when sent) */}
      <Show when={!props.sent}>
        <box flexDirection="row" gap={1} flexWrap="wrap">
          <box
            backgroundColor={theme.primary}
            paddingLeft={2}
            paddingRight={2}
            borderStyle="rounded"
            borderColor={theme.primary}
            onMouseUp={() => props.onSubmit()}
          >
            <text fg={selectedForeground(theme, theme.primary)} attributes={TextAttributes.BOLD}>
              Enter Submit
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
              Esc Skip
            </text>
          </box>
        </box>
        <text fg={theme.textMuted}>↑↓ pick · Enter confirm · click directly</text>
      </Show>
    </box>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Queue breadcrumb
// ──────────────────────────────────────────────────────────────────────────────
function QueueBreadcrumb(props: { items: RAOItem[]; selectedIndex: number; onSelect: (i: number) => void }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="column" gap={0} border={["top"]} borderColor={theme.borderSubtle} paddingTop={1} marginTop={1}>
      <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>{`Queue (${props.items.length})`}</text>
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
              <text
                fg={isSelected() ? theme.text : theme.textMuted}
                attributes={isSelected() ? TextAttributes.BOLD : undefined}
              >
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
  const textareaKeybindings = useTextareaKeybindings()

  // Track items that have been replied to locally — removes them from the queue
  // immediately after the "sent" flash instead of waiting for the server to update.
  const [repliedIDs, setRepliedIDs] = createSignal(new Set<string>())

  // All items in the review queue (minus locally-replied ones)
  const items = createMemo<RAOItem[]>(() => {
    const replied = repliedIDs()
    const result: RAOItem[] = []
    props.permissions
      .filter((p) => !replied.has(p.id))
      .forEach((p, i) => result.push({ type: "permission", data: p, index: i }))
    props.questions
      .filter((q) => !replied.has(q.id))
      .forEach((q, i) => result.push({ type: "question", data: q, index: i }))
    return result
  })

  const [selectedIndex, setSelectedIndex] = createSignal(0)

  // Clamp index when items list shrinks
  createEffect(() => {
    const len = items().length
    if (len === 0) return
    const idx = selectedIndex()
    if (idx < 0 || idx >= len) setSelectedIndex(Math.max(0, len - 1))
  })

  // Jump to specific request from external navigation
  createEffect(() => {
    const requestID = props.initialRequestID
    if (!requestID) return
    const index = items().findIndex((item) => item.data.id === requestID)
    if (index >= 0 && index !== selectedIndex()) setSelectedIndex(index)
  })

  // Render only the currently selected item — avoids overlapping hit-areas
  const currentItem = createMemo(() => items()[selectedIndex()] ?? null)

  // ── Card phase state (per-item, reset when item changes) ──
  const [cardPhase, setCardPhase] = createSignal<CardPhase>("deciding")
  const [selectedButtonIdx, setSelectedButtonIdx] = createSignal(0)
  const [diffExpanded, setDiffExpanded] = createSignal(false)
  const [questionSent, setQuestionSent] = createSignal(false)
  let denyTextarea: TextareaRenderable | undefined

  createEffect(
    on(currentItem, () => {
      setCardPhase("deciding")
      setSelectedButtonIdx(0)
      setDiffExpanded(false)
      setQuestionSent(false)
    }),
  )

  // ── Question store ──
  const [questionStore, setQuestionStore] = createStore({
    tab: 0,
    answers: [] as Array<QuestionAnswer>,
    selected: 0,
  })

  const profile = createMemo<PolicyProfile>(() => parsePolicyProfile(kv.get(DAX_SETTING.policy_profile, "balanced")))

  // Tool input for the current permission request
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

  // Build the visible button list based on whether "always" is available
  const permissionButtons = createMemo<Array<"once" | "always" | "deny">>(() => {
    const item = currentItem()
    if (!item || item.type !== "permission") return ["once", "deny"]
    const hasAlways = item.data.always && item.data.always.length > 0
    return hasAlways ? ["once", "always", "deny"] : ["once", "deny"]
  })

  // Remove an item from the local queue after the "sent" flash
  function markReplied(requestID: string) {
    setTimeout(() => {
      setRepliedIDs((prev) => {
        const next = new Set(prev)
        next.add(requestID)
        return next
      })
    }, 400)
  }

  function handlePermissionReply(requestID: string, reply: "once" | "always" | "reject", message?: string) {
    setCardPhase("sent")
    sdk.client.permission.reply({ reply, requestID, message })
    markReplied(requestID)
  }

  function handleQuestionReply(requestID: string, answers: Array<QuestionAnswer>) {
    setQuestionSent(true)
    sdk.client.question.reply({ requestID, answers })
    markReplied(requestID)
  }

  function handleQuestionReject(requestID: string) {
    setQuestionSent(true)
    sdk.client.question.reject({ requestID })
    markReplied(requestID)
  }

  // ── Keyboard handler — fully state-aware ──
  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    const allItems = items()
    if (allItems.length === 0) return
    const item = currentItem()
    if (!item) return

    const phase = cardPhase()

    // In "sent" phase: only allow navigating away to the next item
    if (phase === "sent") return

    // ── Denying phase: only intercept Enter / Esc ──
    if (phase === "denying") {
      if (evt.name === "return") {
        evt.preventDefault()
        const reason = denyTextarea?.plainText?.trim() || undefined
        if (item.type === "permission") handlePermissionReply(item.data.id, "reject", reason)
        return
      }
      if (evt.name === "escape") {
        evt.preventDefault()
        setCardPhase("deciding")
        return
      }
      return // let textarea handle all other keys
    }

    // ── Confirming-always phase ──
    if (phase === "confirming-always") {
      if (evt.name === "return" || evt.name === "y") {
        evt.preventDefault()
        if (item.type === "permission") handlePermissionReply(item.data.id, "always")
        return
      }
      if (evt.name === "escape" || evt.name === "n") {
        evt.preventDefault()
        setCardPhase("deciding")
        return
      }
      return
    }

    // ── Deciding phase (permission) ──
    if (item.type === "permission") {
      const btns = permissionButtons()

      // Navigate between queue items (when not cycling buttons)
      if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
        evt.preventDefault()
        setSelectedIndex((prev) => Math.max(0, prev - 1))
        return
      }
      if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
        evt.preventDefault()
        setSelectedIndex((prev) => Math.min(allItems.length - 1, prev + 1))
        return
      }

      // Cycle button selection with left/right / Tab
      if (evt.name === "left") {
        evt.preventDefault()
        setSelectedButtonIdx((prev) => (prev - 1 + btns.length) % btns.length)
        return
      }
      if (evt.name === "right" || evt.name === "tab") {
        evt.preventDefault()
        setSelectedButtonIdx((prev) => (prev + 1) % btns.length)
        return
      }

      // Enter fires currently selected button
      if (evt.name === "return") {
        evt.preventDefault()
        const selected = btns[selectedButtonIdx()]
        if (selected === "once") handlePermissionReply(item.data.id, "once")
        else if (selected === "always") setCardPhase("confirming-always")
        else setCardPhase("denying")
        return
      }

      // Direct shortcut keys
      if (evt.name === "y") {
        evt.preventDefault()
        handlePermissionReply(item.data.id, "once")
        return
      }
      if (evt.name === "a" && btns.includes("always")) {
        evt.preventDefault()
        setCardPhase("confirming-always")
        return
      }
      if (evt.name === "n" || evt.name === "escape") {
        evt.preventDefault()
        setCardPhase("denying")
        return
      }

      // Ctrl+D toggles diff
      if (evt.ctrl && evt.name === "d") {
        evt.preventDefault()
        setDiffExpanded((v) => !v)
        return
      }
    }

    // ── Deciding phase (question) ──
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

  // ── Render ──
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
            ✓ All clear
          </text>
          <text fg={theme.textMuted}>No approvals or open questions right now.</text>
        </box>
      </Show>

      <Show when={items().length > 0}>
        {/* Navigation bar */}
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>{`${items().length} pending`}</text>
          <text fg={theme.textMuted}>{`(${selectedIndex() + 1}/${items().length})`}</text>
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

        {/* Tab strip for multi-item queue */}
        <Show when={items().length > 1}>
          <box flexDirection="row" gap={1} flexWrap="wrap">
            <For each={items()}>
              {(item, idx) => {
                const isSelected = () => idx() === selectedIndex()
                const accentColor = () => (item.type === "permission" ? theme.warning : theme.accent)
                return (
                  <box
                    onMouseUp={() => setSelectedIndex(idx())}
                    backgroundColor={
                      isSelected() ? tint(theme.background, accentColor(), 0.14) : theme.backgroundElement
                    }
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
                        {item.type === "permission" ? item.data.permission.replace(/_/g, " ") : `Q${item.index + 1}`}
                      </text>
                      <Show when={item.type === "permission"}>
                        {(() => {
                          const ageMs = Date.now() - (item.data as PermissionRequest).createdAt
                          return (
                            <text
                              fg={ageMs > 5 * 60 * 1000 ? theme.warning : theme.textMuted}
                              attributes={TextAttributes.DIM}
                            >
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

        {/* Active item — direct render, no For+Show to prevent ghost hit-areas */}
        <Switch>
          <Match when={currentItem()?.type === "permission"}>
            {(() => {
              const item = currentItem() as RAOItem & { type: "permission" }
              if (!item) return null
              const ageMs = Date.now() - item.data.createdAt
              return (
                <PermissionCard
                  request={item.data}
                  input={currentPermissionInput()}
                  risk={currentRisk()}
                  cardPhase={cardPhase()}
                  selectedButtonIdx={selectedButtonIdx()}
                  buttons={permissionButtons()}
                  diffExpanded={diffExpanded()}
                  ageMs={ageMs}
                  onSetPhase={setCardPhase}
                  onToggleDiff={() => setDiffExpanded((v) => !v)}
                  onApproveOnce={() => handlePermissionReply(item.data.id, "once")}
                  onApproveAlways={() => handlePermissionReply(item.data.id, "always")}
                  onDeny={() => {
                    const reason = denyTextarea?.plainText?.trim() || undefined
                    handlePermissionReply(item.data.id, "reject", reason)
                  }}
                  onSetSelectedBtn={setSelectedButtonIdx}
                  denyTextareaRef={(el) => {
                    denyTextarea = el
                  }}
                  textareaKeybindings={textareaKeybindings}
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
                  sent={questionSent()}
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

        {/* Queue breadcrumb */}
        <Show when={items().length > 1}>
          <QueueBreadcrumb items={items()} selectedIndex={selectedIndex()} onSelect={(i) => setSelectedIndex(i)} />
        </Show>
      </Show>
    </box>
  )
}
