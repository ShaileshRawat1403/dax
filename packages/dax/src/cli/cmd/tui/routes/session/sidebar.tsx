import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { useLocal } from "../../context/local"
import { TodoItem } from "../../component/todo-item"
import { DAX_SETTING } from "@/dax/settings"
import { nextActionForErrorMessage } from "@/dax/status"
import { SESSION_COMMAND_LABELS } from "@/dax/session-shell"

function SidebarAction(props: { label: string; onPress?: () => void; muted?: boolean; hint?: string }) {
  const { theme } = useTheme()
  return (
    <Show when={props.onPress}>
      <box
        onMouseUp={() => props.onPress?.()}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.backgroundElement}
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
    <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
      <box flexDirection="column" gap={1}>
        {props.children}
      </box>
    </box>
  )
}

export function Sidebar(props: {
  sessionID: string
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
  const workflowMode = createMemo(() => kv.get(DAX_SETTING.session_workflow_mode, local.agent.current().name))

  const latestAudit = createMemo(() => {
    const messageList = messages()
    for (let i = messageList.length - 1; i >= 0; i--) {
      const message = messageList[i]
      if (message.role !== "user") continue
      const parts = sync.data.part[message.id] ?? []
      const commandText = parts
        .filter(
          (part): part is Extract<(typeof parts)[number], { type: "text" }> => part.type === "text" && !part.synthetic,
        )
        .map((part) => part.text)
        .join("")
        .trim()
      const isAuditTurn = message.agent === "audit" || commandText.startsWith("/audit")
      if (!isAuditTurn) continue
      const auditLabel = commandText || "audit"
      const response = messageList.findLast(
        (candidate) => candidate.role === "assistant" && candidate.parentID === message.id,
      )
      if (!response) return { command: auditLabel, status: "queued" as const }
      const responseText = (sync.data.part[response.id] ?? [])
        .filter(
          (part): part is Extract<(typeof parts)[number], { type: "text" }> => part.type === "text" && !part.synthetic,
        )
        .map((part) => part.text)
        .join("")
        .trim()
      const fenced = responseText.match(/```json\s*([\s\S]*?)```/i)?.[1]
      const candidate = fenced ?? responseText
      try {
        const parsed = JSON.parse(candidate) as { status?: string }
        if (parsed?.status) return { command: auditLabel, status: parsed.status }
      } catch {}
      return { command: auditLabel, status: "done" as const }
    }
    return undefined
  })

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "dax" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

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
            <SidebarCard>
              <text fg={theme.text}>
                <b>Runtime</b>
              </text>
              <text fg={runtimeStatus().type === "retry" ? theme.warning : theme.textMuted}>
                {runtimeStatus().type === "busy"
                  ? "waiting"
                  : runtimeStatus().type === "retry"
                    ? "blocked"
                    : "connected"}
              </text>
              <Show when={retryMessage()}>
                {(message) => (
                  <>
                    <text fg={theme.warning} wrapMode="word">
                      {message()}
                    </text>
                    <text fg={theme.textMuted} wrapMode="word">
                      next: {nextActionForErrorMessage(message())}
                    </text>
                  </>
                )}
              </Show>
              <Show when={permissions().length > 0 || questions().length > 0}>
                <text fg={theme.warning}>
                  {permissions().length > 0
                    ? `${permissions().length} approval${permissions().length === 1 ? "" : "s"}`
                    : ""}
                  {permissions().length > 0 && questions().length > 0 ? " · " : ""}
                  {questions().length > 0 ? `${questions().length} question${questions().length === 1 ? "" : "s"}` : ""}
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
                <Show when={runtimeStatus().type === "busy" || runtimeStatus().type === "retry"}>
                  <SidebarAction label={SESSION_COMMAND_LABELS.jumpLive} onPress={props.onJumpLive} muted />
                </Show>
                <SidebarAction label={SESSION_COMMAND_LABELS.openPm} onPress={props.onOpenPm} muted />
              </box>
            </SidebarCard>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
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
            <Show when={diff().length > 0}>
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
                    <text fg={theme.text}>{audit().status}</text>
                    <Show when={audit().command !== "/audit"}>
                      <text fg={theme.textMuted}>({audit().command})</text>
                    </Show>
                  </box>
                )}
              </Show>
            </SidebarCard>
            <Show when={mcpEntries().length > 0}>
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
