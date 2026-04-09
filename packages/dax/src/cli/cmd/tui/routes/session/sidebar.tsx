import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, For, onCleanup, onMount, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme, tint } from "../../context/theme"
import { TextAttributes } from "@opentui/core"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { useLocal } from "../../context/local"
import { TodoItem } from "../../component/todo-item"
import { DAX_SETTING, sessionWorkflowModeKey } from "@/dax/settings"
import { nextActionForErrorMessage } from "@/dax/status"
import { SESSION_COMMAND_LABELS } from "@/dax/session-shell"
import { shouldShowSidebarSection, type DisplayMode } from "@/dax/presentation/session-display"
import { deriveWorkstationState, type WorkstationState } from "@/dax/presentation/workstation"
import { deriveAuditHistory, deriveLiveSessionStageState } from "@/dax/presentation/session-surface"
import { Locale } from "@/util/locale"
import { ReflectionPanel } from "../../component/reflection"

function TelemetryPanel(props: { state: WorkstationState }) {
  const { theme } = useTheme()

  const postureColor = () => {
    switch (props.state.trustPosture) {
      case "clear":
        return theme.success
      case "review_needed":
        return theme.warning
      case "blocked":
        return theme.error
      default:
        return theme.text
    }
  }

  return (
    <box flexDirection="column" gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>Trust Posture</text>
        <text fg={postureColor()}>
          <b>{props.state.trustLabel.toUpperCase()}</b>
        </text>
      </box>

      <box flexDirection="column" gap={0} paddingLeft={1} borderStyle="round" borderColor={theme.backgroundElement}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.textMuted}>Writes</text>
          <text fg={theme.text}>{props.state.artifactSummary.workspaceWrites}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.textMuted}>Reports</text>
          <text fg={theme.text}>{props.state.artifactSummary.reports}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.textMuted}>Metadata</text>
          <text fg={theme.text}>{props.state.artifactSummary.metadata}</text>
        </box>
      </box>

      <Show when={props.state.activitySummary.items.length > 0}>
        <box flexDirection="column" gap={0} marginTop={1}>
          <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
            ACTIVITY LOG
          </text>
          <For each={props.state.activitySummary.items.slice(-3)}>
            {(item) => (
              <text fg={theme.textMuted} dim wrapMode="word">
                • {item}
              </text>
            )}
          </For>
        </box>
      </Show>

      <Show when={props.state.auditSummary.findingsCount > 0}>
        <box flexDirection="row" gap={1} flexWrap="wrap">
          <Show when={props.state.auditSummary.blockerCount > 0}>
            <text fg={theme.error}>! {props.state.auditSummary.blockerCount} Blocker</text>
          </Show>
          <Show when={props.state.auditSummary.warningCount > 0}>
            <text fg={theme.warning}>? {props.state.auditSummary.warningCount} Warning</text>
          </Show>
        </box>
      </Show>

      <box marginTop={1} paddingTop={1} borderStyle="single" borderTop borderColor={theme.backgroundElement}>
        <text fg={theme.textMuted} dim>
          ID: {props.state.sessionID.slice(0, 8)}...
        </text>
      </box>
    </box>
  )
}

function SidebarAction(props: { label: string; onPress?: () => void; muted?: boolean; hint?: string }) {
  const { theme } = useTheme()
  return (
    <Show when={props.onPress}>
      <box
        onMouseUp={() => props.onPress?.()}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.backgroundElement}
        border={["round"]}
        borderColor={theme.borderSubtle}
        flexDirection="row"
        gap={1}
      >
        <text fg={props.muted ? theme.textMuted : theme.primary}>› {props.label}</text>
        <Show when={props.hint}>
          <text fg={theme.textMuted}>{props.hint}</text>
        </Show>
      </box>
    </Show>
  )
}

function SectionHeading(props: { title: string; summary?: string }) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
      <text fg={theme.text}>
        <b>{props.title}</b>
      </text>
      <Show when={props.summary}>
        <text fg={theme.textMuted}>{props.summary}</text>
      </Show>
    </box>
  )
}

function SidebarCard(props: { children: any }) {
  const { theme } = useTheme()
  return (
    <box
      backgroundColor={theme.backgroundElement}
      border={["round"]}
      borderColor={theme.borderSubtle}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="column" gap={1}>
        {props.children}
      </box>
    </box>
  )
}

export function Sidebar(props: {
  sessionID: string
  displayMode: DisplayMode
  overlay?: boolean
  onInspectApprovals?: () => void
  onInspectDiff?: () => void
  onInspectMcp?: () => void
  onOpenPm?: () => void
  onOpenTimeline?: () => void
  onJumpLive?: () => void
  onJumpLastUser?: () => void
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const permissions = createMemo(() => sync.data.permission[props.sessionID] ?? [])
  const questions = createMemo(() => sync.data.question[props.sessionID] ?? [])
  const runtimeStatus = createMemo(() => sync.data.session_status[props.sessionID] ?? { type: "idle" as const })
  const retryMessage = createMemo(() => {
    const status = runtimeStatus()
    return status.type === "retry" ? status.message : undefined
  })
  const delayedMessage = createMemo(() => {
    const status = runtimeStatus()
    return status.type === "delayed" ? status.message : undefined
  })
  const [retryNow, setRetryNow] = createSignal(Date.now())
  onMount(() => {
    const timer = setInterval(() => setRetryNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const retryCountdown = createMemo(() => {
    const status = runtimeStatus()
    if (status.type !== "retry") return undefined
    return Math.max(0, status.next - retryNow())
  })

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
  })

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const incompleteTodoCount = createMemo(() => todo().filter((item) => item.status !== "completed").length)
  const userTurnCount = createMemo(() => messages().filter((item) => item.role === "user").length)

  const directory = useDirectory()
  const kv = useKV()
  const local = useLocal()
  const workflowMode = createMemo(() => kv.get(sessionWorkflowModeKey(props.sessionID), local.agent.current().name))
  const showSection = (section: Parameters<typeof shouldShowSidebarSection>[0]["section"]) =>
    shouldShowSidebarSection({
      displayMode: props.displayMode,
      section,
    })
  const pending = createMemo(() => messages().findLast((x) => x.role === "assistant" && !x.time.completed)?.id)
  const messageText = (messageID: string) =>
    (sync.data.part[messageID] ?? [])
      .filter(
        (part): part is Extract<(typeof sync.data.part)[string][number], { type: "text" }> =>
          part.type === "text" && !part.synthetic,
      )
      .map((part) => part.text)
      .join("")
      .trim()

  const auditHistory = createMemo(() =>
    deriveAuditHistory({
      messages: messages(),
      messageText,
    }),
  )
  const latestAudit = createMemo(() => auditHistory().findLast((entry) => entry.result !== undefined))

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "dax" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  const workstationState = createMemo(() => {
    const s = session()
    const audit = latestAudit()?.result
    const art = (sync.data as any).session_artifact?.[props.sessionID] ?? []
    const stage = deriveLiveSessionStageState({
      permissionsCount: permissions().length,
      questionsCount: questions().length,
      sessionStatusType: runtimeStatus().type as any,
      pendingID: pending(),
      partsForMessage: (messageID) => sync.data.part[messageID] ?? [],
    })

    return deriveWorkstationState({
      sessionID: props.sessionID,
      stage: stage.stage,
      stageReason: stage.reason,
      sessionStatusType: runtimeStatus().type as any,
      goal: s?.title,
      todo: todo().map((t) => ({ content: t.content, status: t.status })),
      reflection: (s?.state_v2 as any)?.reflection,
      reflectionHistory: (s?.state_v2 as any)?.reflection_history ?? [],
      approvals: permissions().map((p) => ({ label: p.permission, reason: p.metadata?.reason as string | undefined })),
      questions: questions().length,
      artifacts: art.map((a: any) => ({ label: a.path || a.id, kind: a.kind })),
      diffCount: diff().length,
      audit: audit
        ? {
            status: audit.status,
            blockerCount: audit.summary.blocker_count,
            warningCount: audit.summary.warning_count,
            infoCount: audit.summary.info_count,
          }
        : undefined,
    })
  })

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={1} paddingRight={1}>
            <SidebarCard>
              <box paddingRight={1}>
                <text fg={theme.text}>
                  <b>{session().title}</b>
                </text>
                <Show when={session().share?.url}>
                  <text fg={theme.textMuted}>{session().share!.url}</text>
                </Show>
              </box>
            </SidebarCard>

            <Show when={showSection("reflection") && workstationState().reflection}>
              <SidebarCard>
                <ReflectionPanel
                  reflection={workstationState().reflection}
                  history={workstationState().reflectionHistory}
                />
              </SidebarCard>
            </Show>

            <Show when={showSection("telemetry")}>
              <SidebarCard>
                <TelemetryPanel state={workstationState()} />
              </SidebarCard>
            </Show>

            <Show when={showSection("artifacts") && workstationState().artifactSummary.count > 0}>
              <SidebarCard>
                <box flexDirection="column" gap={1}>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    Artifacts
                  </text>
                  <box flexDirection="row" gap={1} flexWrap="wrap">
                    <Show when={workstationState().artifactSummary.workspaceWrites > 0}>
                      <box
                        flexDirection="row"
                        gap={1}
                        backgroundColor={tint(theme.background, theme.primary, 0.15)}
                        border={["round"]}
                        borderColor={theme.primary}
                        paddingLeft={1}
                        paddingRight={1}
                      >
                        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                          {workstationState().artifactSummary.workspaceWrites} File
                          {workstationState().artifactSummary.workspaceWrites === 1 ? "" : "s"}
                        </text>
                      </box>
                    </Show>
                    <Show when={workstationState().artifactSummary.reports > 0}>
                      <box
                        flexDirection="row"
                        gap={1}
                        backgroundColor={tint(theme.background, theme.secondary, 0.15)}
                        border={["round"]}
                        borderColor={theme.secondary}
                        paddingLeft={1}
                        paddingRight={1}
                      >
                        <text fg={theme.secondary} attributes={TextAttributes.BOLD}>
                          {workstationState().artifactSummary.reports} Report
                          {workstationState().artifactSummary.reports === 1 ? "" : "s"}
                        </text>
                      </box>
                    </Show>
                    <Show when={workstationState().artifactSummary.metadata > 0}>
                      <box
                        flexDirection="row"
                        gap={1}
                        backgroundColor={tint(theme.background, theme.textMuted, 0.1)}
                        border={["round"]}
                        borderColor={theme.borderSubtle}
                        paddingLeft={1}
                        paddingRight={1}
                      >
                        <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                          {workstationState().artifactSummary.metadata} Meta
                        </text>
                      </box>
                    </Show>
                  </box>
                  <Show when={workstationState().artifactSummary.items.length > 0}>
                    <box flexDirection="column" gap={0} paddingLeft={1}>
                      <For each={workstationState().artifactSummary.items.slice(-5)}>
                        {(artifact) => (
                          <text fg={theme.textMuted} wrapMode="word" dim>
                            • {artifact.label}
                          </text>
                        )}
                      </For>
                    </box>
                  </Show>
                </box>
              </SidebarCard>
            </Show>

            <Show when={showSection("runtime")}>
              <SidebarCard>
                <text fg={theme.text}>
                  <b>Runtime</b>
                </text>
                <text
                  fg={
                    runtimeStatus().type === "retry" || runtimeStatus().type === "delayed"
                      ? theme.warning
                      : theme.textMuted
                  }
                >
                  {runtimeStatus().type === "busy"
                    ? "working"
                    : runtimeStatus().type === "retry"
                      ? "cooling down"
                      : runtimeStatus().type === "delayed"
                        ? "provider delayed"
                        : "connected"}
                </text>
                <Show when={retryMessage()}>
                  {(message) => (
                    <>
                      <text fg={theme.warning} wrapMode="word">
                        {message()}
                      </text>
                      <Show when={retryCountdown()}>
                        {(ms) => (
                          <text fg={theme.textMuted} wrapMode="word">
                            retry in: {Locale.duration(ms())}
                          </text>
                        )}
                      </Show>
                      <text fg={theme.textMuted} wrapMode="word">
                        next: {nextActionForErrorMessage(message())}
                      </text>
                    </>
                  )}
                </Show>
                <Show when={delayedMessage()}>
                  {(message) => (
                    <text fg={theme.warning} wrapMode="word">
                      {message()}
                    </text>
                  )}
                </Show>
                <Show when={permissions().length > 0 || questions().length > 0}>
                  <text fg={theme.warning}>
                    {permissions().length > 0
                      ? `${permissions().length} approval${permissions().length === 1 ? "" : "s"}`
                      : ""}
                    {permissions().length > 0 && questions().length > 0 ? " · " : ""}
                    {questions().length > 0
                      ? `${questions().length} question${questions().length === 1 ? "" : "s"}`
                      : ""}
                  </text>
                </Show>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <Show when={permissions().length > 0 || questions().length > 0}>
                    <SidebarAction label={SESSION_COMMAND_LABELS.reviewApprovals} onPress={props.onInspectApprovals} />
                  </Show>
                  <Show when={diff().length > 0}>
                    <SidebarAction label={SESSION_COMMAND_LABELS.reviewDiff} onPress={props.onInspectDiff} />
                  </Show>
                  <SidebarAction label={SESSION_COMMAND_LABELS.jumpTimeline} onPress={props.onOpenTimeline} muted />
                  <SidebarAction label={SESSION_COMMAND_LABELS.jumpLastRequest} onPress={props.onJumpLastUser} muted />
                  <Show
                    when={
                      runtimeStatus().type === "busy" ||
                      runtimeStatus().type === "retry" ||
                      runtimeStatus().type === "delayed"
                    }
                  >
                    <SidebarAction label={SESSION_COMMAND_LABELS.jumpLive} onPress={props.onJumpLive} muted />
                  </Show>
                  <SidebarAction label={SESSION_COMMAND_LABELS.openPm} onPress={props.onOpenPm} muted />
                </box>
              </SidebarCard>
            </Show>
            <box flexShrink={0} border={["top"]} borderColor={theme.borderSubtle} marginTop={1} marginBottom={1} />
            <Show when={showSection("todo") && todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <SidebarCard>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <SectionHeading
                    title="Todo"
                    summary={incompleteTodoCount() > 0 ? `${incompleteTodoCount()} open` : undefined}
                  />
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                </Show>
              </SidebarCard>
            </Show>
            <box flexShrink={0} border={["top"]} borderColor={theme.borderSubtle} marginTop={1} marginBottom={1} />
            <Show when={showSection("diff") && diff().length > 0}>
              <SidebarCard>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <Show when={diff().length > 2}>
                    <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                  </Show>
                  <SectionHeading title="Modified Files" summary={`${diff().length} changed`} />
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      return (
                        <box
                          flexDirection="row"
                          gap={1}
                          justifyContent="space-between"
                          onMouseUp={() => props.onInspectDiff?.()}
                        >
                          <text fg={theme.textMuted} wrapMode="none">
                            {item.file}
                          </text>
                          <box flexDirection="row" gap={1} flexShrink={0}>
                            <Show when={item.additions}>
                              <text fg={theme.diffAdded}>+{item.additions}</text>
                            </Show>
                            <Show when={item.deletions}>
                              <text fg={theme.diffRemoved}>-{item.deletions}</text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </SidebarCard>
            </Show>
            <box flexShrink={0} border={["top"]} borderColor={theme.borderSubtle} marginTop={1} marginBottom={1} />
            <Show when={showSection("audit")}>
              <SidebarCard>
                <SectionHeading title="Session" />
                <box flexDirection="row" gap={1} flexWrap="wrap" marginTop={1}>
                  <text fg={theme.primary}>{workflowMode()}</text>
                  <text fg={theme.textMuted}>·</text>
                  <text fg={theme.textMuted}>{userTurnCount()} turns</text>
                  <Show when={permissions().length + questions().length > 0}>
                    <>
                      <text fg={theme.textMuted}>·</text>
                      <text fg={theme.warning}>{permissions().length + questions().length} waiting</text>
                    </>
                  </Show>
                  <Show when={incompleteTodoCount() > 0}>
                    <>
                      <text fg={theme.textMuted}>·</text>
                      <text fg={theme.textMuted}>{incompleteTodoCount()} todos</text>
                    </>
                  </Show>
                </box>
                <Show when={latestAudit()}>
                  {(audit) => (
                    <box flexDirection="row" gap={1} marginTop={1}>
                      <text fg={theme.textMuted}>audit</text>
                      <text fg={theme.text}>{audit().result?.status}</text>
                      <Show when={audit().commandText !== "/audit"}>
                        <text fg={theme.textMuted}>({audit().commandText})</text>
                      </Show>
                    </box>
                  )}
                </Show>
              </SidebarCard>
            </Show>
            <box flexShrink={0} border={["top"]} borderColor={theme.borderSubtle} marginTop={1} marginBottom={1} />
            <Show when={showSection("mcp") && mcpEntries().length > 0}>
              <SidebarCard>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <Show when={mcpEntries().length > 2}>
                    <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                  </Show>
                  <SectionHeading
                    title="MCP"
                    summary={
                      !expanded.mcp
                        ? `${connectedMcpCount()} active${errorMcpCount() > 0 ? `, ${errorMcpCount()} error${errorMcpCount() > 1 ? "s" : ""}` : ""}`
                        : undefined
                    }
                  />
                </box>
                <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                  <For each={mcpEntries()}>
                    {([key, item]) => (
                      <box flexDirection="row" gap={1} onMouseUp={() => props.onInspectMcp?.()}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: (
                              {
                                connected: theme.success,
                                failed: theme.error,
                                disabled: theme.textMuted,
                                needs_auth: theme.warning,
                                needs_client_registration: theme.error,
                              } as Record<string, typeof theme.success>
                            )[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {key}{" "}
                          <span style={{ fg: theme.textMuted }}>
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>Connected</Match>
                              <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                              <Match when={item.status === "disabled"}>Disabled</Match>
                              <Match when={(item.status as string) === "needs_auth"}>Needs auth</Match>
                              <Match when={(item.status as string) === "needs_client_registration"}>
                                Needs client ID
                              </Match>
                            </Switch>
                          </span>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <SidebarAction label={SESSION_COMMAND_LABELS.inspectMcp} onPress={props.onInspectMcp} muted />
                </box>
              </SidebarCard>
            </Show>
            <box flexShrink={0} border={["top"]} borderColor={theme.borderSubtle} marginTop={1} marginBottom={1} />
            <Show when={showSection("lsp")}>
              <SidebarCard>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
                >
                  <Show when={sync.data.lsp.length > 2}>
                    <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                  </Show>
                  <SectionHeading title="LSP" />
                </box>
                <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                  <Show when={sync.data.lsp.length === 0}>
                    <text fg={theme.textMuted}>
                      {sync.data.config.lsp === false
                        ? "LSPs have been disabled in settings"
                        : "LSPs will activate as files are read"}
                    </text>
                  </Show>
                  <For each={sync.data.lsp}>
                    {(item) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: {
                              connected: theme.success,
                              error: theme.error,
                            }[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.textMuted}>
                          {item.id} {item.root}
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </SidebarCard>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                ⬖
              </text>
              <box flexGrow={1} gap={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text}>
                    <b>Getting started</b>
                  </text>
                  <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                    ✕
                  </text>
                </box>
                <text fg={theme.textMuted}>Connect a provider subscription to start.</text>
                <text fg={theme.textMuted}>
                  Recommended: OpenAI/Codex, Gemini, Anthropic, Ollama. Advanced providers are also available.
                </text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme.text}>Connect provider</text>
                  <text fg={theme.textMuted}>/connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text>
            <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>DAX</b> <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
