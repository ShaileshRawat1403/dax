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
import { projectRunStateFromEvents } from "@/state/events/run-event-store"
import type { RunState, RunStatus } from "@/state/run-state"
import type { RunEventType } from "@/state/events/run-event-types"
import type { ApprovalContext, ApprovalSource } from "@/approval/approval-types"

/**
 * Refusal to complete a run that has not satisfied its gates. Kept from the
 * retired legacy module because the reducer raises the same condition and
 * callers still discriminate on the name.
 */
export class RunCompletionBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RunCompletionBlockedError"
  }
}

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
      context?: ApprovalContext
      source?: ApprovalSource
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
    if (newStatus === "completed") {
      const proof = await RunLifecycle.assertCompletionProof(runId)
      if (proof && typeof payload === "object" && payload !== null) {
        payload = { ...(payload as Record<string, unknown>), completionProof: proof }
      }
    }
    return transitionEventAuthority(runId, newStatus, eventType, payload)
  }

  /**
   * Refuse completion when the contract's proof obligations are unmet.
   *
   * Lives here rather than in the reducer because it is contract-aware, and the
   * reducer projects from the log alone. The reducer separately refuses
   * completion with pending approvals or missing verification evidence; this is
   * the wider check — expected outputs, scope, sensitive paths — and it raises a
   * governance approval rather than failing silently.
   *
   * Carried over from the retired legacy lifecycle, which was the only path that
   * enforced it. Losing it in the migration would have removed a governance gate
   * while every test still passed.
   */
  private static async assertCompletionProof(runId: string): Promise<unknown | null> {
    const { ContractGuardian } = await import("@/execution/contract-guardian")
    const contract = await ContractGuardian.get(runId).catch(() => null)
    if (!contract) return null

    const state = await projectRunStateFromEvents(runId)
    if (!state) return null

    const { deriveCompletionProof } = await import("@/execution/completion-proof")
    const { resolveGuardEnforcementMode } = await import("@/execution/guard-mode")
    const proof = deriveCompletionProof({ contract, runState: state })
    const guardMode = resolveGuardEnforcementMode(state.governance.guardEnforcementMode)

    if (proof.decision !== "fail" || guardMode !== "enforce") return { ...proof, checkedAt: new Date().toISOString() }

    const { createAndPersistApproval } = await import("@/approval/approval-transitions")
    await createAndPersistApproval({
      runId,
      type: "workflow_gate",
      risk: "high",
      title: "Completion proof missing evidence",
      reason: `DAX blocked completion because required proof is missing or failed: ${proof.failedChecks.join(", ")}.`,
      source: "system",
      context: { notes: proof.failedChecks },
    })

    throw new RunCompletionBlockedError(
      `Run ${runId} cannot complete without passing completion proof: ${proof.failedChecks.join(", ")}.`,
    )
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
