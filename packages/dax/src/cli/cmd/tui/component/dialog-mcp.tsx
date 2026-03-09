import { createMemo, createResource, createSignal, For, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useLocal } from "@tui/context/local"
import { useSync } from "@tui/context/sync"
import { useTheme } from "../context/theme"
import { useSDK } from "@tui/context/sdk"
import { useDialog } from "@tui/ui/dialog"
import { TextAttributes } from "@opentui/core"
import { labelProductState, nextActionForMcpStatus, productStateIcon, type ProductState } from "@/dax/status"
import type { McpInspect, McpStatus } from "@dax-ai/sdk/v2"

function describeStatus(name: string, status: McpStatus): { state: ProductState; label: string; next: string } {
  switch (status.status) {
    case "connected":
      return { state: "connected", label: "connected", next: nextActionForMcpStatus(name, status) }
    case "needs_auth":
      return { state: "blocked", label: "blocked", next: nextActionForMcpStatus(name, status) }
    case "needs_client_registration":
      return { state: "blocked", label: "blocked", next: nextActionForMcpStatus(name, status) }
    case "failed":
      return { state: "failed", label: "failed", next: nextActionForMcpStatus(name, status) }
    case "disabled":
      return { state: "waiting", label: "waiting", next: nextActionForMcpStatus(name, status) }
  }
}

function accent(theme: any, state: ProductState) {
  switch (state) {
    case "connected":
      return theme.success
    case "waiting":
      return theme.textMuted
    case "blocked":
    case "needs_approval":
      return theme.warning
    case "failed":
      return theme.error
  }
}

export function DialogMcp() {
  const dialog = useDialog()
  const local = useLocal()
  const sync = useSync()
  const sdk = useSDK()
  const { theme } = useTheme()
  const [loading, setLoading] = createSignal<string | null>(null)

  const names = createMemo(() => Object.keys(sync.data.mcp).sort((a, b) => a.localeCompare(b)))
  const [selected, setSelected] = createSignal(0)
  const currentName = createMemo(() => names()[selected()] ?? names()[0])
  const currentStatus = createMemo(() => {
    const name = currentName()
    if (!name) return undefined
    return sync.data.mcp[name]
  })

  const [inspect, actions] = createResource(currentName, async (name) => {
    if (!name) return undefined
    const result = await sdk.client.mcp.inspect({ name }).catch(() => undefined)
    return result?.data
  })

  async function refreshStatus() {
    const status = await sdk.client.mcp.status().catch(() => undefined)
    if (status?.data) {
      sync.set("mcp", status.data)
    }
    await actions.refetch()
  }

  async function toggleCurrent() {
    const name = currentName()
    if (!name || loading()) return
    setLoading(name)
    try {
      await local.mcp.toggle(name)
      await refreshStatus()
    } finally {
      setLoading(null)
    }
  }

  function move(delta: number) {
    const items = names()
    if (items.length === 0) return
    let next = selected() + delta
    if (next < 0) next = items.length - 1
    if (next >= items.length) next = 0
    setSelected(next)
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      evt.preventDefault()
      move(-1)
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      evt.preventDefault()
      move(1)
    }
    if (evt.name === "space") {
      evt.preventDefault()
      toggleCurrent().catch(() => {})
    }
    if (evt.name === "r" && !evt.ctrl && !evt.meta) {
      evt.preventDefault()
      refreshStatus().catch(() => {})
    }
  })

  onMount(() => {
    dialog.setSize("large")
  })

  const currentInfo = createMemo(() => {
    const status = currentStatus()
    const name = currentName()
    if (!status || !name) return undefined
    return describeStatus(name, status)
  })

  const detail = createMemo(() => inspect() as McpInspect | undefined)
  const detailSummary = createMemo(() => {
    const value = detail()
    if (!value) return undefined
    return {
      topTools: value.tools.slice(0, 4),
      topResources: value.resources.slice(0, 3),
      topPrompts: value.prompts.slice(0, 3),
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          MCP cockpit
        </text>
        <text fg={theme.textMuted}>up/down move • space toggle • r refresh • esc close</text>
      </box>

      <Show when={names().length > 0} fallback={<text fg={theme.textMuted}>No MCP servers configured.</text>}>
        <box flexDirection="row" gap={2} height={18}>
          <box width={22} flexDirection="column" gap={0}>
            <For each={names()}>
              {(name, index) => {
                const status = () => sync.data.mcp[name]
                const selectedRow = () => selected() === index()
                const info = () => describeStatus(name, status())
                return (
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={selectedRow() ? theme.primary : undefined}
                    onMouseUp={() => setSelected(index())}
                  >
                    <text fg={selectedRow() ? theme.selectedListItemText : accent(theme, info().state)}>
                      {productStateIcon(info().state)} {name}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>

          <box width={54} flexDirection="column" gap={1}>
            <Show when={currentName() && currentInfo()}>
              <box flexDirection="column" gap={1} backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text}>
                    <b>{currentName()}</b>
                  </text>
                  <text fg={accent(theme, currentInfo()!.state)}>
                    {labelProductState(currentInfo()!.state)}
                    <Show when={loading() === currentName()}> {" · working"}</Show>
                  </text>
                </box>
                <box flexDirection="row" gap={2} flexWrap="wrap">
                  <text fg={theme.textMuted}>{detail()?.tools.length ?? 0} tools</text>
                  <text fg={theme.textMuted}>{detail()?.resources.length ?? 0} resources</text>
                  <text fg={theme.textMuted}>{detail()?.prompts.length ?? 0} prompts</text>
                </box>
                <text fg={theme.textMuted} wrapMode="word">
                  {currentInfo()!.next}
                </text>
              </box>

              <Show when={inspect.loading}>
                <text fg={theme.textMuted}>Loading inspect data…</text>
              </Show>

              <Show when={!inspect.loading && detailSummary()}>
                <box flexDirection="column" gap={1}>
                  <box flexDirection="column" gap={0}>
                    <text fg={theme.text}>Top tools</text>
                    <For each={detailSummary()!.topTools}>
                      {(tool) => <text fg={theme.textMuted}>  - {tool.name}</text>}
                    </For>
                    <Show when={detail()!.tools.length > detailSummary()!.topTools.length}>
                      <text fg={theme.textMuted}>  + {detail()!.tools.length - detailSummary()!.topTools.length} more</text>
                    </Show>
                  </box>

                  <Show when={detailSummary()!.topResources.length > 0}>
                    <box flexDirection="column" gap={0}>
                      <text fg={theme.text}>Top resources</text>
                      <For each={detailSummary()!.topResources}>
                        {(resource) => <text fg={theme.textMuted}>  - {resource.name}</text>}
                      </For>
                      <Show when={detail()!.resources.length > detailSummary()!.topResources.length}>
                        <text fg={theme.textMuted}>
                          {"  + "}
                          {detail()!.resources.length - detailSummary()!.topResources.length} more
                        </text>
                      </Show>
                    </box>
                  </Show>

                  <Show when={detailSummary()!.topPrompts.length > 0}>
                    <box flexDirection="column" gap={0}>
                      <text fg={theme.text}>Top prompts</text>
                      <For each={detailSummary()!.topPrompts}>
                        {(prompt) => <text fg={theme.textMuted}>  - {prompt.name}</text>}
                      </For>
                      <Show when={detail()!.prompts.length > detailSummary()!.topPrompts.length}>
                        <text fg={theme.textMuted}>  + {detail()!.prompts.length - detailSummary()!.topPrompts.length} more</text>
                      </Show>
                    </box>
                  </Show>

                  <box flexDirection="row" gap={1} flexWrap="wrap">
                    <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1} onMouseUp={() => toggleCurrent().catch(() => {})}>
                      <text fg={theme.text}>{currentStatus()?.status === "disabled" ? "Enable server" : "Refresh / toggle"}</text>
                    </box>
                    <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
                      <text fg={theme.textMuted}>CLI: dax mcp inspect {currentName()}</text>
                    </box>
                  </box>
                </box>
              </Show>
            </Show>
          </box>
        </box>
      </Show>

      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>{"Inspect one server here, then use `dax mcp inspect <server>` for full CLI output."}</text>
        <text fg={theme.textMuted}>MCP is an optional first-class capability in DAX.</text>
      </box>
    </box>
  )
}
