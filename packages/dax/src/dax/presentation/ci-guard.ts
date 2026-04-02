export type RecentToolSignal = {
  tool: string
  status: string
  label: string
  command?: string
  output?: string
}

export type GitHubCINudge = {
  title: string
  detail: string
  tone: "muted" | "warning" | "primary"
  status: "passed" | "failed" | "unknown"
}

function normalize(value?: string) {
  return (value ?? "").toLowerCase()
}

function isReleaseSensitiveCommand(command: string) {
  return /\bgit\s+push\b|\bgh\s+pr\s+create\b|\bgh\s+release\s+create\b|\bnpm\s+publish\b|\bpnpm\s+publish\b|\bcargo\s+publish\b/i.test(
    command,
  )
}

function isCiCheckCommand(command: string) {
  return /\bgh\s+(pr\s+checks|run\s+list|run\s+view|run\s+watch)\b/i.test(command)
}

export function deriveGitHubCINudge(input: {
  recentTools: RecentToolSignal[]
  branch?: string
}) {
  const tools = input.recentTools.filter((item) => item.tool === "shell")
  const latestCheck = tools.find((item) => isCiCheckCommand(item.command ?? ""))
  if (latestCheck?.output) {
    const output = normalize(latestCheck.output)
    if (/\bfail(ed|ure)?\b|\bcancelled\b|\btimed out\b/.test(output)) {
      return {
        title: "GitHub CI reported failures",
        detail: "A recent gh check surfaced failing or cancelled remote checks. Review GitHub CI before trusting the run.",
        tone: "warning" as const,
        status: "failed" as const,
      }
    }
    if (/\bsuccess\b|\bpassed\b|\bcompleted\b/.test(output)) {
      return {
        title: "GitHub CI checked clean",
        detail: "DAX saw a recent gh-based remote check and it looked healthy. Keep trusting receipts and diff review, not CI alone.",
        tone: "primary" as const,
        status: "passed" as const,
      }
    }
    return {
      title: "GitHub CI check was inconclusive",
      detail: "DAX saw a remote check attempt, but the result was not clearly pass or fail. Inspect GitHub CI directly before you trust it.",
      tone: "warning" as const,
      status: "unknown" as const,
    }
  }

  const latestSensitive = tools.find((item) => isReleaseSensitiveCommand(item.command ?? ""))
  if (latestSensitive) {
    return {
      title: "Check GitHub CI now",
      detail:
        "DAX saw recent push, PR, or release-sensitive work but does not have confirmed remote CI evidence yet. Run gh checks or review GitHub CI before treating the change as healthy.",
      tone: "warning" as const,
      status: "unknown" as const,
    }
  }

  return undefined
}
