import { Log } from "@/util/log"
import {
  appendRunEvent,
  readRunEvents,
  projectRunStateFromEvents,
  getRunAuthority,
  setRunAuthority,
} from "./run-event-store"
import { reduceRunState, type RunState } from "./run-reducer"
import type { RunStatus } from "../run-state"

const log = Log.create({ service: "event-transitions" })

export async function isEventAuthorityRun(runId: string): Promise<boolean> {
  const authority = await getRunAuthority(runId)
  return authority === "event-log"
}

export async function createEventAuthorityRun(runId: string, contractId: string): Promise<void> {
  await setRunAuthority(runId, "event-log")

  await appendRunEvent(runId, 0, {
    type: "contract_compiled",
    payload: { contractId },
  })

  log.info("created event-authority run", { runId, contractId })
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

  const seq = events.length
  await appendRunEvent(runId, seq, {
    type: eventType as any,
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

export async function appendEventOnly(runId: string, eventType: string, payload: unknown): Promise<RunState> {
  const authority = await getRunAuthority(runId)
  if (authority !== "event-log") {
    throw new Error(`Run ${runId} is not an event-authority run`)
  }

  const events = await readRunEvents(runId)
  const seq = events.length

  await appendRunEvent(runId, seq, {
    type: eventType as any,
    payload,
  })

  const updatedState = await projectRunStateFromEvents(runId)
  if (!updatedState) {
    throw new Error(`Failed to project state for run ${runId}`)
  }

  return updatedState
}

export async function addStepEvent(runId: string, stepId: string, title: string, stepType: string): Promise<RunState> {
  return appendEventOnly(runId, "step_added", { stepId, title, stepType })
}

export async function startStepEvent(runId: string, stepId: string): Promise<RunState> {
  return appendEventOnly(runId, "step_started", { stepId })
}

export async function completeStepEvent(runId: string, stepId: string, outputs: string[]): Promise<RunState> {
  return appendEventOnly(runId, "step_completed", { stepId, outputs })
}

export async function failStepEvent(
  runId: string,
  stepId: string,
  error: { code: string; message: string },
): Promise<RunState> {
  return appendEventOnly(runId, "step_failed", { stepId, error })
}

export async function addApprovalEvent(runId: string, approvalId: string): Promise<RunState> {
  return appendEventOnly(runId, "approval_requested", { approvalId, approvalType: "tool", risk: "medium" })
}

export async function resolveApprovalEvent(
  runId: string,
  approvalId: string,
  decision: "approved" | "rejected",
): Promise<RunState> {
  return appendEventOnly(runId, "approval_resolved", { approvalId, decision })
}

export async function addArtifactEvent(runId: string, artifactId: string, artifactType: string): Promise<RunState> {
  return appendEventOnly(runId, "artifact_created", { artifactId, artifactType })
}

export type { RunState }
