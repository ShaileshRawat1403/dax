import { useTheme } from "@tui/context/theme"
import { For, Show, createSignal, onMount, onCleanup } from "solid-js"
import { useKV } from "../../context/kv"
import { DAX_SETTING } from "@/dax/settings"
import { useSDK } from "@tui/context/sdk"

export type ArtifactItem = {
  path: string
  type: "created" | "modified" | "deleted" | "read"
}

export function ArtifactsPane(props: { artifacts?: ArtifactItem[] }) {
  const { theme } = useTheme()
  const kv = useKV()
  const sdk = useSDK()
  const [artifacts, setArtifacts] = createSignal<ArtifactItem[]>([])

  onMount(() => {
    const unsub = sdk.event.on("*", (evt: any) => {
      if (evt.type === "tool.execute.after" || evt.type === "tool.execute.before") {
        const tool = evt.properties?.tool?.name || evt.properties?.tool
        const args = evt.properties?.arguments || evt.properties?.args || {}

        if (tool === "write" || tool === "edit" || tool === "apply_patch" || tool === "write_file") {
          const path = args.file_path || args.path || args.file || "unknown"
          setArtifacts((prev) => {
            if (prev.find((p) => p.path === path)) return prev
            return [...prev, { path, type: tool.includes("write") ? "created" : "modified" }]
          })
        }
      }
    })
    onCleanup(() => unsub())
  })

  const getArtifactIcon = (type: ArtifactItem["type"]) => {
    switch (type) {
      case "created":
        return <text fg={theme.success}>[+]</text>
      case "modified":
        return <text fg={theme.warning}>[~]</text>
      case "deleted":
        return <text fg={theme.error}>[-]</text>
      case "read":
        return <text fg={theme.textMuted}>[r]</text>
      default:
        return <text fg={theme.textMuted}>[*]</text>
    }
  }

  return (
    <box flexDirection="column" width="100%" height="100%" paddingLeft={1} paddingRight={1}>
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
        <box backgroundColor={theme.backgroundElement} paddingLeft={1} paddingRight={1}>
          <text fg={theme.primary} bold>
            📦 Artifacts
          </text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "audit")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>🛡️ Audit</text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "refine")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>✦ Refine</text>
        </box>
        <box onMouseUp={() => kv.set(DAX_SETTING.session_pane_mode, "approvals")} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>⚠ Approvals</text>
        </box>
      </box>

      <Show when={artifacts().length === 0}>
        <text fg={theme.textMuted}>:: state unchanged</text>
      </Show>

      <For each={artifacts()}>
        {(item) => (
          <box flexDirection="row" gap={1} marginBottom={1}>
            {getArtifactIcon(item.type)}
            <text fg={theme.text}>{item.path}</text>
          </box>
        )}
      </For>
    </box>
  )
}
