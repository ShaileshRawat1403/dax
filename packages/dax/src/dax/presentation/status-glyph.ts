/**
 * One glyph per state, defined once.
 *
 * The interface had grown four dot glyphs (`·` `•` `●` `○`), two crosses
 * (`✗` `×`) and two ellipses (`⋯` `…`) with no distinction between them, and
 * the same state was marked differently depending on scope: a completed step
 * showed `·` while a completed run showed `✓`. A reader cannot learn a
 * vocabulary that has four words for one idea, so there is now exactly one.
 */
export type StreamStatus = "pending" | "active" | "completed" | "failed" | "skipped"

export const STATUS_GLYPH: Record<StreamStatus, string> = {
  pending: "○",
  active: "◆",
  completed: "✓",
  failed: "✗",
  skipped: "–",
}

/** Semantic theme key for a status, so colour and glyph cannot drift apart. */
export const STATUS_TONE: Record<StreamStatus, "success" | "error" | "primary" | "textMuted"> = {
  pending: "textMuted",
  active: "primary",
  completed: "success",
  failed: "error",
  skipped: "textMuted",
}

export function statusGlyph(status: StreamStatus | undefined): string {
  return STATUS_GLYPH[status ?? "pending"]
}

/**
 * Approval outcomes.
 *
 * A separate vocabulary from run status, but they share ✓ and ✗ on purpose:
 * approved and completed both mean "this went through", and a reader should not
 * have to learn two marks for that. Defined here so the overlap stays deliberate.
 */
export type DecisionOutcome = "approve" | "deny" | "expired" | "cancelled" | "resolved"

export const DECISION_GLYPH: Record<DecisionOutcome, string> = {
  approve: STATUS_GLYPH.completed,
  deny: STATUS_GLYPH.failed,
  expired: "◷",
  cancelled: "⊘",
  resolved: STATUS_GLYPH.skipped,
}

export function decisionGlyph(decision: string | undefined): string {
  return DECISION_GLYPH[(decision ?? "resolved") as DecisionOutcome] ?? DECISION_GLYPH.resolved
}
