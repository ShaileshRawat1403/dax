import { useTheme } from "@tui/context/theme"
import { For, createSignal, onMount, onCleanup, Show } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"

export function AuditPane() {
  const { theme } = useTheme()
  const sdk = useSDK()
  const kv = useKV()
  const [logs, setLogs] = createSignal<{ time: string; type: string; msg: string }[]>([])

  onMount(() => {
    const unsub = sdk.event.on("*" as any, (evt: any) => {
      // Segregate background noise ("token refreshed", plugin loads) into this pane
      if (evt.type.startsWith("system.") || evt.type.includes("auth.token") || evt.type.includes("plugin.load")) {
        setLogs((prev) => {
          const newLogs = [
            ...prev,
            {
              time: new Date().toLocaleTimeString(),
              type: evt.type,
              msg: evt.properties?.message || JSON.stringify(evt.properties || {}),
            },
          ]
          return newLogs.length > 100 ? newLogs.slice(newLogs.length - 100) : newLogs
        })
      }
    })
    onCleanup(() => unsub())
  })

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      paddingLeft={1}
      paddingRight={1}
      border={["all"]}
      borderColor={theme.accent}
    >
      <box
        flexDirection="row"
        border={["bottom"]}
        borderColor={theme.border}
        paddingBottom={1}
        marginBottom={1}
        gap={2}
      >
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "plan")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>❖ Plan</text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "artifacts")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>📦 Artifacts</text>
        </box>
        <box border={["bottom"]} borderColor={theme.accent} paddingLeft={1} paddingRight={1}>
          <text fg={theme.primary} bold>
            🛡️ Audit
          </text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "refine")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>✦ Refine</text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "approvals")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>⚠ Approvals</text>
        </box>
      </box>
      <Show when={logs().length === 0}>
        <text fg={theme.textMuted}>:: buffer empty</text>
      </Show>
      <For each={logs()}>
        {(log) => (
          <text fg={theme.textMuted}>
            [{log.time}] {log.type}: {log.msg}
          </text>
        )}
      </For>
    </box>
  )
}
