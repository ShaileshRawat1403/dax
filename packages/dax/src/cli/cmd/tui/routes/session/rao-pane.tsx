import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useTheme, selectedForeground, tint } from "../../context/theme"
import type { PermissionRequest, QuestionRequest, QuestionAnswer } from "@dax-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { useSync } from "../../context/sync"
import { SplitBorder } from "../../component/border"
import { useTextareaKeybindings } from "../../component/textarea-keybindings"
import { useDialog } from "../../ui/dialog"
import { parsePolicyProfile, type PolicyProfile } from "@/dax/approval"
import { DAX_SETTING } from "@/dax/settings"
import { useKV } from "../../context/kv"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import { Global } from "@/global"
import { Locale } from "@/util/locale"
import { analyzePackageInstallCommand, analyzePythonInstallCommand } from "../../util/environment"

type PermissionStage = "permission" | "always" | "reject"
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

  if (permission === "bash") {
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

function filetype(input?: string) {
  if (!input) return "none"
  const ext = path.extname(input)
  const language = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

export function RAOPane(props: { permissions: PermissionRequest[]; questions: QuestionRequest[]; sessionID: string }) {
  const sdk = useSDK()
  const kv = useKV()
  const themeState = useTheme()
  const theme = themeState.theme
  const syntax = themeState.syntax
  const sync = useSync()
  const dialog = useDialog()

  const items = createMemo<RAOItem[]>(() => {
    const result: RAOItem[] = []
    props.permissions.forEach((p, i) => result.push({ type: "permission", data: p, index: i }))
    props.questions.forEach((q, i) => result.push({ type: "question", data: q, index: i }))
    return result
  })

  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const currentItem = createMemo(() => items()[selectedIndex()] ?? null)

  const [permissionStage, setPermissionStage] = createStore<Record<string, PermissionStage>>({})
  const [questionStore, setQuestionStore] = createStore({
    tab: 0,
    answers: [] as Array<QuestionAnswer>,
    custom: [] as string[],
    selected: 0,
    editing: false,
  })

  let textarea: TextareaRenderable | undefined

  const profile = createMemo<PolicyProfile>(() => parsePolicyProfile(kv.get(DAX_SETTING.policy_profile, "balanced")))

  function handlePermissionReply(requestID: string, reply: "once" | "always" | "reject", message?: string) {
    sdk.client.permission.reply({
      reply,
      requestID,
      message,
    })
    if (selectedIndex() >= items().length - 1) {
      setSelectedIndex(Math.max(0, items().length - 2))
    }
  }

  function handleQuestionReply(requestID: string, answers: Array<QuestionAnswer>) {
    sdk.client.question.reply({
      requestID,
      answers,
    })
    if (selectedIndex() >= items().length - 1) {
      setSelectedIndex(Math.max(0, items().length - 2))
    }
  }

  function handleQuestionReject(requestID: string) {
    sdk.client.question.reject({
      requestID,
    })
    if (selectedIndex() >= items().length - 1) {
      setSelectedIndex(Math.max(0, items().length - 2))
    }
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    if (items().length === 0) return

    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      setSelectedIndex((prev) => Math.max(0, prev - 1))
      return
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      setSelectedIndex((prev) => Math.min(items().length - 1, prev + 1))
      return
    }

    const item = currentItem()
    if (!item) return

    if (item.type === "permission") {
      const stage = permissionStage[item.data.id] ?? "permission"
      if (stage === "permission") {
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
    }
  })

  return (
    <box flexDirection="column" gap={0} flexGrow={1}>
      <Show when={items().length === 0}>
        <box flexDirection="column" gap={1} padding={1}>
          <text fg={theme.success}>All clear</text>
          <text fg={theme.textMuted}>No pending approvals or questions</text>
        </box>
      </Show>

      <Show when={items().length > 0}>
        <box flexDirection="row" gap={1} alignItems="center" paddingBottom={1}>
          <text fg={theme.warning} attributes={1}>
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
              >
                <text fg={theme.textMuted}>↑</text>
              </box>
              <box
                onMouseUp={() => setSelectedIndex(Math.min(items().length - 1, selectedIndex() + 1))}
                paddingLeft={1}
                paddingRight={1}
              >
                <text fg={theme.textMuted}>↓</text>
              </box>
            </box>
          </Show>
        </box>

        <box flexDirection="column" gap={1} flexGrow={1}>
          <For each={items()}>
            {(item, idx) => (
              <Show when={idx() === selectedIndex()}>
                <Switch>
                  <Match when={item.type === "permission"}>
                    {(() => {
                      const request = (item as RAOItem & { type: "permission" }).data
                      const input = createMemo(() => {
                        const tool = request.tool
                        if (!tool) return {}
                        const parts = sync.data.part[tool.messageID] ?? []
                        for (const part of parts) {
                          if (part.type === "tool" && part.callID === tool.callID && part.state.status !== "pending") {
                            return part.state.input ?? {}
                          }
                        }
                        return {}
                      })

                      const risk = createMemo(() => classifyPermissionRisk(request, input(), profile()))
                      const elevated = createMemo(() => risk().level !== "normal")
                      const stage = () => permissionStage[request.id] ?? "permission"

                      const icon = createMemo(() => {
                        const perm = request.permission
                        if (perm === "bash") return "#"
                        if (perm === "edit") return "✎"
                        if (perm === "read") return "→"
                        if (perm === "glob" || perm === "grep") return "✱"
                        if (perm === "webfetch") return "%"
                        if (perm === "websearch") return "◈"
                        if (perm === "codesearch") return "◇"
                        if (perm === "task") return "◉"
                        return "⚙"
                      })

                      const title = createMemo(() => {
                        const perm = request.permission
                        const i = input()
                        if (perm === "bash") return (i.description as string) ?? "Run command"
                        if (perm === "edit") return `Edit ${normalizePath(request.metadata?.filepath as string)}`
                        if (perm === "read") return `Read ${normalizePath(i.filePath as string)}`
                        if (perm === "glob") return `Glob "${i.pattern ?? ""}"`
                        if (perm === "grep") return `Grep "${i.pattern ?? ""}"`
                        if (perm === "list") return `List ${normalizePath(i.path as string)}`
                        if (perm === "webfetch") return `Fetch ${i.url ?? ""}`
                        if (perm === "websearch" || perm === "codesearch") return `Search "${i.query ?? ""}"`
                        if (perm === "task") return `${i.subagent_type ?? "Task"}: ${i.description ?? ""}`
                        return perm
                      })

                      return (
                        <box
                          flexDirection="column"
                          gap={1}
                          backgroundColor={
                            risk().level === "critical"
                              ? tint(theme.background, theme.error, 0.1)
                              : risk().level === "privacy"
                                ? tint(theme.background, theme.warning, 0.1)
                                : theme.backgroundElement
                          }
                          border={["top", "right", "bottom", "left"]}
                          borderColor={
                            risk().level === "critical"
                              ? theme.error
                              : risk().level === "privacy"
                                ? theme.warning
                                : theme.border
                          }
                          paddingLeft={1}
                          paddingRight={1}
                          paddingTop={1}
                          paddingBottom={1}
                        >
                          <box flexDirection="row" gap={1} alignItems="center">
                            <text
                              fg={
                                risk().level === "critical"
                                  ? theme.error
                                  : risk().level === "privacy"
                                    ? theme.warning
                                    : theme.accent
                              }
                            >
                              {icon()}
                            </text>
                            <text fg={theme.text} attributes={1}>
                              {title()}
                            </text>
                          </box>

                          <Show when={request.permission === "bash" && input().command}>
                            <box paddingLeft={2}>
                              <text fg={theme.textMuted}>{String(input().command)}</text>
                            </box>
                          </Show>

                          <Show when={risk().level !== "normal"}>
                            <box paddingLeft={1}>
                              <text fg={risk().level === "critical" ? theme.error : theme.warning}>
                                {risk().reason}
                              </text>
                              <Show when={risk().suggestion}>
                                <text fg={theme.textMuted}>Suggestion: {risk().suggestion}</text>
                              </Show>
                            </box>
                          </Show>

                          <box flexDirection="row" gap={1} paddingTop={1}>
                            <box
                              backgroundColor={theme.primary}
                              paddingLeft={1}
                              paddingRight={1}
                              onMouseUp={() => handlePermissionReply(request.id, "once")}
                            >
                              <text fg={selectedForeground(theme, theme.primary)}>[Y] Allow</text>
                            </box>
                            <Show when={request.always && request.always.length > 0}>
                              <box
                                backgroundColor={theme.accent}
                                paddingLeft={1}
                                paddingRight={1}
                                onMouseUp={() => handlePermissionReply(request.id, "always")}
                              >
                                <text fg={selectedForeground(theme, theme.accent)}>[A] Always</text>
                              </box>
                            </Show>
                            <box
                              backgroundColor={theme.error}
                              paddingLeft={1}
                              paddingRight={1}
                              onMouseUp={() => handlePermissionReply(request.id, "reject")}
                            >
                              <text fg={selectedForeground(theme, theme.error)}>[N] Deny</text>
                            </box>
                          </box>
                        </box>
                      )
                    })()}
                  </Match>

                  <Match when={item.type === "question"}>
                    {(() => {
                      const request = (item as RAOItem & { type: "question" }).data
                      const questions = createMemo(() => request.questions ?? [])
                      const question = createMemo(() => questions()[questionStore.tab])
                      const options = createMemo(() => question()?.options ?? [])
                      const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)

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
                          <text fg={theme.accent} attributes={1}>
                            Question
                          </text>

                          <Show when={questions().length > 1}>
                            <box flexDirection="row" gap={1}>
                              <For each={questions()}>
                                {(q, i) => (
                                  <box
                                    backgroundColor={questionStore.tab === i() ? theme.accent : undefined}
                                    paddingLeft={1}
                                    paddingRight={1}
                                    onMouseUp={() => setQuestionStore("tab", i())}
                                  >
                                    <text
                                      fg={
                                        questionStore.tab === i()
                                          ? selectedForeground(theme, theme.accent)
                                          : theme.textMuted
                                      }
                                    >
                                      {i() + 1}
                                    </text>
                                  </box>
                                )}
                              </For>
                            </box>
                          </Show>

                          <text fg={theme.text}>{question()?.question}</text>

                          <box flexDirection="column" gap={0} paddingLeft={1}>
                            <For each={options()}>
                              {(opt, i) => (
                                <box
                                  flexDirection="row"
                                  gap={1}
                                  backgroundColor={questionStore.selected === i() ? theme.backgroundPanel : undefined}
                                  onMouseUp={() => {
                                    if (single()) {
                                      handleQuestionReply(request.id, [[opt.label]])
                                    } else {
                                      const answers = [...questionStore.answers]
                                      answers[questionStore.tab] = [opt.label]
                                      setQuestionStore("answers", answers)
                                      if (questionStore.tab < questions().length - 1) {
                                        setQuestionStore("tab", questionStore.tab + 1)
                                      }
                                    }
                                  }}
                                >
                                  <text fg={questionStore.selected === i() ? theme.accent : theme.textMuted}>
                                    {questionStore.selected === i() ? "▸" : " "}
                                  </text>
                                  <text fg={theme.text}>{opt.label}</text>
                                </box>
                              )}
                            </For>
                          </box>

                          <box flexDirection="row" gap={1} paddingTop={1}>
                            <box
                              backgroundColor={theme.primary}
                              paddingLeft={1}
                              paddingRight={1}
                              onMouseUp={() => {
                                const qs = request.questions ?? []
                                const answers = qs.map((_, i) => questionStore.answers[i] ?? [])
                                handleQuestionReply(request.id, answers as unknown as Array<QuestionAnswer>)
                              }}
                            >
                              <text fg={selectedForeground(theme, theme.primary)}>[Enter] Submit</text>
                            </box>
                            <box
                              backgroundColor={theme.error}
                              paddingLeft={1}
                              paddingRight={1}
                              onMouseUp={() => handleQuestionReject(request.id)}
                            >
                              <text fg={selectedForeground(theme, theme.error)}>[Esc] Skip</text>
                            </box>
                          </box>
                        </box>
                      )
                    })()}
                  </Match>
                </Switch>
              </Show>
            )}
          </For>
        </box>

        <Show when={items().length > 1}>
          <box
            flexDirection="column"
            gap={0}
            border={["top"]}
            borderColor={theme.borderSubtle}
            paddingTop={1}
            marginTop={1}
          >
            <text fg={theme.textMuted}>Queue:</text>
            <For each={items()}>
              {(item, idx) => (
                <box
                  flexDirection="row"
                  gap={1}
                  backgroundColor={idx() === selectedIndex() ? theme.backgroundElement : undefined}
                  onMouseUp={() => setSelectedIndex(idx())}
                >
                  <text fg={idx() === selectedIndex() ? theme.accent : theme.textMuted}>
                    {idx() === selectedIndex() ? "▸" : " "}
                  </text>
                  <text fg={idx() === selectedIndex() ? theme.text : theme.textMuted}>
                    {item.type === "permission" ? item.data.permission : "question"}
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>
      </Show>
    </box>
  )
}
