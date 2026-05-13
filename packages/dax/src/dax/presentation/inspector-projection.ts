// DAX UI Interaction Contract v0.1 — inspector projection helpers.
// See docs/dax/ui-interaction-contract.md Section 6.
//
// Pure helpers that translate InspectorProjection into the two decisions a
// surface needs to render the inspector pane:
//
//   1. Should the pane auto-open right now?
//   2. If so, which pane mode is required?
//
// These helpers exist so the session route does not independently decide
// whether DAX requires attention. When InspectorProjection.state is
// non-closed, the pane MUST open and MUST show the required mode.

import type { InspectorProjection } from "./ui-state-resolver"
import type { PaneMode } from "./pane"

export function isInspectorAutoOpenRequired(inspector: InspectorProjection): boolean {
  return inspector.state !== "closed"
}

// v0.1 has no dedicated safety pane. Safety/auth projections route to
// "approvals" as the existing operator-decision surface. A future safety
// pane may replace this mapping when a safety producer lands.
export function requiredPaneModeForInspector(inspector: InspectorProjection): PaneMode | null {
  switch (inspector.state) {
    case "approval_card":
    case "question_card":
    case "safety_block":
    case "auth_required":
      return "approvals"
    case "closed":
      return null
  }
}
