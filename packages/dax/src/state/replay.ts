import { RunState, createInitialRunState, StepRecord, RunStatus } from "./run-state"
import { RunEvent, ApprovalRecord, ArtifactRecord } from "@/server/run-contract"
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

  // Verify sequential ordering strictly
  for (let i = 1; i < events.length; i++) {
    if (events[i].sequence !== events[i - 1].sequence + 1) {
      throw new Error(
        `Invalid event sequence: expected ${events[i - 1].sequence + 1} but got ${events[i].sequence} at index ${i}`,
      )
    }
  }

  const creationEvent = events.find((e) => e.type === "run.created")
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

  for (const event of events) {
    state.updatedAt = event.timestamp

    switch (event.type) {
      case "run.created":
        // Already handled above
        break

      case "run.started":
        state.status = "running"
        state.startedAt = state.startedAt || event.timestamp
        break

      case "run.state_changed":
        state.status = event.payload.currentStatus as RunStatus
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
          stepId: event.payload.stepId,
          title: event.payload.title,
          type: "proposed",
          status: "proposed",
          startedAt: null,
          completedAt: null,
          error: null,
          outputs: [],
        })
        state.currentStepId = event.payload.stepId
        break

      case "step.started": {
        const stepIndex = state.steps.findIndex((s) => s.stepId === event.payload.stepId)
        if (stepIndex === -1) {
          // If a step was started without being proposed (might happen in older logs), create it
          state.steps.push({
            stepId: event.payload.stepId,
            title: event.payload.title || event.payload.stepId,
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
        state.currentStepId = event.payload.stepId
        break
      }

      case "step.completed": {
        const stepIndex = state.steps.findIndex((s) => s.stepId === event.payload.stepId)
        if (stepIndex !== -1) {
          state.steps[stepIndex].status = "completed"
          state.steps[stepIndex].completedAt = event.timestamp
        }
        if (state.currentStepId === event.payload.stepId) {
          state.currentStepId = null
        }
        break
      }

      case "step.failed": {
        const stepIndex = state.steps.findIndex((s) => s.stepId === event.payload.stepId)
        if (stepIndex !== -1) {
          state.steps[stepIndex].status = "failed"
          state.steps[stepIndex].completedAt = event.timestamp
          state.steps[stepIndex].error = event.payload.error
        }
        if (state.currentStepId === event.payload.stepId) {
          state.currentStepId = null
        }
        break
      }

      case "approval.requested":
        state.pendingApprovalIds.push(event.payload.approval.approvalId)
        pendingApprovals.set(event.payload.approval.approvalId, event.payload.approval)
        break

      case "approval.resolved":
        state.pendingApprovalIds = state.pendingApprovalIds.filter((id) => id !== event.payload.approvalId)
        pendingApprovals.delete(event.payload.approvalId)
        break

      case "artifact.created":
        state.artifactIds.push(event.payload.artifact.artifactId)
        break

      case "trust.updated":
        state.trust = event.payload.trust
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
        state.error = event.payload.error
        break
    }
  }

  return {
    state,
    pendingApprovals: Array.from(pendingApprovals.values()),
  }
}
