import { Log } from "@/util/log"
import { Transitions } from "@/state/transitions"
import { HybridTransitions } from "@/state/hybrid-transitions"
import { ApprovalTransitions } from "@/approval/approval-transitions"
import type { ExecutionContract } from "@/execution/execution-contract"
import type { WorkflowContext, WorkflowExecutionResult, WorkflowStepResult } from "./types"
import { DraftArtifactSchema, type DraftArtifact } from "./types"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "draft-approve-execute" })

export class DraftApproveExecuteWorkflow {
  private runId: string
  private contract: ExecutionContract
  private draftArtifact: DraftArtifact | null = null

  constructor(context: WorkflowContext) {
    this.runId = context.runId
    this.contract = context.contract
  }

  async execute(): Promise<WorkflowExecutionResult> {
    const stepResults: WorkflowStepResult[] = []

    log.info("starting draft/approve/execute workflow", { runId: this.runId })

    const draftResult = await this.executePrepareDraft()
    stepResults.push(draftResult)

    if (!draftResult.success) {
      return {
        success: false,
        stepResults,
        error: `prepare_draft failed: ${draftResult.error}`,
      }
    }

    const approvalResult = await this.executeRequestApproval(draftResult.outputs)
    stepResults.push(approvalResult)

    if (!approvalResult.success) {
      return {
        success: false,
        stepResults,
        error: approvalResult.error ?? `request_approval failed`,
      }
    }

    // Halt execution and wait for approval resolution
    return {
      success: true,
      stepResults,
    }
  }

  private async executePrepareDraft(): Promise<WorkflowStepResult> {
    log.info("executing prepare_draft step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await Transitions.addStep(this.runId, stepId, "Prepare Draft", "executed")
      await Transitions.startStep(this.runId, stepId)

      const expectedOutputs = this.contract.expectedOutputs
      const draftType = expectedOutputs.find((o) => o.type === "file" || o.type === "patch")?.type ?? "file"

      const draftArtifact: DraftArtifact = {
        type: draftType as DraftArtifact["type"],
        content: this.buildDraftContent(),
        targetPath: this.contract.expectedOutputs.find((o) => o.pathHint)?.pathHint,
      }

      this.draftArtifact = draftArtifact
      await Transitions.completeStep(this.runId, stepId, [`draft:${draftArtifact.type}`])

      log.info("prepare_draft completed", { runId: this.runId, artifactType: draftArtifact.type })

      return {
        stepId,
        success: true,
        outputs: [draftArtifact],
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error("prepare_draft failed", { runId: this.runId, error: errorMessage })

      const stepId = `step_${Identifier.create("part", false)}`
      await Transitions.addStep(this.runId, stepId, "Prepare Draft", "executed")
      await Transitions.startStep(this.runId, stepId)
      await Transitions.failStep(this.runId, stepId, { code: "draft_failed", message: errorMessage })

      return {
        stepId,
        success: false,
        outputs: [],
        error: errorMessage,
      }
    }
  }

  private buildDraftContent(): string {
    const intent = this.contract.intent
    return `## Draft Artifact\n\nBased on intent: ${intent}\n\nThis is a placeholder draft. The actual implementation should generate relevant content based on the intent.\n`
  }

  private async executeRequestApproval(drafts: DraftArtifact[]): Promise<WorkflowStepResult> {
    log.info("executing request_approval step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await Transitions.addStep(this.runId, stepId, "Request Approval", "approved")
      await Transitions.startStep(this.runId, stepId)

      const draft = drafts[0]
      const riskLevel = this.getApprovalRiskLevel(draft)

      const approval = await ApprovalTransitions.create({
        runId: this.runId,
        stepId,
        type: draft.type === "patch" ? "patch_apply" : "file_write",
        risk: riskLevel,
        title: `Approve ${draft.type} execution`,
        reason: `Draft artifact requires approval before execution`,
        context: {
          stepId,
          filePath: draft.targetPath,
        },
        expectedConsequence: `Execute ${draft.type} at ${draft.targetPath ?? "specified location"}`,
        source: "workflow",
      })

      await Transitions.addApproval(this.runId, approval.approvalId)
      await Transitions.transition(this.runId, "waiting_approval", "approval_required")

      await Transitions.completeStep(this.runId, stepId, [approval.approvalId])

      log.info("request_approval completed, waiting for resolution", {
        runId: this.runId,
        approvalId: approval.approvalId,
      })

      return {
        stepId,
        success: true,
        outputs: [],
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error("request_approval failed", { runId: this.runId, error: errorMessage })

      return {
        stepId: "request_approval",
        success: false,
        outputs: [],
        error: errorMessage,
      }
    }
  }

  private getApprovalRiskLevel(draft: DraftArtifact): "low" | "medium" | "high" | "critical" {
    if (this.contract.riskLevel) {
      return this.contract.riskLevel
    }
    if (draft.type === "patch") return "medium"
    return "medium"
  }

  private async executeCommitExecution(drafts: DraftArtifact[]): Promise<WorkflowStepResult> {
    log.info("executing commit_execution step", { runId: this.runId })

    try {
      await Transitions.transition(this.runId, "running", "approval_resumed")

      const stepId = `step_${Identifier.create("part", false)}`
      await Transitions.addStep(this.runId, stepId, "Commit Execution", "executed")
      await Transitions.startStep(this.runId, stepId)

      const draft = drafts[0]
      const artifactId = `art_${Identifier.create("session", false)}`

      await Transitions.addArtifact(this.runId, artifactId)

      await Transitions.completeStep(this.runId, stepId, [artifactId])

      const completedState = await Transitions.transition(this.runId, "completed", "workflow_completed")

      log.info("commit_execution completed", { runId: this.runId, artifactId })

      return {
        stepId,
        success: true,
        outputs: [{ type: draft.type, content: draft.content, artifactId }],
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error("commit_execution failed", { runId: this.runId, error: errorMessage })

      const stepId = `step_${Identifier.create("part", false)}`
      await Transitions.addStep(this.runId, stepId, "Commit Execution", "executed")
      await Transitions.startStep(this.runId, stepId)
      await Transitions.failStep(this.runId, stepId, { code: "execution_failed", message: errorMessage })

      return {
        stepId,
        success: false,
        outputs: [],
        error: errorMessage,
      }
    }
  }

  async resumeAfterApproval(approvalId: string, decision: "approved" | "denied"): Promise<WorkflowExecutionResult> {
    log.info("resuming after approval", { runId: this.runId, approvalId, decision })

    if (decision === "denied") {
      await Transitions.transition(this.runId, "failed", "approval_denied")
      return {
        success: false,
        error: "Approval was denied",
        stepResults: [],
      }
    }

    const executionResult = await this.executeCommitExecution(this.draftArtifact ? [this.draftArtifact] : [])
    return {
      success: executionResult.success,
      finalArtifactId: executionResult.success ? `art_${Identifier.create("session", false)}` : undefined,
      stepResults: [executionResult],
      error: executionResult.success ? undefined : executionResult.error,
    }
  }
}
