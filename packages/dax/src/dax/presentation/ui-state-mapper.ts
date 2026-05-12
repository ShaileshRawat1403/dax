// DAX UI Interaction Contract v0.1 — producer mapping layer.
// See docs/dax/ui-interaction-contract.md Section 12 (Compatibility Scope).
//
// Maps the existing WorkstationLifecycle vocabulary (the producer side) to
// ActiveUIState (the resolver input). Pure function; no side effects.
//
// This mapper is intentionally lossy where the producer is more granular
// than the contract (e.g., understanding/planning/executing all collapse to
// run: "working") and intentionally ambiguous where the producer is less
// granular than the contract (e.g., the producer's overloaded "blocked" maps
// to run: "failed"; safety disambiguation must come from upstream signals).

import type { WorkstationLifecycle } from "./workstation"
import type {
  ActiveUIState,
  EnvironmentHealth,
  FocusState,
  RunState,
  SafetyState,
  UserState,
} from "./ui-state-resolver"

export type MapperInput = {
  lifecycle: WorkstationLifecycle
  // Actionable approvals only (status === "pending"), not historical records.
  actionableApprovals: number
  // Open operator questions, distinct from approvals.
  questions: number
  environment: EnvironmentHealth
  // Safety conditions raised by upstream policy/auth signals. The mapper
  // does not infer safety from the producer's overloaded "blocked" lifecycle.
  safety: SafetyState[]
  focus: FocusState
  // Future-state hints for run states the producer does not yet emit.
  // When set, these take precedence over the lifecycle-derived run state.
  compacting?: boolean
  resuming?: boolean
}

function mapLifecycleToRun(lifecycle: WorkstationLifecycle): RunState {
  switch (lifecycle) {
    case "understanding":
    case "planning":
    case "executing":
    case "verifying":
      return "working"
    case "awaiting_approval":
      // Run state is irrelevant when user state wins; pick "working" as the
      // residual background activity. The resolver's ladder ensures the user
      // state is what the header shows.
      return "working"
    case "waiting_for_capacity":
      return "cooling_down"
    case "retrying":
      return "provider_delayed"
    case "blocked":
      // The producer's "blocked" is overloaded. Until producers disambiguate
      // into safety states upstream, treat it as run-level failure. Callers
      // that have richer signals (e.g., policy engine, auth state) should
      // populate input.safety directly.
      return "failed"
    case "failed":
      return "failed"
    case "completed":
      return "complete"
    case "ready":
      return "ready"
  }
}

function mapUserState(input: MapperInput): UserState | null {
  if (input.lifecycle !== "awaiting_approval") return null
  if (input.actionableApprovals > 0) return "waiting_for_approval"
  if (input.questions > 0) return "waiting_for_answer"
  return null
}

export function workstationToActiveUIState(input: MapperInput): ActiveUIState {
  const lifecycleRun = mapLifecycleToRun(input.lifecycle)

  // Future-state hints override the lifecycle-derived run state. Compaction
  // outranks resumption because compaction is what triggers a context-swap;
  // resumption follows. Neither outranks "failed" or the awaiting_approval
  // residual — those signal stronger conditions and should propagate as-is.
  let run: RunState = lifecycleRun
  if (lifecycleRun !== "failed" && input.lifecycle !== "awaiting_approval") {
    if (input.compacting) run = "compacting"
    else if (input.resuming) run = "resuming"
  }

  return {
    run,
    user: mapUserState(input),
    environment: input.environment,
    safety: input.safety,
    focus: input.focus,
  }
}
