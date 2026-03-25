import { Log } from "@/util/log"
import { getProjectedRunState } from "@/state/events/run-event-store"
import { transitionEventAuthority, isEventAuthorityRun } from "@/state/events/event-transitions"
import { recoverRun, type RecoveryResult, type ContinuationPlan } from "@/state/events/runtime-recovery"
import { evaluateRunRecovery } from "@/state/events/recovery"
import type { RunState } from "@/state/events/run-reducer"

const log = Log.create({ service: "continuation-executor" })

export interface ExecutionResult {
  success: boolean
  action: string
  runId: string
  status: string
  message: string
  approvals?: string[]
  stepId?: string | null
  error?: string
}

export async function executeContinuation(runId: string): Promise<ExecutionResult> {
  if (!(await isEventAuthorityRun(runId))) {
    return {
      success: false,
      action: "invalid",
      runId,
      status: "unknown",
      message: "Run is not event-authority",
      error: "not_event_authority",
    }
  }

  const recoveryResult = await recoverRun(runId)
  if (!recoveryResult.success) {
    return {
      success: false,
      action: "failed",
      runId,
      status: recoveryResult.previousStatus,
      message: recoveryResult.message,
      error: recoveryResult.error,
    }
  }

  const plan = recoveryResult.continuation
  if (!plan) {
    return {
      success: true,
      action: "none",
      runId,
      status: recoveryResult.newStatus || recoveryResult.previousStatus,
      message: "No continuation needed",
    }
  }

  return await executeContinuationPlan(runId, plan)
}

export async function executeContinuationPlan(runId: string, plan: ContinuationPlan): Promise<ExecutionResult> {
  const state = await getProjectedRunState(runId)
  if (!state) {
    return {
      success: false,
      action: "failed",
      runId,
      status: "unknown",
      message: "State not found for execution",
      error: "state_not_found",
    }
  }

  switch (plan.nextStep) {
    case "pause":
      return await handlePause(runId, state, plan)

    case "resume_workflow":
      return await handleResume(runId, state, plan)

    case "start_execution":
      return await handleStartExecution(runId, state, plan)

    case "reject":
      return await handleReject(runId, state, plan)

    default:
      return {
        success: false,
        action: "invalid",
        runId,
        status: state.status,
        message: `Unknown continuation plan: ${plan.nextStep}`,
        error: "unknown_plan",
      }
  }
}

async function handlePause(runId: string, state: RunState, plan: ContinuationPlan): Promise<ExecutionResult> {
  log.info("execution paused", { runId, approvalIds: plan.approvalIds })

  return {
    success: true,
    action: "paused",
    runId,
    status: state.status,
    message: `Execution paused. Pending approvals: ${plan.approvalIds.join(", ")}`,
    approvals: plan.approvalIds,
  }
}

async function handleResume(runId: string, state: RunState, plan: ContinuationPlan): Promise<ExecutionResult> {
  if (state.status !== "running") {
    return {
      success: false,
      action: "rejected",
      runId,
      status: state.status,
      message: `Cannot resume: run is not in running state (current: ${state.status})`,
      error: "invalid_status_for_resume",
    }
  }

  const stepId = plan.stepId || state.currentStepId
  log.info("execution resumed", { runId, stepId })

  return {
    success: true,
    action: "resumed",
    runId,
    status: "running",
    message: `Workflow execution resumed from step: ${stepId || "none"}`,
    stepId,
  }
}

async function handleStartExecution(runId: string, state: RunState, plan: ContinuationPlan): Promise<ExecutionResult> {
  if (state.status !== "queued" && state.status !== "compiled") {
    return {
      success: false,
      action: "rejected",
      runId,
      status: state.status,
      message: `Cannot start execution: run is not queued or compiled (current: ${state.status})`,
      error: "invalid_status_for_start",
    }
  }

  let fromStatus = state.status

  if (state.status === "compiled") {
    await transitionEventAuthority(runId, "queued", "execution_queued", {})
    fromStatus = "compiled"
  }

  const newState = await transitionEventAuthority(runId, "running", "workflow_started", {})
  log.info("execution started", { runId, fromStatus })

  return {
    success: true,
    action: "started",
    runId,
    status: newState.status,
    message: `Workflow execution started from ${fromStatus} state`,
  }
}

async function handleReject(runId: string, state: RunState, plan: ContinuationPlan): Promise<ExecutionResult> {
  log.info("execution rejected", { runId, reason: plan.reason })

  return {
    success: true,
    action: "rejected",
    runId,
    status: state.status,
    message: `Execution rejected: ${plan.reason}`,
  }
}
