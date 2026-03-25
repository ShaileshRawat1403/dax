import { Log } from "@/util/log"
import { getProjectedRunState } from "@/state/events/run-event-store"
import { isEventAuthorityRun } from "@/state/events/event-transitions"
import type { RunState } from "@/state/events/run-reducer"

const log = Log.create({ service: "recovery" })

export type RecoveryAction = "remain_paused" | "resume" | "retry" | "immutable" | "invalid"

export interface RecoveryDecision {
  action: RecoveryAction
  status: string
  reason: string
  incompleteStepId: string | null
  pendingApprovalIds: string[]
}

export function evaluateRecovery(state: RunState): RecoveryDecision {
  const base: Omit<RecoveryDecision, "action" | "reason"> = {
    status: state.status,
    incompleteStepId: state.currentStepId,
    pendingApprovalIds: state.pendingApprovalIds,
  }

  switch (state.status) {
    case "waiting_approval":
      return {
        ...base,
        action: "remain_paused",
        reason: "Run is waiting for approval - requires explicit resolution",
      }

    case "completed":
      return {
        ...base,
        action: "immutable",
        reason: "Run is completed - no recovery action needed",
      }

    case "failed":
      return {
        ...base,
        action: "immutable",
        reason: "Run has failed - explicit retry required",
      }

    case "cancelled":
      return {
        ...base,
        action: "immutable",
        reason: "Run is cancelled - immutable terminal state",
      }

    case "running": {
      if (state.currentStepId) {
        return {
          ...base,
          action: "resume",
          reason: `Run has incomplete step ${state.currentStepId} - can resume`,
        }
      }
      return {
        ...base,
        action: "resume",
        reason: "Run is in running state with no incomplete step - can resume",
      }
    }

    case "queued":
      return {
        ...base,
        action: "retry",
        reason: "Run is queued but not started - can retry",
      }

    case "compiled":
      return {
        ...base,
        action: "retry",
        reason: "Run is compiled but not started - can retry",
      }

    default:
      return {
        ...base,
        action: "invalid",
        reason: `Unknown run status: ${state.status}`,
      }
  }
}

export async function evaluateRunRecovery(runId: string): Promise<RecoveryDecision | null> {
  if (!(await isEventAuthorityRun(runId))) {
    log.debug("not an event-authority run, skipping recovery evaluation", { runId })
    return null
  }

  const state = await getProjectedRunState(runId)
  if (!state) {
    log.warn("no state found for recovery evaluation", { runId })
    return null
  }

  const decision = evaluateRecovery(state)
  log.info("recovery decision", { runId, ...decision })
  return decision
}
