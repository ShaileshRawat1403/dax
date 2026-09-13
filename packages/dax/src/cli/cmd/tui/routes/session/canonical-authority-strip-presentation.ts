import type { DisplayMode } from "@/dax/presentation/session-display"
import type { CanonicalInspectorState } from "./canonical-inspector-state"

export type CanonicalAuthorityStrip = {
  lifecycle: string
  authority: string
  sequence: number | null
  cursor: string | null
  intent?: string
  pendingApprovals: number
  inspect: boolean
  details?: string
  stale: boolean
  warning: boolean
}

function boundedIntent(intent: string) {
  return intent.length > 120 ? `${intent.slice(0, 117)}…` : intent
}

export function shouldShowCompatibilityHeaderChip(state: CanonicalInspectorState | undefined) {
  return !state || (state.status === "ready" && state.snapshot.kind === "legacy_unsupported")
}

export function presentCanonicalAuthorityStrip(state: CanonicalInspectorState, mode: DisplayMode): CanonicalAuthorityStrip {
  if (state.status === "loading") {
    return { lifecycle: "Canonical status loading", authority: "Awaiting validated authority", sequence: null, cursor: null, pendingApprovals: 0, inspect: true, stale: false, warning: false }
  }
  if (state.status === "unavailable") {
    return { lifecycle: "Canonical status unavailable", authority: "Canonical status unavailable", sequence: null, cursor: null, pendingApprovals: 0, inspect: true, stale: false, warning: true }
  }
  if (state.snapshot.kind === "authority_unreadable") {
    return { lifecycle: "Authority unreadable", authority: "Authority unreadable", sequence: null, cursor: null, pendingApprovals: 0, inspect: true, stale: false, warning: true }
  }
  if (state.snapshot.kind === "legacy_unsupported") {
    if (state.snapshot.reason === "no_canonical_authority") {
      return { lifecycle: "No canonical run yet", authority: "Waiting for execution to start", sequence: null, cursor: null, pendingApprovals: 0, inspect: true, stale: false, warning: false }
    }
    return { lifecycle: "Legacy authority — canonical inspector unsupported", authority: "Legacy authority — canonical inspector unsupported", sequence: null, cursor: null, pendingApprovals: 0, inspect: true, stale: false, warning: true }
  }

  const snapshot = state.snapshot
  const pendingApprovals = state.status === "ready"
    ? snapshot.approvals.filter((approval) => approval.status === "pending").length
    : 0
  const proof = snapshot.completion.genericCompletionProof
  const proofPasses = proof?.decision === "pass" && proof.failedChecks.length === 0 && !snapshot.completion.integrityWarning
  let lifecycle: string
  switch (snapshot.canonicalStatus) {
    case "created":
    case "compiled": lifecycle = "Prepared"; break
    case "queued": lifecycle = "Queued"; break
    case "running": lifecycle = "Running"; break
    case "waiting_approval": lifecycle = pendingApprovals > 0 ? "Waiting for your decision" : "Waiting for approval"; break
    case "completed": lifecycle = proofPasses ? "Completed — proven" : "Completed — proof unavailable"; break
    case "failed": lifecycle = "Failed"; break
    case "cancelled": lifecycle = "Cancelled"; break
  }
  return {
    lifecycle,
    authority: state.status === "stale"
      ? `STALE — last validated canonical state · sequence ${snapshot.authority.eventSequence} · cursor ${snapshot.authority.cursor}`
      : `Authority log validated · sequence ${snapshot.authority.eventSequence} · cursor ${snapshot.authority.cursor}`,
    sequence: snapshot.authority.eventSequence,
    cursor: snapshot.authority.cursor,
    intent: boundedIntent(snapshot.invocationIntent.intent),
    pendingApprovals,
    inspect: true,
    ...(mode === "inspect" ? { details: `Run ${snapshot.runId} · Contract ${snapshot.contract.contractId} · Cursor ${snapshot.authority.cursor}` } : {}),
    stale: state.status === "stale",
    warning: state.status === "stale" || pendingApprovals > 0 || lifecycle === "Failed" || lifecycle === "Cancelled" || lifecycle === "Completed — proof unavailable",
  }
}

/** Formats canonical authority strip into distinct semantic rows, enforcing clean separation at narrow widths. */
export function formatCanonicalAuthorityRows(strip: CanonicalAuthorityStrip, options?: { maxColumns?: number }): string[] {
  const rows: string[] = []

  let lifecycleRow = strip.lifecycle
  if (strip.pendingApprovals > 0) {
    lifecycleRow += ` · Action required: ${strip.pendingApprovals}`
  }
  rows.push(lifecycleRow)

  if (strip.intent) {
    rows.push(`Goal: ${strip.intent}`)
  }

  const maxCols = options?.maxColumns
  if (maxCols && maxCols < 60 && strip.sequence !== null && strip.cursor !== null) {
    const prefix = strip.stale ? "STALE — last validated canonical state" : "Authority log validated"
    const seqCursor = `sequence ${strip.sequence} · cursor ${strip.cursor}`
    if (`${prefix} · ${seqCursor}`.length > maxCols) {
      rows.push(prefix)
      rows.push(seqCursor)
    } else {
      rows.push(strip.authority)
    }
  } else {
    rows.push(strip.authority)
  }

  if (strip.details) {
    rows.push(strip.details)
  }

  return rows
}
