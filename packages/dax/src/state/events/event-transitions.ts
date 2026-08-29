import { Log } from "@/util/log"
import {
  appendRunEvent,
  appendRunEventAtTail,
  readRunEvents,
  projectRunStateFromEvents,
  getRunAuthority,
  setRunAuthority,
} from "./run-event-store"
import { reduceRunState, type RunState } from "./run-reducer"
import { type RunEventType, type RunEventPayload } from "./run-event-types"
import type { RunStatus } from "../run-state"
import type { ApprovalContext, ApprovalSource } from "@/approval/approval-types"
import type { MutationReceipt } from "@/sdlc/mutation-receipt"

const log = Log.create({ service: "event-transitions" })

export async function isEventAuthorityRun(runId: string): Promise<boolean> {
  const authority = await getRunAuthority(runId)
  return authority === "event-log"
}

export async function createEventAuthorityRun(
  runId: string,
  contractId: string,
  verificationRequired = false,
  guardEnforcementMode: "warn" | "enforce" = "warn",
): Promise<void> {
  await setRunAuthority(runId, "event-log")

  await appendRunEvent(runId, 0, {
    type: "contract_compiled",
    payload: { contractId, verificationRequired, guardEnforcementMode },
  })

  log.info("created event-authority run", { runId, contractId, verificationRequired })
}

export async function transitionEventAuthority(
  runId: string,
  newStatus: RunStatus,
  eventType: RunEventType,
  payload: unknown,
): Promise<RunState> {
  const authority = await getRunAuthority(runId)
  if (authority !== "event-log") {
    throw new Error(`Run ${runId} is not an event-authority run`)
  }

  const events = await readRunEvents(runId)
  const currentState = reduceRunState(events)

  if (!currentState) {
    throw new Error(`No events found for run ${runId}`)
  }

  if (currentState.status === newStatus) {
    return currentState
  }

  const seq = events.length
  await appendRunEvent(runId, seq, {
    type: eventType,
    payload,
  })

  const updatedState = await projectRunStateFromEvents(runId)
  if (!updatedState) {
    throw new Error(`Failed to project state for run ${runId}`)
  }

  log.info("event-authority transition", { runId, status: newStatus, eventType, seq })

  return updatedState
}

export async function getEventAuthorityState(runId: string): Promise<RunState | null> {
  const authority = await getRunAuthority(runId)
  if (authority !== "event-log") {
    return null
  }

  return projectRunStateFromEvents(runId)
}

export async function appendEventOnly<E extends RunEventType>(
  runId: string,
  eventType: E,
  payload: Extract<RunEventPayload, { type: E }>["payload"],
  commandId?: string,
  envelope?: { correlationId?: string; causationId?: string },
  options?: { rejectDuplicateCommand?: boolean },
): Promise<RunState> {
  const authority = await getRunAuthority(runId)
  if (authority !== "event-log") {
    throw new Error(`Run ${runId} is not an event-authority run`)
  }

  await appendRunEventAtTail(
    runId,
    {
      type: eventType,
      payload,
      ...(commandId ? { commandId } : {}),
      ...(envelope?.correlationId ? { correlationId: envelope.correlationId } : {}),
      ...(envelope?.causationId ? { causationId: envelope.causationId } : {}),
    },
    options,
  )

  const updatedState = await projectRunStateFromEvents(runId)
  if (!updatedState) {
    throw new Error(`Failed to project state for run ${runId}`)
  }

  return updatedState
}

export async function addStepEvent(
  runId: string,
  stepId: string,
  title: string,
  stepType: "proposed" | "executed" | "approved" | "rejected",
): Promise<RunState> {
  const commandId = `cmd_step_add_${stepId}`
  return appendEventOnly(runId, "step_added", { stepId, title, stepType }, commandId)
}

export async function startStepEvent(runId: string, stepId: string): Promise<RunState> {
  const commandId = `cmd_step_start_${stepId}`
  return appendEventOnly(runId, "step_started", { stepId }, commandId)
}

export async function completeStepEvent(runId: string, stepId: string, outputs: string[]): Promise<RunState> {
  const commandId = `cmd_step_complete_${stepId}`
  return appendEventOnly(runId, "step_completed", { stepId, outputs }, commandId)
}

export async function failStepEvent(
  runId: string,
  stepId: string,
  error: { code: string; message: string },
): Promise<RunState> {
  const commandId = `cmd_step_fail_${stepId}`
  return appendEventOnly(runId, "step_failed", { stepId, error }, commandId)
}

export async function addApprovalEvent(
  runId: string,
  approvalId: string,
  details?: {
    approvalType?: string
    risk?: string
    title?: string
    reason?: string
    expectedConsequence?: string
    stepId?: string | null
    context?: ApprovalContext
    source?: ApprovalSource
    /** The native invocation this approval authorizes, when there is one. */
    correlationId?: string
  },
): Promise<RunState> {
  const commandId = `cmd_approval_add_${approvalId}`
  // The defaults are what this function assumed unconditionally before callers
  // could describe the approval. They remain only so a caller with nothing to say
  // still produces a well-formed event.
  return appendEventOnly(
    runId,
    "approval_requested",
    {
      approvalId,
      approvalType: details?.approvalType ?? "tool",
      risk: details?.risk ?? "medium",
      ...(details?.title ? { title: details.title } : {}),
      ...(details?.reason ? { reason: details.reason } : {}),
      ...(details?.expectedConsequence ? { expectedConsequence: details.expectedConsequence } : {}),
      ...(details?.stepId !== undefined ? { stepId: details.stepId } : {}),
      ...(details?.context ? { context: details.context } : {}),
      ...(details?.source ? { source: details.source } : {}),
    },
    commandId,
    details?.correlationId ? { correlationId: details.correlationId } : undefined,
  )
}

export async function resolveApprovalEvent(
  runId: string,
  approvalId: string,
  decision: "approved" | "rejected" | "expired" | "cancelled",
  actor?: string | null,
  comment?: string,
  resolvedAt = new Date().toISOString(),
): Promise<RunState> {
  const commandId = `cmd_resolve_${approvalId}_${decision}`
  return appendEventOnly(
    runId,
    "approval_resolved",
    {
      approvalId,
      decision,
      ...(actor !== undefined ? { actor } : {}),
      ...(comment !== undefined ? { comment } : {}),
      resolvedAt,
    },
    commandId,
  )
}

export async function addArtifactEvent(runId: string, artifactId: string, artifactType: string): Promise<RunState> {
  const commandId = `cmd_artifact_${artifactId}`
  return appendEventOnly(runId, "artifact_created", { artifactId, artifactType }, commandId)
}

export async function addDraftEvent(
  runId: string,
  draftId: string,
  type: string,
  content: string,
  targetPath?: string,
): Promise<RunState> {
  const commandId = `cmd_draft_${draftId}`
  return appendEventOnly(runId, "draft_created", { draftId, type, content, targetPath }, commandId)
}

export async function updateProviderPressure(
  runId: string,
  payload: { lane?: string; throttles: number; inFlight: number; queueLength: number },
): Promise<RunState> {
  const commandId = `cmd_pressure_${Date.now()}`
  return appendEventOnly(runId, "provider_pressure_updated", payload, commandId)
}

/**
 * Appends the canonical record of one governed native tool-execution attempt.
 * Invocation identity is single-use. Any repeated command is rejected so a
 * framework retry cannot re-enter an executor after an uncertain outcome.
 */
export async function recordToolInvocation(
  runId: string,
  invocationId: string,
  details: {
    toolId: string
    input: { basis: "validated_tool_input"; canonicalization: "sorted-json-v1"; digest: string; redactedPreview: string; truncated: boolean }
    contractId: string
    executor: { kind: "builtin" | "plugin" | "mcp"; id: string }
    originTurnId?: string
    workflowStepId?: string
    parentInvocationId?: string
    ordinal?: number
    retryOfInvocationId?: string
  },
): Promise<RunState> {
  const commandId = `cmd_invocation_${invocationId}`
  return appendEventOnly(
    runId,
    "tool_invocation_recorded",
    {
      invocationId,
      toolId: details.toolId,
      input: details.input,
      contractId: details.contractId,
      executor: details.executor,
      ...(details.originTurnId ? { originTurnId: details.originTurnId } : {}),
      ...(details.workflowStepId ? { workflowStepId: details.workflowStepId } : {}),
      ...(details.parentInvocationId ? { parentInvocationId: details.parentInvocationId } : {}),
      ...(details.ordinal !== undefined ? { ordinal: details.ordinal } : {}),
      ...(details.retryOfInvocationId ? { retryOfInvocationId: details.retryOfInvocationId } : {}),
    },
    commandId,
    undefined,
    { rejectDuplicateCommand: true },
  )
}

/**
 * Appends the canonical authority fact for one invocation: the combined,
 * already-resolved effective decision of contract, RuntimeGuard, Permission,
 * and any approvals used. Durable before the caller may proceed into the
 * external-effect executor.
 */
export async function recordAuthorization(
  runId: string,
  invocationId: string,
  disposition: {
    finalDisposition: "allowed" | "denied"
    contractDisposition: "allowed" | "denied"
    runtimeGuardDisposition: "allowed" | "denied" | "approval_required" | "not_evaluated"
    permissionDisposition: "allowed" | "denied" | "approval_required" | "not_evaluated"
    approvalIds: string[]
    reasonCodes: string[]
  },
): Promise<RunState> {
  const commandId = `cmd_authorization_${invocationId}`
  return appendEventOnly(
    runId,
    "authorization_recorded",
    {
      invocationId,
      finalDisposition: disposition.finalDisposition,
      contractDisposition: disposition.contractDisposition,
      runtimeGuardDisposition: disposition.runtimeGuardDisposition,
      permissionDisposition: disposition.permissionDisposition,
      approvalIds: disposition.approvalIds,
      reasonCodes: disposition.reasonCodes,
    },
    commandId,
    { correlationId: invocationId },
    { rejectDuplicateCommand: true },
  )
}

export type ToolResultOutcome =
  | {
      status: "completed"
      result: { basis: "validated_dax_result_pre_truncation"; canonicalization: "sorted-json-v1"; digest: string; redactedPreview: string; truncated: boolean }
    }
  | { status: "failed"; failure: { code: string; message: string; retryable: boolean } }
  | { status: "cancelled"; cancellation: { code: string; message: string } }

/**
 * Appends the canonical terminal record for one invocation. Requires the
 * allowed authorization event so the causation chain is provable at read
 * time; callers must resolve that event id (e.g. from the projected
 * invocation's authorizationEventId) before calling this.
 */
export async function recordToolResult(
  runId: string,
  invocationId: string,
  authorizationEventId: string,
  outcome: ToolResultOutcome,
): Promise<RunState> {
  const commandId = `cmd_result_${invocationId}`
  return appendEventOnly(
    runId,
    "tool_result_recorded",
    { invocationId, ...outcome },
    commandId,
    { correlationId: invocationId, causationId: authorizationEventId },
    { rejectDuplicateCommand: true },
  )
}

/**
 * Records a kernel-observed native workspace mutation. One observation window
 * may contain parallel/nested invocations, so attribution is deliberately a
 * set rather than a false one-tool claim.
 */
export async function recordNativeMutation(
  runId: string,
  receipt: MutationReceipt,
  observationWindowInvocationIds: string[],
): Promise<RunState> {
  return appendEventOnly(
    runId,
    "mutation_recorded",
    {
      basis: "native_snapshot_diff_v1",
      receipt,
      observationWindowInvocationIds,
    },
    `cmd_mutation_${receipt.receiptId}`,
    undefined,
    { rejectDuplicateCommand: true },
  )
}

export type { RunState }
