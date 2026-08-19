import {
  addStepEvent,
  startStepEvent,
  completeStepEvent,
  failStepEvent,
  addApprovalEvent,
  resolveApprovalEvent,
  addArtifactEvent,
  addDraftEvent,
  transitionEventAuthority,
} from "@/state/events/event-transitions"
import type { RunState, RunStatus } from "@/state/run-state"
import type { RunEventType } from "@/state/events/run-event-types"

/**
 * The run lifecycle. One implementation, event-authority only.
 *
 * This was RunLifecycle, which branched every call on isEventAuthorityRun
 * and kept two implementations of one lifecycle live at once — so every
 * invariant had to hold twice and only one copy was ever checked. The legacy
 * branch also silently dropped the payload, so a failing transition reached
 * "failed" with no reason attached.
 */
export class RunLifecycle {
  static async addStep(
    runId: string,
    stepId: string,
    title: string,
    stepType: "proposed" | "executed" | "approved",
  ): Promise<RunState> {
    return addStepEvent(runId, stepId, title, stepType)
  }

  static async startStep(runId: string, stepId: string): Promise<RunState> {
    return startStepEvent(runId, stepId)
  }

  static async completeStep(runId: string, stepId: string, outputs: string[]): Promise<RunState> {
    return completeStepEvent(runId, stepId, outputs)
  }

  static async failStep(runId: string, stepId: string, error: { code: string; message: string }): Promise<RunState> {
    return failStepEvent(runId, stepId, error)
  }

  static async addApproval(
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
    return addApprovalEvent(runId, approvalId, details)
  }

  static async resolveApproval(
    runId: string,
    approvalId: string,
    decision: "approved" | "rejected" = "approved",
    actor?: string | null,
  ): Promise<RunState> {
    return resolveApprovalEvent(runId, approvalId, decision, actor)
  }

  /**
   * `eventType` is typed, not a bare string. It is written straight into the log,
   * so an untyped one was how a second vocabulary drifted into existence.
   */
  static async transition(
    runId: string,
    newStatus: RunStatus,
    eventType: RunEventType,
    payload: unknown = {},
  ): Promise<RunState> {
    return transitionEventAuthority(runId, newStatus, eventType, payload)
  }

  static async addArtifact(runId: string, artifactId: string): Promise<RunState> {
    return addArtifactEvent(runId, artifactId, "file")
  }

  static async createDraft(
    runId: string,
    draftId: string,
    type: string,
    content: string,
    targetPath?: string,
  ): Promise<RunState> {
    return addDraftEvent(runId, draftId, type, content, targetPath)
  }
}
