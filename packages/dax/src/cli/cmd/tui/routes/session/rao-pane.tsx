import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, Show, Switch } from "solid-js"
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

// What the user just decided — echoed in the sent-phase confirmation so
// the user gets a specific acknowledgment instead of generic "decision sent".
export type DecisionEcho =
  | { kind: "permission"; reply: "once" | "always" | "reject"; message?: string }
  | { kind: "question"; action: "answered" | "rejected" }

function sentPhaseMessage(d: DecisionEcho | null): string {
  if (!d) return "Decision sent — DAX will continue."
  if (d.kind === "permission") {
    switch (d.reply) {
      case "once":
        return "Approved (once) — DAX will continue."
      case "always":
        return "Approved & added to allowlist — DAX will continue."
      case "reject":
        return "Denied — DAX will stop this action."
    }
  }
  if (d.kind === "question") {
    return d.action === "answered" ? "Answer sent — DAX will continue." : "Question dismissed — DAX will continue."
  }
  return "Decision sent — DAX will continue."
}

function permissionIcon(perm: string) {
  if (perm === "shell" || perm === "command_execute") return "#"
  if (perm === "edit" || perm === "apply_patch" || perm === "file_write" || perm === "patch_apply") return "✎"
  if (perm === "read") return "→"
  if (perm === "glob" || perm === "grep") return "✱"
  if (perm === "webfetch") return "%"
  if (perm === "websearch") return "◈"
  if (perm === "codesearch") return "◇"
  if (perm === "task") return "◉"
  if (perm === "external_directory") return "←"
  if (perm === "doom_loop") return "⟳"
  if (perm === "workflow_gate" || perm === "policy_violation") return "△"
  if (perm === "tool_use") return "◎"
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
  // Runtime-guard categories: keep the title short so the reason flows
  // into the risk callout instead of becoming a wall of text in the
  // header. The full reason is rendered by classifyPermissionRisk.
  if (perm === "workflow_gate") return "Runtime policy gate"
  if (perm === "policy_violation") return "Policy violation"
  if (perm === "tool_use") return "Tool use approval"
  if (perm === "command_execute") {
    const command = i.command
    if (typeof command === "string" && command.length > 0) return `Run command: ${command.slice(0, 60)}`
    return "Run command"
  }
  if (perm === "file_write" || perm === "patch_apply") {
    const target = request.metadata?.filepath
    if (typeof target === "string" && target.length > 0) return `Write ${normalizePath(target)}`
    return "Write file"
  }
  // Generic fallback for any other future permission type.
  const fallback = request.patterns?.[0]
  if (typeof fallback === "string" && fallback.length > 0) {
    return `${humanizePermission(perm)}: ${fallback}`
  }
  return humanizePermission(perm)
}

function humanizePermission(perm: string): string {
  // tool_use → "Tool use", command_execute → "Command execute", etc.
  return perm
    .split("_")
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ")
}

// ──────────────────────────────────────────────────────────────────────────────
// PermissionCard — fully controlled by RAOPane
// ──────────────────────────────────────────────────────────────────────────────
function PermissionCard(props: {
  request: PermissionRequest
  input: Record<string, unknown>
  risk: { level: PermissionRiskLevel; reason: string; suggestion?: string }
  cardPhase: CardPhase
  lastDecision: DecisionEcho | null
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
        bg: isSelected ? theme.primary : undefined,
        border: isSelected ? theme.primary : theme.borderSubtle,
        fg: isSelected ? theme.background : theme.primary,
        label: "Allow once",
        key: "Y",
      }
    if (key === "always")
      return {
        bg: isSelected ? theme.accent : undefined,
        border: isSelected ? theme.accent : theme.borderSubtle,
        fg: isSelected ? theme.background : theme.accent,
        label: "Allow for session",
        key: "A",
      }
    return {
      bg: isSelected ? theme.error : undefined,
      border: isSelected ? theme.error : theme.borderSubtle,
      fg: isSelected ? theme.background : theme.error,
      label: "Deny",
      key: "N",
    }
  }

  return (
    <box
      flexDirection="column"
      gap={1}
      backgroundColor={theme.backgroundElement}
      borderStyle="round"
      borderColor={props.cardPhase === "sent" ? theme.success : tint(riskColor(), theme.background, 0.3)}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      {/* ── Header ── */}
      <box flexDirection="row" gap={1} alignItems="center" marginBottom={0}>
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

      <box flexDirection="column" border={["left"]} borderColor={theme.borderSubtle} paddingLeft={2} marginLeft={0} marginTop={0}>
        {/* ── Shell command detail ── */}
        <Show when={props.request.permission === "shell" && props.input.command}>
          <box
            paddingLeft={1}
            paddingRight={1}
            paddingTop={0}
            paddingBottom={0}
            backgroundColor={tint(theme.background, theme.textMuted, 0.04)}
            borderStyle="round"
            borderColor={theme.borderSubtle}
            marginBottom={1}
          >
            <text fg={theme.textMuted} wrapMode="word" attributes={TextAttributes.DIM}>
              $ {String(props.input.command)}
            </text>
          </box>
        </Show>

        {/* ── Diff preview for edits ── */}
        <Show when={hasDiff()}>
          <box flexDirection="column" gap={0} marginBottom={1}>
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
            marginBottom={1}
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
            backgroundColor={tint(theme.background, props.lastDecision?.kind === "permission" && props.lastDecision.reply === "reject" ? theme.error : theme.success, 0.08)}
            border={["left"]}
            borderColor={props.lastDecision?.kind === "permission" && props.lastDecision.reply === "reject" ? theme.error : theme.success}
          >
            <text fg={props.lastDecision?.kind === "permission" && props.lastDecision.reply === "reject" ? theme.error : theme.success} attributes={TextAttributes.BOLD}>
              {props.lastDecision?.kind === "permission" && props.lastDecision.reply === "reject" ? "✗" : "✓"}
            </text>
            <text fg={props.lastDecision?.kind === "permission" && props.lastDecision.reply === "reject" ? theme.error : theme.success}>
              {sentPhaseMessage(props.lastDecision)}
            </text>
          </box>
        </Show>

        {/* ════════════════════════════════════════════════════
            PHASE: deciding — main action buttons
            ════════════════════════════════════════════════════ */}
        <Show when={props.cardPhase === "deciding"}>
          {/* Buttons row */}
          <box flexDirection="row" gap={1} flexWrap="wrap" marginBottom={1}>
            <For each={props.buttons}>
              {(key, i) => {
                const s = () => buttonStyle(key, i())
                return (
                  <box
                    backgroundColor={s().bg}
                    paddingLeft={2}
                    paddingRight={2}
                    borderStyle="round"
                    borderColor={s().border}
                    onMouseOver={() => props.onSetSelectedBtn(i())}
                    onMouseUp={() => {
                      props.onSetSelectedBtn(i())
                      if (key === "once") props.onApproveOnce()
                      else if (key === "always") props.onSetPhase("confirming-always")
                      else props.onSetPhase("denying")
                    }}
                    flexDirection="row"
                    gap={1}
                  >
                    <text fg={s().fg} attributes={TextAttributes.BOLD}>{s().key}</text>
                    <text fg={s().fg}>{s().label}</text>
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
            marginBottom={1}
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
              borderStyle="round"
              borderColor={theme.accent}
              onMouseUp={() => props.onApproveAlways()}
            >
              <text fg={theme.background} attributes={TextAttributes.BOLD}>
                Enter Confirm
              </text>
            </box>
            <box
              backgroundColor={theme.backgroundElement}
              paddingLeft={2}
              paddingRight={2}
              borderStyle="round"
              borderColor={theme.borderSubtle}
              onMouseUp={() => props.onSetPhase("deciding")}
            >
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                Esc Cancel
              </text>
            </box>
          </box>
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
            marginBottom={1}
          >
            <text fg={theme.error} attributes={TextAttributes.BOLD}>
              △ Deny — tell DAX what to do differently
            </text>
            <box border={["round"]} borderColor={theme.borderActive} paddingLeft={1} paddingRight={1}>
              <textarea
                ref={props.denyTextareaRef}
                focused
                textColor={theme.text}
                focusedTextColor={theme.text}
                cursorColor={theme.primary}
                keyBindings={props.textareaKeybindings()}
              />
            </box>
          </box>

          <box flexDirection="row" gap={1} flexWrap="wrap">
            <box
              backgroundColor={theme.error}
              paddingLeft={2}
              paddingRight={2}
              borderStyle="round"
              borderColor={theme.error}
              onMouseUp={() => {
                // Mouse confirm: fire deny (textarea value read by keyboard handler in RAOPane)
                // We signal by calling onDeny with empty string — RAOPane reads the ref
                props.onDeny()
              }}
            >
              <text fg={theme.background} attributes={TextAttributes.BOLD}>
                Enter Confirm deny
              </text>
            </box>
            <box
              backgroundColor={theme.backgroundElement}
              paddingLeft={2}
              paddingRight={2}
              borderStyle="round"
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
  onAnswerChange: (value: string) => void
  onSubmit: () => void
  onSkip: () => void
}) {
  const { theme } = useTheme()
  let customTextarea: TextareaRenderable | undefined

  const questions = () => props.request.questions ?? []
  const question = () => questions()[props.store.tab]
  const options = () => question()?.options ?? []
  const allowsCustom = () => question()?.custom !== false
  const customValue = () => props.store.answers[props.store.tab]?.[0] ?? ""
  const single = () => questions().length === 1 && questions()[0]?.multiple !== true

  createEffect(
    on(
      () => [props.store.tab, customValue()],
      () => {
        if (!customTextarea || customTextarea.isDestroyed) return
        customTextarea.setText(customValue())
      },
    ),
  )

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
      <Show when={options().length > 0}>
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
                  if (single() && !allowsCustom()) {
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
      </Show>

      <Show when={allowsCustom()}>
        <box flexDirection="column" gap={0.5} paddingLeft={1}>
          <text fg={theme.textMuted}>
            {options().length > 0 ? "Or type a custom answer" : "Type your answer"}
          </text>
          <box border={["round"]} borderColor={theme.borderSubtle} paddingLeft={1} paddingRight={1}>
            <textarea
              ref={(value: TextareaRenderable) => {
                customTextarea = value
              }}
              minHeight={1}
              maxHeight={4}
              textColor={theme.text}
              focusedTextColor={theme.text}
              cursorColor={theme.primary}
              initialValue={customValue()}
              onChange={(value: string) => props.onAnswerChange(value)}
            />
          </box>
        </box>
      </Show>

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
        <text fg={theme.textMuted}>
          {allowsCustom() ? "Type, then Enter submit · Esc skip" : "↑↓ pick · Enter confirm · click directly"}
        </text>
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
  /**
   * Fires when the queue transitions from non-empty to empty after a
   * decision. The host (session/index.tsx) uses this to gracefully
   * release the pane back to auto-mode so the sidebar doesn't stay
   * pinned on "All clear" forever.
   */
  onAllResolved?: () => void
}) {
  const sdk = useSDK()
  const kv = useKV()
  const { theme } = useTheme()
  const sync = useSync()
  const dialog = useDialog()
  const textareaKeybindings = useTextareaKeybindings()

  // UI-only hold: keeps a just-replied card visible briefly so the user
  // actually sees the confirmation echo even when the server is fast.
  // This is NOT the source of truth for the queue (status="pending" is) —
  // it only delays the visual removal. Declared before items() so the
  // memo can read it on first evaluation without a temporal-dead-zone error.
  const [confirmingIDs, setConfirmingIDs] = createSignal(new Set<string>())

  // The queue renders directly from props.permissions / props.questions.
  // The caller pre-filters to status="pending" via the shared selector
  // (packages/dax/src/dax/presentation/approvals.ts), so resolved items
  // disappear automatically when the server updates the projected run.
  // confirmingIDs (above) re-attaches just-replied items so the
  // sent-phase confirmation stays visible briefly.
  //
  // CRITICAL: this memo MUST return stable RAOItem references when the
  // underlying data hasn't changed. If we returned fresh objects on every
  // evaluation, currentItem() would change reference whenever confirmingIDs
  // changes, which would fire `on(currentItem, ...)` and reset cardPhase
  // back to "deciding" — wiping the "sent" feedback the moment the user
  // clicks. Cache by approval/question id.
  const itemsByID = new Map<string, RAOItem>()
  const items = createMemo<RAOItem[]>(() => {
    const result: RAOItem[] = []
    const seen = new Set<string>()
    props.permissions.forEach((p, i) => {
      const cached = itemsByID.get(p.id)
      const item: RAOItem =
        cached && cached.type === "permission" && cached.data === p && cached.index === i
          ? cached
          : { type: "permission", data: p, index: i }
      itemsByID.set(p.id, item)
      result.push(item)
      seen.add(p.id)
    })
    props.questions.forEach((q, i) => {
      const cached = itemsByID.get(q.id)
      const item: RAOItem =
        cached && cached.type === "question" && cached.data === q && cached.index === i
          ? cached
          : { type: "question", data: q, index: i }
      itemsByID.set(q.id, item)
      result.push(item)
      seen.add(q.id)
    })
    // Re-include any confirming IDs that already left the upstream queue
    // (server flipped status<-pending) so the user keeps seeing the card.
    const holding = confirmingIDs()
    holding.forEach((id) => {
      if (seen.has(id)) return
      const cached = itemsByID.get(id)
      if (cached) result.push(cached)
    })
    // Garbage-collect cache entries that are neither current nor holding.
    for (const id of Array.from(itemsByID.keys())) {
      if (!seen.has(id) && !holding.has(id)) itemsByID.delete(id)
    }
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

  // Auto-close pane when the queue transitions from non-empty to empty.
  // We only fire onAllResolved if the queue had items at some point in
  // this lifetime — that way arriving on the pane with zero items (e.g.
  // user clicked the approvals tab manually) doesn't cause an immediate
  // unwanted close. A 1500ms celebration window gives the user time to
  // see "All clear" before the pane releases back to auto-mode. If a new
  // approval arrives during the window, the timer is cancelled.
  let everHadItems = false
  let resolveTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const len = items().length
    if (len > 0) {
      everHadItems = true
      if (resolveTimer) {
        clearTimeout(resolveTimer)
        resolveTimer = undefined
      }
      return
    }
    if (!everHadItems) return
    if (resolveTimer) return
    resolveTimer = setTimeout(() => {
      resolveTimer = undefined
      // Only fire if still empty when the timer expires
      if (items().length === 0) {
        everHadItems = false
        props.onAllResolved?.()
      }
    }, 1500)
  })

  onCleanup(() => {
    if (resolveTimer) clearTimeout(resolveTimer)
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
  // Echoes the decision the user just made so the sent-phase confirmation
  // can be specific ("Approved once" vs "Approved + always" vs "Denied")
  // instead of generic. Reset when navigating to a new card.
  const [lastDecision, setLastDecision] = createSignal<DecisionEcho | null>(null)
  let denyTextarea: TextareaRenderable | undefined

  createEffect(
    on(currentItem, () => {
      setCardPhase("deciding")
      setSelectedButtonIdx(0)
      setDiffExpanded(false)
      setQuestionSent(false)
      setLastDecision(null)
      const item = currentItem()
      if (item?.type === "question") {
        setQuestionStore({
          tab: 0,
          selected: 0,
          answers: (item.data.questions ?? []).map(() => [] as QuestionAnswer),
        })
      }
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

  function handlePermissionReply(requestID: string, reply: "once" | "always" | "reject", message?: string) {
    setLastDecision({ kind: "permission", reply, message })
    setCardPhase("sent")
    sdk.client.permission.reply({ reply, requestID, message })
    holdConfirmation(requestID)
  }

  function handleQuestionReply(requestID: string, answers: Array<QuestionAnswer>) {
    setLastDecision({ kind: "question", action: "answered" })
    setQuestionSent(true)
    sdk.client.question.reply({ requestID, answers })
    holdConfirmation(requestID)
  }

  function handleQuestionReject(requestID: string) {
    setLastDecision({ kind: "question", action: "rejected" })
    setQuestionSent(true)
    sdk.client.question.reject({ requestID })
    holdConfirmation(requestID)
  }

  // UI-only confirmation hold: keep the just-replied card visible for
  // ~600ms so the user always sees the sent-phase echo even when the
  // server flips status<-pending instantly. After the hold expires, the
  // card naturally falls out of items() because its status is no longer
  // "pending" upstream.
  function holdConfirmation(requestID: string) {
    setConfirmingIDs((prev) => {
      const next = new Set(prev)
      next.add(requestID)
      return next
    })
    setTimeout(() => {
      setConfirmingIDs((prev) => {
        const next = new Set(prev)
        next.delete(requestID)
        return next
      })
    }, 600)
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
      const allowsCustom = currentQ?.custom !== false
      const currentAnswer = questionStore.answers[questionStore.tab]?.[0]?.trim() ?? ""

      if (optCount > 0 && (evt.name === "up" || (evt.ctrl && evt.name === "p"))) {
        evt.preventDefault()
        setQuestionStore("selected", (prev) => Math.max(0, prev - 1))
        return
      }
      if (optCount > 0 && (evt.name === "down" || (evt.ctrl && evt.name === "n"))) {
        evt.preventDefault()
        setQuestionStore("selected", (prev) => Math.min(optCount - 1, prev + 1))
        return
      }
      if (evt.name === "return") {
        evt.preventDefault()
        if (allowsCustom && currentAnswer.length > 0) {
          const answers = [...questionStore.answers]
          answers[questionStore.tab] = [currentAnswer]
          if (qs.length === 1) {
            handleQuestionReply(request.id, answers as Array<QuestionAnswer>)
            return
          }
          setQuestionStore("answers", answers)
          if (questionStore.tab < qs.length - 1) {
            setQuestionStore("tab", questionStore.tab + 1)
            setQuestionStore("selected", 0)
            return
          }
          handleQuestionReply(request.id, answers as Array<QuestionAnswer>)
          return
        }
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
                  lastDecision={lastDecision()}
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
                  onSelectOption={(i) => {
                    setQuestionStore("selected", i)
                    const option = item.data.questions?.[questionStore.tab]?.options?.[i]
                    if (option) {
                      setQuestionStore("answers", questionStore.tab, [option.label])
                    }
                  }}
                  onAnswerChange={(value) => setQuestionStore("answers", questionStore.tab, [value])}
                  onSubmit={() => {
                    const qs = item.data.questions ?? []
                    const answers = qs.map((q, i) => {
                      const typed = questionStore.answers[i]?.[0]?.trim()
                      if (typed && q.custom !== false) return [typed]
                      return questionStore.answers[i] ?? []
                    })
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
