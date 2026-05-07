import { createResource, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import {
  deriveSandboxDisplay,
  sandboxFilesystemLabel,
  sandboxNetworkLabel,
  sandboxProcessLabel,
  type SandboxStatusResponse,
} from "@/dax/presentation/sandbox-status"

export function RuntimePane() {
  const { theme } = useTheme()
  const sdk = useSDK()

  const [sandboxStatus] = createResource<SandboxStatusResponse>(async () => {
    const res = await sdk.fetch(`${sdk.url}/sandbox/status`)
    if (!res.ok) throw new Error(`sandbox/status ${res.status}`)
    return res.json() as Promise<SandboxStatusResponse>
  })

  const display = () => deriveSandboxDisplay(sandboxStatus())

  return (
    <box flexDirection="column" width="100%" height="100%" gap={1}>
      <box flexDirection="column" gap={0} paddingBottom={1} border={["bottom"]} borderColor={theme.borderSubtle}>
        <text fg={theme.primary} bold>
          Runtime
        </text>
        <text fg={theme.textMuted}>Execution environment and sandbox status</text>
      </box>

      <SandboxSection display={display()} loading={sandboxStatus.loading} />

      <JobsSection />
    </box>
  )
}

function SandboxSection(props: {
  display: ReturnType<typeof deriveSandboxDisplay>
  loading: boolean
}) {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={0}>
      <text fg={theme.primary} bold>
        Sandbox
      </text>
      <Show
        when={!props.loading}
        fallback={<text fg={theme.textMuted}>Checking sandbox…</text>}
      >
        <Show
          when={props.display.enabled}
          fallback={
            <box flexDirection="column" gap={0} paddingTop={1}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.warning}>○</text>
                <text fg={theme.text}>Disabled</text>
              </box>
              <text fg={theme.textMuted}>Commands are running on the host system.</text>
              <text fg={theme.textMuted}>Approval gates still apply.</text>
            </box>
          }
        >
          <box
            flexDirection="column"
            gap={0}
            paddingTop={1}
            paddingLeft={1}
            paddingRight={1}
            paddingBottom={1}
            border={["round"]}
            borderColor={theme.borderSubtle}
            marginTop={1}
          >
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.textMuted}>Status</text>
              <box flexDirection="row" gap={1}>
                <text fg={theme.success}>●</text>
                <text fg={theme.success}>Active</text>
              </box>
            </box>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.textMuted}>Provider</text>
              <text fg={theme.text}>{props.display.provider}</text>
            </box>
            <Show when={props.display.hasCapability}>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Filesystem</text>
                <text fg={theme.text}>{sandboxFilesystemLabel(props.display.filesystem)}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Network</text>
                <text fg={theme.text}>{sandboxNetworkLabel(props.display.network)}</text>
              </box>
              <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.textMuted}>Process</text>
                <text fg={theme.text}>{sandboxProcessLabel(props.display.process)}</text>
              </box>
            </Show>
          </box>
        </Show>
      </Show>
    </box>
  )
}

function JobsSection() {
  const { theme } = useTheme()

  return (
    <box flexDirection="column" gap={0} paddingTop={1} border={["top"]} borderColor={theme.borderSubtle}>
      <text fg={theme.primary} bold>
        Background Jobs
      </text>
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={theme.textMuted}>No background jobs running.</text>
        <text fg={theme.textMuted}>Long-running processes started by DAX will appear here.</text>
      </box>
    </box>
  )
}
