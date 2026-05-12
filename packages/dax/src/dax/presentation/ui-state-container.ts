// DAX UI Interaction Contract v0.1 — container helper.
// See docs/dax/ui-interaction-contract.md.
//
// Single call site that bridges the producer (WorkstationState) and the
// resolver (resolveUIState). The container does not recompute lifecycle;
// lifecycle is consumed verbatim from WorkstationState. The container exists
// because WorkstationState.approvalSummary.pendingCount aggregates approvals
// and questions, so the approval/question split must be passed separately
// from the session-container source that produced the WorkstationState.

import type { WorkstationState } from "./workstation"
import {
  resolveUIState,
  type EnvironmentHealth,
  type FocusState,
  type ResolvedUISurface,
  type SafetyState,
} from "./ui-state-resolver"
import { workstationToActiveUIState } from "./ui-state-mapper"

export type UIStateContainerInput = {
  workstation: WorkstationState
  // Actionable approvals only (status === "pending"), distinct from questions.
  actionableApprovals: number
  // Open operator questions, distinct from approvals.
  questions: number
  environment: EnvironmentHealth
  safety: SafetyState[]
  focus: FocusState
  now: number
  previous: ResolvedUISurface | null
  // Forward-looking run-state hints; see ui-state-mapper.ts.
  compacting?: boolean
  resuming?: boolean
}

export function resolveWorkstationUIState(input: UIStateContainerInput): ResolvedUISurface {
  const active = workstationToActiveUIState({
    lifecycle: input.workstation.lifecycle,
    actionableApprovals: input.actionableApprovals,
    questions: input.questions,
    environment: input.environment,
    safety: input.safety,
    focus: input.focus,
    compacting: input.compacting,
    resuming: input.resuming,
  })
  return resolveUIState(active, input.now, input.previous)
}
