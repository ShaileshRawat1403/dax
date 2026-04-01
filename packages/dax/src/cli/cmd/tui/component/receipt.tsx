import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"

export interface VerificationReceiptProps {
  action: string
  target?: string
  checks: Array<{
    label: string
    status: "pass" | "warn" | "fail" | "pending"
  }>
  status: "verified" | "failed" | "running"
  confidence?: number
}

export function VerificationReceipt(props: VerificationReceiptProps) {
  const { theme } = useTheme()

  const statusColor = () => {
    switch (props.status) {
      case "verified": return theme.success
      case "failed": return theme.error
      case "running": return theme.primary
      default: return theme.textMuted
    }
  }

  const checkIcon = (status: string) => {
    switch (status) {
      case "pass": return "✓"
      case "warn": return "!"
      case "fail": return "✗"
      case "pending": return "○"
      default: return "•"
    }
  }

  const checkColor = (status: string) => {
    switch (status) {
      case "pass": return theme.success
      case "warn": return theme.warning
      case "fail": return theme.error
      case "pending": return theme.primary
      default: return theme.textMuted
    }
  }

  return (
    <box
      flexDirection="column"
      gap={0}
      padding={1}
      backgroundColor={theme.backgroundElement}
      border={["round"]}
      borderColor={theme.borderSubtle}
      marginTop={1}
      marginBottom={1}
    >
      <box flexDirection="row" justifyContent="space-between" alignItems="center" marginBottom={1}>
        <box flexDirection="row" gap={1} alignItems="center">
          <text fg={statusColor()} attributes={TextAttributes.BOLD}>
            {props.status.toUpperCase()}
          </text>
          <text fg={theme.textMuted}>|</text>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.action}
          </text>
        </box>
        <Show when={props.confidence !== undefined}>
          <text fg={theme.textMuted}>{Math.round(props.confidence! * 100)}% certainty</text>
        </Show>
      </box>

      <Show when={props.target}>
        <box marginBottom={1}>
          <text fg={theme.textMuted}>Target: </text>
          <text fg={theme.primary}>{props.target}</text>
        </box>
      </Show>

      <box flexDirection="column" gap={0}>
        <For each={props.checks}>
          {(check) => (
            <box flexDirection="row" gap={1}>
              <text fg={checkColor(check.status)}>{checkIcon(check.status)}</text>
              <text fg={theme.text}>{check.label}</text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
