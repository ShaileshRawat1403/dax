import { Log } from "@/util/log"
import { getProjectedRunState } from "@/state/events/run-event-store"
import { isEventAuthorityRun, transitionEventAuthority } from "@/state/events/event-transitions"
import {
  evaluateRecovery,
  evaluateRunRecovery,
  type RecoveryDecision,
  type RecoveryAction,
} from "@/state/events/recovery"
import type { RunState } from "@/state/events/run-reducer"

const log = Log.create({ service: "runtime-recovery" })

export interface RecoveryResult {
  success: boolean
  action: RecoveryAction
  previousStatus: string
  newStatus: string | null
  runId: string
  message: string
  error?: string
}

export async function recoverRun(runId: string): Promise<RecoveryResult> {
  const decision = await evaluateRunRecovery(runId)

  if (!decision) {
    log.warn("cannot recover run - not found or not event-authority", { runId })
    return {
      success: false,
      action: "invalid",
      previousStatus: "unknown",
      newStatus: null,
      runId,
      message: "Run not found or not event-authority",
    }
  }

  return executeRecovery(runId, decision)
}

export async function executeRecovery(runId: string, decision: RecoveryDecision): Promise<RecoveryResult> {
  const base = {
    action: decision.action,
    previousStatus: decision.status,
    runId,
  }

  switch (decision.action) {
    case "remain_paused":
      return {
        ...base,
        success: true,
        newStatus: decision.status,
        message: `Run remains paused with ${decision.pendingApprovalIds.length} pending approval(s). Pending approvals: ${decision.pendingApprovalIds.join(", ")}`,
      }

    case "immutable":
      return {
        ...base,
        success: true,
        newStatus: decision.status,
        message: `Run is in terminal state '${decision.status}' - no recovery action taken`,
      }

    case "resume":
      return await resumeRun(runId, decision)

    case "retry":
      return await retryRun(runId, decision)

    case "invalid":
      return {
        ...base,
        success: false,
        newStatus: null,
        message: decision.reason,
        error: decision.reason,
      }

    default:
      return {
        ...base,
        success: false,
        newStatus: null,
        message: `Unknown recovery action: ${decision.action}`,
        error: "unknown_action",
      }
  }
}

async function resumeRun(runId: string, decision: RecoveryDecision): Promise<RecoveryResult> {
  const base = {
    action: "resume" as const,
    previousStatus: decision.status,
    runId,
  }

  try {
    const currentState = await getProjectedRunState(runId)
    if (!currentState) {
      return {
        ...base,
        success: false,
        newStatus: null,
        message: "Cannot resume - state not found",
        error: "state_not_found",
      }
    }

    if (currentState.status === "running") {
      return {
        ...base,
        success: true,
        newStatus: "running",
        message: `Run is already in running state. Incomplete step: ${decision.incompleteStepId || "none"}`,
      }
    }

    log.info("resuming run", { runId, incompleteStepId: decision.incompleteStepId })

    return {
      ...base,
      success: true,
      newStatus: "running",
      message: `Run resumed to running state. Incomplete step: ${decision.incompleteStepId || "none"}`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error("failed to resume run", { runId, error: errorMessage })

    return {
      ...base,
      success: false,
      newStatus: null,
      message: `Resume failed: ${errorMessage}`,
      error: errorMessage,
    }
  }
}

async function retryRun(runId: string, decision: RecoveryDecision): Promise<RecoveryResult> {
  const base = {
    action: "retry" as const,
    previousStatus: decision.status,
    runId,
  }

  try {
    log.info("retrying run", { runId, fromStatus: decision.status })

    if (decision.status === "queued" || decision.status === "compiled") {
      return {
        ...base,
        success: true,
        newStatus: decision.status,
        message: `Run is in ${decision.status} state - ready for execution to start`,
      }
    }

    return {
      ...base,
      success: false,
      newStatus: null,
      message: `Cannot retry from status: ${decision.status}`,
      error: "invalid_retry_status",
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log.error("failed to retry run", { runId, error: errorMessage })

    return {
      ...base,
      success: false,
      newStatus: null,
      message: `Retry failed: ${errorMessage}`,
      error: errorMessage,
    }
  }
}
