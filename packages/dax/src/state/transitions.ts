import { Log } from "@/util/log"
import { RunStore } from "./run-store"
import type { RunState, StepRecord } from "./run-state"
import { RunStatusSchema, type RunStatus, isLegalTransition, isTerminalStatus, isStepTerminalStatus } from "./run-state"
import { StepRecordSchema } from "./run-state"
import { Tracer } from "@/runtime/telemetry"
import { ContractGuardian } from "@/execution/contract-guardian"
import { deriveCompletionProof } from "@/execution/completion-proof"
import { resolveGuardEnforcementMode } from "@/execution/guard-mode"
import { createAndPersistApproval } from "@/approval/approval-transitions"

const log = Log.create({ service: "run-transitions" })

export class IllegalTransitionError extends Error {
  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string,
  ) {
    super(`Illegal transition from "${fromStatus}" to "${toStatus}"`)
    this.name = "IllegalTransitionError"
  }
}

export class IllegalStepTransitionError extends Error {
  constructor(
    public readonly stepId: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
  ) {
    super(`Illegal step transition for "${stepId}" from "${fromStatus}" to "${toStatus}"`)
    this.name = "IllegalStepTransitionError"
  }
}

export class RunStateNotFoundError extends Error {
  constructor(public readonly runId: string) {
    super(`Run state not found: ${runId}`)
    this.name = "RunStateNotFoundError"
  }
}

export class RunCompletionBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RunCompletionBlockedError"
  }
}

export class RunInvariantBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RunInvariantBlockedError"
  }
}

async function getOrThrow(runId: string): Promise<RunState> {
  const state = await RunStore.get(runId)
  if (!state) {
    throw new RunStateNotFoundError(runId)
  }
  return state
}

/**
 * Transitions a run to a new status.
 * Validates that the transition is legal and updates state accordingly.
 *
 * @param runId - The run ID to transition
 * @param newStatus - The target status
 * @param reason - Optional reason for the transition
 * @returns The updated run state
 * @throws IllegalTransitionError if transition is not allowed
 */
export async function transitionTo(runId: string, newStatus: RunStatus, reason?: string): Promise<RunState> {
  const state = await getOrThrow(runId)
  let completionProof = state.governance.completionProof
  let guardEnforcementMode = state.governance.guardEnforcementMode

  if (state.status === newStatus) {
    log.info("run state transition skipped (already in status)", {
      runId,
      status: state.status,
      reason,
    })
    return state
  }

  if (!isLegalTransition(state.status, newStatus)) {
    throw new IllegalTransitionError(state.status, newStatus)
  }

  if (state.status === "waiting_approval" && newStatus === "running" && state.pendingApprovalIds.length > 0) {
    throw new RunInvariantBlockedError(
      `Run ${runId} cannot resume running while ${state.pendingApprovalIds.length} approval(s) remain pending.`,
    )
  }

  if (newStatus === "completed") {
    if (state.pendingApprovalIds.length > 0) {
      throw new RunCompletionBlockedError(
        `Run ${runId} cannot complete with ${state.pendingApprovalIds.length} pending approval(s).`,
      )
    }
    const contract = await ContractGuardian.get(runId).catch(() => null)
    if (contract) {
      const proof = deriveCompletionProof({
        contract,
        runState: state,
      })
      const guardMode = resolveGuardEnforcementMode(state.governance.guardEnforcementMode)
      if (proof.decision === "fail" && guardMode === "enforce") {
        await createAndPersistApproval({
          runId,
          type: "workflow_gate",
          risk: "high",
          title: "Completion proof missing evidence",
          reason: `DAX blocked completion because required proof is missing or failed: ${proof.failedChecks.join(", ")}.`,
          source: "system",
          context: {
            notes: proof.failedChecks,
          },
        })
        throw new RunCompletionBlockedError(
          `Run ${runId} cannot complete without passing completion proof: ${proof.failedChecks.join(", ")}.`,
        )
      }
      completionProof = proof
      guardEnforcementMode = guardMode
    }
  }

  const updated: RunState = {
    ...state,
    status: newStatus,
    governance: {
      ...state.governance,
      completionProof,
      guardEnforcementMode,
    },
    updatedAt: new Date().toISOString(),
  }

  if (newStatus === "running" && !state.startedAt) {
    updated.startedAt = new Date().toISOString()
  }

  if (isTerminalStatus(newStatus)) {
    updated.completedAt = new Date().toISOString()
    updated.currentStepId = null
  }

  await RunStore.save(runId, updated)

  Tracer.stateTransition(runId, state.status, newStatus)

  log.info("run state transitioned", {
    runId,
    from: state.status,
    to: newStatus,
    reason,
  })

  return updated
}

/**
 * Adds a new step to a run.
 *
 * @param runId - The run ID
 * @param stepId - Unique step identifier
 * @param title - Step title
 * @param type - Step type (default: "executed")
 * @returns Updated run state
 */
export async function addStep(
  runId: string,
  stepId: string,
  title: string,
  type: StepRecord["type"] = "executed",
): Promise<RunState> {
  const state = await getOrThrow(runId)

  if (state.status !== "running" && state.status !== "queued") {
    throw new IllegalTransitionError(state.status, "running")
  }

  const step: StepRecord = {
    stepId,
    title,
    type,
    status: "proposed",
    startedAt: null,
    completedAt: null,
    error: null,
    outputs: [],
  }

  const updated: RunState = {
    ...state,
    currentStepId: stepId,
    steps: [...state.steps, step],
    updatedAt: new Date().toISOString(),
  }

  await RunStore.save(runId, updated)

  log.info("step added", { runId, stepId, title })

  return updated
}

/**
 * Marks a step as started.
 *
 * @param runId - The run ID
 * @param stepId - The step ID to start
 * @returns Updated run state
 */
export async function startStep(runId: string, stepId: string): Promise<RunState> {
  const state = await getOrThrow(runId)
  const stepIndex = state.steps.findIndex((s) => s.stepId === stepId)

  if (stepIndex === -1) {
    throw new Error(`Step not found: ${stepId}`)
  }

  const step = state.steps[stepIndex]
  if (step.status !== "proposed") {
    throw new IllegalStepTransitionError(stepId, step.status, "running")
  }

  const updatedSteps = [...state.steps]
  updatedSteps[stepIndex] = {
    ...step,
    status: "running",
    startedAt: new Date().toISOString(),
  }

  const updated: RunState = {
    ...state,
    currentStepId: stepId,
    steps: updatedSteps,
    updatedAt: new Date().toISOString(),
  }

  await RunStore.save(runId, updated)

  log.info("step started", { runId, stepId })

  return updated
}

/**
 * Marks a step as completed with outputs.
 *
 * @param runId - The run ID
 * @param stepId - The step ID to complete
 * @param outputs - Optional step outputs
 * @returns Updated run state
 */
export async function completeStep(runId: string, stepId: string, outputs: string[] = []): Promise<RunState> {
  const state = await getOrThrow(runId)
  const stepIndex = state.steps.findIndex((s) => s.stepId === stepId)

  if (stepIndex === -1) {
    throw new Error(`Step not found: ${stepId}`)
  }

  const step = state.steps[stepIndex]
  if (step.status !== "running") {
    throw new IllegalStepTransitionError(stepId, step.status, "completed")
  }

  const updatedSteps = [...state.steps]
  updatedSteps[stepIndex] = {
    ...step,
    status: "completed",
    completedAt: new Date().toISOString(),
    outputs: [...step.outputs, ...outputs],
  }

  const updated: RunState = {
    ...state,
    currentStepId: null,
    steps: updatedSteps,
    updatedAt: new Date().toISOString(),
  }

  await RunStore.save(runId, updated)

  log.info("step completed", { runId, stepId, outputCount: outputs.length })

  return updated
}

/**
 * Marks a step as failed with an error.
 *
 * @param runId - The run ID
 * @param stepId - The step ID that failed
 * @param error - Error code and message
 * @returns Updated run state
 */
export async function failStep(
  runId: string,
  stepId: string,
  error: { code: string; message: string },
): Promise<RunState> {
  const state = await getOrThrow(runId)
  const stepIndex = state.steps.findIndex((s) => s.stepId === stepId)

  if (stepIndex === -1) {
    throw new Error(`Step not found: ${stepId}`)
  }

  const step = state.steps[stepIndex]

  const updatedSteps = [...state.steps]
  updatedSteps[stepIndex] = {
    ...step,
    status: "failed",
    completedAt: new Date().toISOString(),
    error: { ...error, retryable: false },
  }

  const updated: RunState = {
    ...state,
    currentStepId: null,
    steps: updatedSteps,
    updatedAt: new Date().toISOString(),
  }

  await RunStore.save(runId, updated)

  log.info("step failed", { runId, stepId, error })

  return updated
}

export async function addPendingApproval(runId: string, approvalId: string): Promise<RunState> {
  const state = await getOrThrow(runId)

  if (state.pendingApprovalIds.includes(approvalId)) {
    return state
  }

  const updated: RunState = {
    ...state,
    pendingApprovalIds: [...state.pendingApprovalIds, approvalId],
    governance: {
      ...state.governance,
      budget: {
        ...state.governance.budget,
        approvalsRequested: state.governance.budget.approvalsRequested + 1,
      },
    },
    updatedAt: new Date().toISOString(),
  }

  await RunStore.save(runId, updated)

  log.info("approval added to pending", { runId, approvalId })

  return updated
}

export async function removePendingApproval(runId: string, approvalId: string): Promise<RunState> {
  const state = await getOrThrow(runId)

  const updated: RunState = {
    ...state,
    pendingApprovalIds: state.pendingApprovalIds.filter((id) => id !== approvalId),
    updatedAt: new Date().toISOString(),
  }

  await RunStore.save(runId, updated)

  log.info("approval removed from pending", { runId, approvalId })

  return updated
}

export async function addArtifact(runId: string, artifactId: string): Promise<RunState> {
  const state = await getOrThrow(runId)

  if (state.artifactIds.includes(artifactId)) {
    return state
  }

  const updated: RunState = {
    ...state,
    artifactIds: [...state.artifactIds, artifactId],
    governance: {
      ...state.governance,
      verification: /verification/i.test(artifactId)
        ? {
            required: true,
            satisfied: true,
            receiptIds: [...new Set([...state.governance.verification.receiptIds, artifactId])],
          }
        : state.governance.verification,
    },
    updatedAt: new Date().toISOString(),
  }

  await RunStore.save(runId, updated)

  log.info("artifact added", { runId, artifactId })

  return updated
}

export async function updateTrust(runId: string, trust: RunState["trust"]): Promise<RunState> {
  const state = await getOrThrow(runId)

  const updated: RunState = {
    ...state,
    trust,
    updatedAt: new Date().toISOString(),
  }

  await RunStore.save(runId, updated)

  log.info("trust updated", { runId, posture: trust?.posture })

  return updated
}

export async function failRun(
  runId: string,
  error: { code: string; message: string; retryable?: boolean },
): Promise<RunState> {
  const state = await getOrThrow(runId)

  const updated: RunState = {
    ...state,
    status: "failed",
    error: { ...error, retryable: error.retryable ?? false },
    currentStepId: null,
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  await RunStore.save(runId, updated)

  log.info("run failed", { runId, error })

  return updated
}

export const Transitions = {
  async transition(runId: string, newStatus: RunStatus, reason?: string): Promise<RunState> {
    return transitionTo(runId, newStatus, reason)
  },

  async addStep(runId: string, stepId: string, title: string, type?: StepRecord["type"]): Promise<RunState> {
    return addStep(runId, stepId, title, type)
  },

  async startStep(runId: string, stepId: string): Promise<RunState> {
    return startStep(runId, stepId)
  },

  async completeStep(runId: string, stepId: string, outputs?: string[]): Promise<RunState> {
    return completeStep(runId, stepId, outputs)
  },

  async failStep(runId: string, stepId: string, error: { code: string; message: string }): Promise<RunState> {
    return failStep(runId, stepId, error)
  },

  async addApproval(runId: string, approvalId: string): Promise<RunState> {
    return addPendingApproval(runId, approvalId)
  },

  async resolveApproval(runId: string, approvalId: string): Promise<RunState> {
    return removePendingApproval(runId, approvalId)
  },

  async addArtifact(runId: string, artifactId: string): Promise<RunState> {
    return addArtifact(runId, artifactId)
  },

  async setTrust(runId: string, trust: RunState["trust"]): Promise<RunState> {
    return updateTrust(runId, trust)
  },

  async fail(runId: string, error: { code: string; message: string; retryable?: boolean }): Promise<RunState> {
    return failRun(runId, error)
  },
}
