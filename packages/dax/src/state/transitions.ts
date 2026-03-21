import { Log } from "@/util/log"
import { RunStore } from "./run-store"
import type { RunState, StepRecord } from "./run-state"
import { RunStatusSchema, type RunStatus, isLegalTransition, isTerminalStatus, isStepTerminalStatus } from "./run-state"
import { StepRecordSchema } from "./run-state"

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

async function getOrThrow(runId: string): Promise<RunState> {
  const state = await RunStore.get(runId)
  if (!state) {
    throw new RunStateNotFoundError(runId)
  }
  return state
}

export async function transitionTo(runId: string, newStatus: RunStatus, reason?: string): Promise<RunState> {
  const state = await getOrThrow(runId)

  if (!isLegalTransition(state.status, newStatus)) {
    throw new IllegalTransitionError(state.status, newStatus)
  }

  const updated: RunState = {
    ...state,
    status: newStatus,
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

  log.info("run state transitioned", {
    runId,
    from: state.status,
    to: newStatus,
    reason,
  })

  return updated
}

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

export namespace Transitions {
  export async function transition(runId: string, newStatus: RunStatus, reason?: string): Promise<RunState> {
    return transitionTo(runId, newStatus, reason)
  }

  export async function addStep(
    runId: string,
    stepId: string,
    title: string,
    type?: StepRecord["type"],
  ): Promise<RunState> {
    return addStep(runId, stepId, title, type)
  }

  export async function startStep(runId: string, stepId: string): Promise<RunState> {
    return startStep(runId, stepId)
  }

  export async function completeStep(runId: string, stepId: string, outputs?: string[]): Promise<RunState> {
    return completeStep(runId, stepId, outputs)
  }

  export async function failStep(
    runId: string,
    stepId: string,
    error: { code: string; message: string },
  ): Promise<RunState> {
    return failStep(runId, stepId, error)
  }

  export async function addApproval(runId: string, approvalId: string): Promise<RunState> {
    return addPendingApproval(runId, approvalId)
  }

  export async function resolveApproval(runId: string, approvalId: string): Promise<RunState> {
    return removePendingApproval(runId, approvalId)
  }

  export async function addArtifact(runId: string, artifactId: string): Promise<RunState> {
    return addArtifact(runId, artifactId)
  }

  export async function setTrust(runId: string, trust: RunState["trust"]): Promise<RunState> {
    return updateTrust(runId, trust)
  }

  export async function fail(
    runId: string,
    error: { code: string; message: string; retryable?: boolean },
  ): Promise<RunState> {
    return failRun(runId, error)
  }
}
