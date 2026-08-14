/**
 * Human-readable label for a run's terminal reason. The run overview already
 * records why a run ended (WorkflowTerminalReason), but the home screen only
 * showed the bare status ("failed"). This turns the recorded reason into a
 * short phrase a non-developer can act on, so the "why" lives where the failure
 * is shown instead of only inside the session's evidence ledger.
 *
 * Typed as string (not the enum) to keep this presentation helper decoupled
 * from the server run-contract; an unrecognized reason returns undefined rather
 * than inventing a label.
 */
const TERMINAL_REASON_LABELS: Readonly<Record<string, string>> = {
  workflow_completed: "Completed",
  workflow_signed_off: "Signed off",
  workflow_failed: "Failed",
  workflow_rejected: "Rejected in review",
  workflow_expired: "Expired",
  workflow_cancelled: "Cancelled",
  execution_error: "Execution error",
  permission_denied: "Permission denied",
  timeout: "Timed out",
  contract_mutation: "Contract changed mid-run",
}

export function humanTerminalReason(reason?: string): string | undefined {
  if (!reason) return undefined
  return TERMINAL_REASON_LABELS[reason]
}
