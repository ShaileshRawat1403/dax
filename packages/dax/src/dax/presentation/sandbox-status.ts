import type { SandboxCapability } from "@/shell/sandbox/types"

export type SandboxDisplayStatus = {
  enabled: boolean
  provider: string
  filesystem: string
  network: string
  process: string
  /** Single-line label for compact display */
  statusLine: string
  /** Whether any capability data is available */
  hasCapability: boolean
}

export type SandboxStatusResponse = {
  enabled: boolean
  provider: string
  capability: SandboxCapability | null
}

export function deriveSandboxDisplay(status: SandboxStatusResponse | undefined): SandboxDisplayStatus {
  if (!status || !status.enabled) {
    return {
      enabled: false,
      provider: "none",
      filesystem: "—",
      network: "—",
      process: "—",
      statusLine: "Disabled — commands run on the host system",
      hasCapability: false,
    }
  }

  const cap = status.capability
  const filesystem = cap?.filesystem ?? "—"
  const network = cap?.network ?? "—"
  const process = cap?.process ?? "—"

  return {
    enabled: true,
    provider: status.provider,
    filesystem,
    network,
    process,
    statusLine: `${status.provider} · ${filesystem} fs · ${network} network`,
    hasCapability: cap !== null,
  }
}

export function sandboxFilesystemLabel(value: string): string {
  switch (value) {
    case "strict":
      return "Strict (deny all)"
    case "read-only":
      return "Read-only"
    case "write":
      return "Read-write"
    case "none":
      return "None"
    default:
      return value
  }
}

export function sandboxNetworkLabel(value: string): string {
  switch (value) {
    case "none":
      return "Blocked"
    case "localhost-only":
      return "Localhost only"
    case "full":
      return "Full access"
    default:
      return value
  }
}

export function sandboxProcessLabel(value: string): string {
  switch (value) {
    case "isolated":
      return "Isolated"
    case "none":
      return "No isolation"
    default:
      return value
  }
}
