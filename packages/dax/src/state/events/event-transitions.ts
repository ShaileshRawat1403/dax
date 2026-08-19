import { Log } from "@/util/log"
import {
  appendRunEvent,
  readRunEvents,
  projectRunStateFromEvents,
  getRunAuthority,
  setRunAuthority,
} from "./run-event-store"
import { reduceRunState, type RunState } from "./run-reducer"
import { isRunEventType, type RunEventType, type RunEventPayload } from "./run-event-types"
import type { RunStatus } from "../run-state"

const log = Log.create({ service: "event-transitions" })

export async function isEventAuthorityRun(runId: string): Promise<boolean> {
  const authority = await getRunAuthority(runId)
  return authority === "event-log"
}

export async function createEventAuthorityRun(
  runId: string,
  contractId: string,
  verificationRequired = false,
): Promise<void> {
  await setRunAuthority(runId, "event-log")

  await appendRunEvent(runId, 0, {
    type: "contract_compiled",
    payload: { contractId, verificationRequired },
  })

  log.info("created event-authority run", { runId, contractId, verificationRequired })
}

export async function transitionEventAuthority(
  runId: string,
  newStatus: RunStatus,
  eventType: string,
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

  if (!isRunEventType(eventType)) {
    throw new Error(`Unknown event type: ${eventType}`)
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
): Promise<RunState> {
  const authority = await getRunAuthority(runId)
  if (authority !== "event-log") {
    throw new Error(`Run ${runId} is not an event-authority run`)
  }

  const events = await readRunEvents(runId)
  const seq = events.length

  await appendRunEvent(runId, seq, {
    type: eventType,
    payload,
    ...(commandId ? { commandId } : {}),
  })

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
    },
    commandId,
  )
}

export async function resolveApprovalEvent(
  runId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  actor?: string | null,
): Promise<RunState> {
  const commandId = `cmd_resolve_${approvalId}_${decision}`
  return appendEventOnly(
    runId,
    "approval_resolved",
    {
      approvalId,
      decision,
      ...(actor !== undefined ? { actor } : {}),
      resolvedAt: new Date().toISOString(),
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

export type { RunState }
