// DAX UI Interaction Contract v0.1 — debug overlay formatter.
// See docs/dax/ui-interaction-contract.md Section 10.
//
// Pure formatter. Reads resolver output and active state, returns a textual
// overlay. Does not inspect resolver internals; does not log; does not touch
// any rendering layer. UI surfaces that want to display the overlay should
// take the string this returns and render it however they render text.

import type { ActiveUIState, ResolvedUISurface } from "./ui-state-resolver"

function formatEnvironment(active: ActiveUIState): string {
  const { provider, mcp, lsp } = active.environment
  return `{ provider: ${provider}, mcp: ${mcp}, lsp: ${lsp} }`
}

function formatSafety(active: ActiveUIState): string {
  if (active.safety.length === 0) return "[]"
  return `[${active.safety.join(", ")}]`
}

function formatActive(active: ActiveUIState): string {
  return [
    "Active",
    `  run: ${active.run}`,
    `  user: ${active.user ?? "null"}`,
    `  safety: ${formatSafety(active)}`,
    `  environment: ${formatEnvironment(active)}`,
    `  focus: ${active.focus}`,
  ].join("\n")
}

function formatResolved(projection: ResolvedUISurface): string {
  const lines: string[] = [
    "Resolved",
    `  header: ${projection.header.label}`,
    `    winner: ${projection.header.winner}`,
    `    priority: ${projection.header.priority}`,
  ]

  if (projection.header.completedAt !== undefined) {
    lines.push(`    completedAt: ${projection.header.completedAt}`)
  }

  lines.push(`  inspector: ${projection.inspector.state}`)
  if (projection.inspector.openedBy !== undefined) {
    lines.push(`    opened_by: ${projection.inspector.openedBy}`)
  }
  if (projection.inspector.requiresFocusTrap) {
    lines.push(`    focus_trap: true`)
  }

  lines.push(`  footer: ${projection.footer.health}`)
  if (projection.footer.reason !== undefined) {
    lines.push(`    reason: ${projection.footer.reason}`)
  }

  return lines.join("\n")
}

export function formatDebugOverlay(
  active: ActiveUIState,
  projection: ResolvedUISurface,
): string {
  return `${formatActive(active)}\n\n${formatResolved(projection)}`
}
