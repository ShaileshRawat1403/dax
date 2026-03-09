import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage } from "@dax-ai/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"
import { SESSION_COMMAND_LABELS, SESSION_SHELL_ROLES } from "@/dax/session-shell"

function SidebarAction(props: { label: string; onPress: () => void; muted?: boolean; hint?: string }) {
  const { theme } = useTheme()
  return (
    <box onMouseUp={props.onPress} paddingRight={1} flexDirection="row" gap={1}>
      <text fg={props.muted ? theme.textMuted : theme.primary}>{props.label}</text>
      <Show when={props.hint}>
        <text fg={theme.textMuted}>{props.hint}</text>
      </Show>
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
  onNavigateMessage?: (direction: "prev" | "next") => void
  onJumpLastUser?: () => void
  timelineHint?: string
  prevHint?: string
  nextHint?: string
  lastUserHint?: string
  commandHint?: string
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])
  const runtimeStatus = createMemo(() => sync.data.session_status[props.sessionID] ?? { type: "idle" as const })
  const approvalCount = createMemo(() => (sync.data.permission[props.sessionID] ?? []).length)
  const questionCount = createMemo(() => (sync.data.question[props.sessionID] ?? []).length)
  const retryMessage = createMemo(() => {
    const status = runtimeStatus()
    if (status.type !== "retry") return undefined
    return status.message
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

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()
  const kv = useKV()

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
            <box paddingRight={1}>
              <text fg={theme.text}>
                <b>{session().title}</b>
              </text>
              <Show when={session().share?.url}>
                <text fg={theme.textMuted}>{session().share!.url}</text>
              </Show>
            </box>
            <box>
              <text fg={theme.text}>
                <b>Runtime</b>
              </text>
              <text fg={theme.textMuted}>
                {runtimeStatus().type === "busy"
                  ? "waiting"
                  : runtimeStatus().type === "retry"
                    ? "blocked"
                    : "connected"}
              </text>
              <Show when={runtimeStatus().type === "retry"}>
                <text fg={theme.warning}>{retryMessage()}</text>
              </Show>
              <Show when={approvalCount() > 0 || questionCount() > 0}>
                <text fg={theme.warning}>
                  {approvalCount() > 0 ? `${approvalCount()} needs approval` : ""}
                  {approvalCount() > 0 && questionCount() > 0 ? " · " : ""}
                  {questionCount() > 0 ? `${questionCount()} blocked by question` : ""}
                </text>
              </Show>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <Show when={approvalCount() > 0 || questionCount() > 0}>
                  <SidebarAction
                    label={SESSION_COMMAND_LABELS.reviewApprovals.toLowerCase()}
                    onPress={() => props.onInspectApprovals?.()}
                    hint={props.commandHint}
                  />
                </Show>
                <Show when={runtimeStatus().type === "busy" || runtimeStatus().type === "retry"}>
                  <SidebarAction label={SESSION_COMMAND_LABELS.jumpLive.toLowerCase()} onPress={() => props.onJumpLive?.()} />
                </Show>
                <SidebarAction label={SESSION_COMMAND_LABELS.jumpTimeline.toLowerCase()} onPress={() => props.onOpenTimeline?.()} muted hint={props.timelineHint} />
              </box>
            </box>
            <box>
              <text fg={theme.text}>
                <b>Context usage</b>
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={theme.textMuted}>{context()?.tokens ?? 0} tokens</text>
                <Show when={context()}>
                  {(c) => {
                    const p = c().percentage
                    if (p === null) return <></>
                    const filled = Math.floor(p / 10)
                    const empty = 10 - filled
                    return (
                      <text fg={p > 80 ? theme.error : theme.accent}>
                        [{"■".repeat(filled)}{" ".repeat(empty)}] {p}%
                      </text>
                    )
                  }}
                </Show>
              </box>
              <text fg={theme.textMuted}>{cost()} spent</text>
            </box>
            <Show when={mcpEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <Show when={mcpEntries().length > 2}>
                    <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                  </Show>
                  <box flexDirection="row" gap={1} flexWrap="wrap">
                    <text fg={theme.text}>
                      <b>MCP</b>
                    </text>
                    <Show when={!expanded.mcp}>
                      <text fg={theme.textMuted}>
                        ({connectedMcpCount()} active
                        {errorMcpCount() > 0 ? `, ${errorMcpCount()} error${errorMcpCount() > 1 ? "s" : ""}` : ""})
                      </text>
                    </Show>
                  </box>
                </box>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <SidebarAction label={SESSION_COMMAND_LABELS.inspectMcp} onPress={() => props.onInspectMcp?.()} hint={props.commandHint} />
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
                        <box flexDirection="column">
                          <text fg={theme.text} wrapMode="word">
                            {key}
                          </text>
                          <text fg={theme.textMuted} wrapMode="word">
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>connected</Match>
                              <Match when={item.status === "failed" && item}>{(val) => val().error}</Match>
                              <Match when={item.status === "disabled"}>waiting</Match>
                              <Match when={(item.status as string) === "needs_auth"}>blocked: needs auth</Match>
                              <Match when={(item.status as string) === "needs_client_registration"}>
                                blocked: needs client ID
                              </Match>
                            </Switch>
                          </text>
                        </box>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <Show when={sync.data.lsp.length > 2}>
                  <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>LSP</b>
                </text>
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
            </box>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Todo</b>
                  </text>
                </box>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <SidebarAction label="open plan" onPress={() => props.onOpenPm?.()} hint={props.commandHint} />
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>
                    {(todo) => (
                      <box onMouseUp={() => props.onOpenPm?.()}>
                        <TodoItem status={todo.status} content={todo.content} />
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <Show when={diff().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <Show when={diff().length > 2}>
                    <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>Modified Files</b>
                  </text>
                </box>
                <box flexDirection="row" gap={1} flexWrap="wrap">
                  <SidebarAction label={SESSION_COMMAND_LABELS.reviewDiff.toLowerCase()} onPress={() => props.onInspectDiff?.()} hint={props.commandHint} />
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between" onMouseUp={() => props.onInspectDiff?.()}>
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
              </box>
            </Show>
            <box>
              <text fg={theme.text}>
                <b>{SESSION_SHELL_ROLES.navigator}</b>
              </text>
              <box flexDirection="row" gap={1} flexWrap="wrap">
                <SidebarAction label={SESSION_COMMAND_LABELS.previous.toLowerCase()} onPress={() => props.onNavigateMessage?.("prev")} muted hint={props.prevHint} />
                <SidebarAction label={SESSION_COMMAND_LABELS.next.toLowerCase()} onPress={() => props.onNavigateMessage?.("next")} muted hint={props.nextHint} />
                <SidebarAction
                  label={SESSION_COMMAND_LABELS.jumpLastRequest.toLowerCase()}
                  onPress={() => props.onJumpLastUser?.()}
                  muted
                  hint={props.lastUserHint}
                />
                <SidebarAction label={SESSION_COMMAND_LABELS.jumpTimeline.toLowerCase()} onPress={() => props.onOpenTimeline?.()} muted hint={props.timelineHint} />
                <SidebarAction label={SESSION_COMMAND_LABELS.jumpLive.toLowerCase()} onPress={() => props.onJumpLive?.()} muted />
              </box>
            </box>
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
          <box flexDirection="row" gap={0}>
            <text fg={theme.textMuted}>{directory().split("/").slice(0, -1).join("/")}/</text>
            <text fg={theme.text}>{directory().split("/").at(-1)}</text>
          </box>
          <box flexDirection="row" gap={1}>
            <text fg={theme.success}>•</text>
            <text fg={theme.textMuted}>
              <b>DAX</b>
            </text>
            <text fg={theme.textMuted}>{Installation.VERSION}</text>
          </box>
        </box>
      </box>
    </Show>
  )
}
