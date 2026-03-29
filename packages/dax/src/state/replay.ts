import type { RunState, StepRecord, RunStatus } from "./run-state"
import { createInitialRunState } from "./run-state"
import type { ApprovalRecord } from "@/server/run-contract"
import { RunEvent, ArtifactRecord } from "@/server/run-contract"
import { Log } from "@/util/log"

const log = Log.create({ service: "run-replay" })

export interface ReplayResult {
  state: RunState
  pendingApprovals: ApprovalRecord[]
}

/**
 * Reconstructs the canonical RunState from an ordered array of RunEvents.
 * Throws an error if the event sequence is illegal or inconsistent.
 */
export function replayRunState(events: RunEvent[]): ReplayResult {
  if (events.length === 0) {
    throw new Error("Cannot replay empty event log")
  }

  // Sort events by sequence
  const sortedEvents = [...events].sort((a, b) => a.sequence - b.sequence)

  // Verify sequential ordering strictly after sorting
  for (let i = 1; i < sortedEvents.length; i++) {
    if (sortedEvents[i].sequence !== sortedEvents[i - 1].sequence + 1) {
      throw new Error(
        `Invalid event sequence: expected ${sortedEvents[i - 1].sequence + 1} but got ${sortedEvents[i].sequence} at index ${i}`,
      )
    }
  }

  const creationEvent = sortedEvents.find((e) => e.type === "run.created")
  if (!creationEvent) {
    throw new Error("Cannot replay: missing run.created event")
  }

  const runId = creationEvent.runId
  let state = createInitialRunState(runId, "unknown_contract")
  const pendingApprovals = new Map<string, ApprovalRecord>()

  // Apply creation event specifics
  state.createdAt = creationEvent.timestamp
  state.updatedAt = creationEvent.timestamp
  if (creationEvent.payload.status) {
    state.status = creationEvent.payload.status as RunStatus
  }

  for (const event of sortedEvents) {
    state.updatedAt = event.timestamp

    // Cast to any to handle historical event types retired from the contract
    const e = event as any

    switch (e.type) {
      case "run.created":
        // Already handled above
        break

      case "run.started":
        state.status = "running"
        state.startedAt = state.startedAt || event.timestamp
        break

      case "run.state_changed":
        state.status = e.payload.currentStatus as RunStatus
        if (state.status === "running" && !state.startedAt) {
          state.startedAt = event.timestamp
        }
        if (["completed", "failed", "cancelled"].includes(state.status)) {
          state.completedAt = event.timestamp
          state.currentStepId = null
        }
        break

      case "step.proposed":
        state.steps.push({
          stepId: e.payload.stepId,
          title: e.payload.title,
          type: "proposed",
          status: "proposed",
          startedAt: null,
          completedAt: null,
          error: null,
          outputs: [],
        })
        state.currentStepId = e.payload.stepId
        break

      case "step.started": {
        const stepIndex = state.steps.findIndex((s) => s.stepId === e.payload.stepId)
        if (stepIndex === -1) {
          // If a step was started without being proposed (might happen in older logs), create it
          state.steps.push({
            stepId: e.payload.stepId,
            title: e.payload.title || e.payload.stepId,
            type: "executed",
            status: "running",
            startedAt: event.timestamp,
            completedAt: null,
            error: null,
            outputs: [],
          })
        } else {
          state.steps[stepIndex].status = "running"
          state.steps[stepIndex].startedAt = event.timestamp
        }
        state.currentStepId = e.payload.stepId
        break
      }

      case "step.completed": {
        const stepIndex = state.steps.findIndex((s) => s.stepId === e.payload.stepId)
        if (stepIndex !== -1) {
          state.steps[stepIndex].status = "completed"
          state.steps[stepIndex].completedAt = event.timestamp
        }
        if (state.currentStepId === e.payload.stepId) {
          state.currentStepId = null
        }
        break
      }

      case "step.failed": {
        const stepIndex = state.steps.findIndex((s) => s.stepId === e.payload.stepId)
        if (stepIndex !== -1) {
          state.steps[stepIndex].status = "failed"
          state.steps[stepIndex].completedAt = event.timestamp
          state.steps[stepIndex].error = {
            code: e.payload.error.code,
            message: e.payload.error.message,
            retryable: e.payload.error.retryable ?? false,
          }
        }
        if (state.currentStepId === e.payload.stepId) {
          state.currentStepId = null
        }
        break
      }

      case "approval.requested":
        state.pendingApprovalIds.push(e.payload.approval.approvalId)
        pendingApprovals.set(e.payload.approval.approvalId, e.payload.approval)
        break

      case "approval.resolved":
        state.pendingApprovalIds = state.pendingApprovalIds.filter((id) => id !== e.payload.approvalId)
        pendingApprovals.delete(e.payload.approvalId)
        break

      case "artifact.created":
        state.artifactIds.push(e.payload.artifact.artifactId)
        break

      case "trust.updated":
      case "audit.posture_updated":
        state.trust = {
          posture: e.payload.trust.posture ?? "low",
          score: e.payload.trust.score ?? null,
          blocked: e.payload.trust.blocked ?? false,
          reasons: e.payload.trust.reasons ?? [],
        }
        break

      case "run.completed":
        state.status = "completed"
        state.completedAt = event.timestamp
        state.currentStepId = null
        break

      case "run.failed":
        state.status = "failed"
        state.completedAt = event.timestamp
        state.currentStepId = null
        state.error = {
          code: e.payload.error.code,
          message: e.payload.error.message,
          retryable: e.payload.error.retryable ?? false,
        }
        break
    }
  }

  return {
    state,
    pendingApprovals: Array.from(pendingApprovals.values()),
  }
}
