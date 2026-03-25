import { Transitions } from "@/state/transitions"
import { readRunState } from "@/state/run-store"
import {
  isEventAuthorityRun,
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

export class HybridTransitions {
  static async addStep(
    runId: string,
    stepId: string,
    title: string,
    stepType: "proposed" | "executed" | "approved",
  ): Promise<RunState> {
    if (await isEventAuthorityRun(runId)) {
      return addStepEvent(runId, stepId, title, stepType)
    }
    return Transitions.addStep(runId, stepId, title, stepType)
  }

  static async startStep(runId: string, stepId: string): Promise<RunState> {
    if (await isEventAuthorityRun(runId)) {
      return startStepEvent(runId, stepId)
    }
    return Transitions.startStep(runId, stepId)
  }

  static async completeStep(runId: string, stepId: string, outputs: string[]): Promise<RunState> {
    if (await isEventAuthorityRun(runId)) {
      return completeStepEvent(runId, stepId, outputs)
    }
    return Transitions.completeStep(runId, stepId, outputs)
  }

  static async failStep(runId: string, stepId: string, error: { code: string; message: string }): Promise<RunState> {
    if (await isEventAuthorityRun(runId)) {
      return failStepEvent(runId, stepId, error)
    }
    return Transitions.failStep(runId, stepId, error)
  }

  static async addApproval(runId: string, approvalId: string): Promise<RunState> {
    if (await isEventAuthorityRun(runId)) {
      return addApprovalEvent(runId, approvalId)
    }
    return Transitions.addApproval(runId, approvalId)
  }

  static async transition(runId: string, newStatus: RunStatus, eventType: string): Promise<RunState> {
    if (await isEventAuthorityRun(runId)) {
      return transitionEventAuthority(runId, newStatus, eventType, {})
    }
    return Transitions.transition(runId, newStatus, eventType)
  }

  static async addArtifact(runId: string, artifactId: string): Promise<RunState> {
    if (await isEventAuthorityRun(runId)) {
      return addArtifactEvent(runId, artifactId, "file")
    }
    return Transitions.addArtifact(runId, artifactId)
  }

  static async createDraft(
    runId: string,
    draftId: string,
    type: string,
    content: string,
    targetPath?: string,
  ): Promise<RunState> {
    if (await isEventAuthorityRun(runId)) {
      return addDraftEvent(runId, draftId, type, content, targetPath)
    }
    const state = await readRunState(runId)
    if (!state) {
      throw new Error(`Run not found: ${runId}`)
    }
    return state
  }
}
