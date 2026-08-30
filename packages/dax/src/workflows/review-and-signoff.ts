import { Log } from "@/util/log"
import { getProjectedRunState } from "@/state/events/run-event-store"
import { RunLifecycle } from "@/state/run-lifecycle"
import type { ExecutionContract } from "@/execution/execution-contract"
import type { WorkflowContext, WorkflowExecutionResult, WorkflowStepResult, DraftArtifact } from "./types"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "review-and-signoff" })

export type SignoffDecision = "signed_off" | "rejected" | "expired"

export interface SignoffResult {
  decision: SignoffDecision
  actorId?: string
  reason?: string
  timestamp: string
}

export class ReviewAndSignoffWorkflow {
  private runId: string
  private contract: ExecutionContract
  private signoffResult: SignoffResult | null = null
  private reviewArtifacts: {
    context: DraftArtifact | null
    review: DraftArtifact | null
  } = {
    context: null,
    review: null,
  }

  constructor(context: WorkflowContext) {
    this.runId = context.runId
    this.contract = context.contract
  }

  async execute(): Promise<WorkflowExecutionResult> {
    const stepResults: WorkflowStepResult[] = []

    log.info("starting review_and_signoff workflow", { runId: this.runId })

    const contextResult = await this.executeCollectContext()
    stepResults.push(contextResult)

    if (!contextResult.success) {
      await this.failWorkflow(`collect_context failed: ${contextResult.error}`)
      return {
        success: false,
        stepResults,
        error: contextResult.error,
      }
    }

    const reviewResult = await this.executeProduceReview(contextResult.outputs)
    stepResults.push(reviewResult)

    if (!reviewResult.success) {
      await this.failWorkflow(`produce_review failed: ${reviewResult.error}`)
      return {
        success: false,
        stepResults,
        error: reviewResult.error,
      }
    }

    const signoffResult = await this.executeRequestSignoff(reviewResult.outputs)
    stepResults.push(signoffResult)

    if (!signoffResult.success) {
      await this.failWorkflow(`request_signoff failed: ${signoffResult.error}`)
      return {
        success: false,
        stepResults,
        error: signoffResult.error,
      }
    }

    if (this.determineFinalState() === "expired") {
      await RunLifecycle.transition(this.runId, "completed", "workflow_expired")
      return {
        success: false,
        stepResults,
      }
    }

    const finalizeResult = await this.executeFinalizeOutcome(signoffResult.outputs)
    stepResults.push(finalizeResult)

    if (!finalizeResult.success) {
      await this.failWorkflow(`finalize_outcome failed: ${finalizeResult.error}`)
      return {
        success: false,
        stepResults,
        error: finalizeResult.error,
      }
    }

    const finalArtifactId = `art_${Identifier.create("session", false)}`
    await RunLifecycle.addArtifact(this.runId, finalArtifactId)

    const finalState = this.determineFinalState()
    if (finalState === "signed_off") {
      await RunLifecycle.transition(this.runId, "completed", "workflow_signed_off")
    } else if (finalState === "rejected") {
      await RunLifecycle.transition(this.runId, "completed", "workflow_rejected")
    } else {
      await RunLifecycle.transition(this.runId, "completed", "workflow_expired")
    }

    log.info("review_and_signoff workflow completed", {
      runId: this.runId,
      finalArtifactId,
      finalState,
    })

    return {
      success: finalState === "signed_off",
      finalArtifactId,
      stepResults,
    }
  }

  private determineFinalState(): SignoffDecision {
    return this.signoffResult?.decision ?? "expired"
  }

  private async executeCollectContext(): Promise<WorkflowStepResult> {
    log.info("executing collect_context step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await RunLifecycle.addStep(this.runId, stepId, "Collect Context", "executed")
      await RunLifecycle.startStep(this.runId, stepId)

      const contextArtifact: DraftArtifact = {
        type: "summary",
        content: this.buildContextContent(),
      }

      this.reviewArtifacts.context = contextArtifact
      await RunLifecycle.completeStep(this.runId, stepId, ["context:collected"])

      log.info("collect_context completed", { runId: this.runId })

      return {
        stepId,
        success: true,
        outputs: [contextArtifact],
      }
    } catch (error) {
      return this.handleStepError("collect_context", error)
    }
  }

  private async executeProduceReview(contextOutputs: DraftArtifact[]): Promise<WorkflowStepResult> {
    log.info("executing produce_review step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await RunLifecycle.addStep(this.runId, stepId, "Produce Review", "executed")
      await RunLifecycle.startStep(this.runId, stepId)

      const reviewArtifact: DraftArtifact = {
        type: "report",
        content: this.buildReviewContent(contextOutputs),
      }

      this.reviewArtifacts.review = reviewArtifact
      await RunLifecycle.completeStep(this.runId, stepId, ["review:produced"])

      log.info("produce_review completed", { runId: this.runId })

      return {
        stepId,
        success: true,
        outputs: [reviewArtifact],
      }
    } catch (error) {
      return this.handleStepError("produce_review", error)
    }
  }

  private async executeRequestSignoff(reviewOutputs: DraftArtifact[]): Promise<WorkflowStepResult> {
    log.info("executing request_signoff step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await RunLifecycle.addStep(this.runId, stepId, "Request Signoff", "executed")
      await RunLifecycle.startStep(this.runId, stepId)

      const timeoutMs = this.contract.timeoutMs ?? 3600000
      const deadline = Date.now() + timeoutMs

      await RunLifecycle.transition(this.runId, "waiting_approval", "signoff_requested")

      const decision = await this.waitForSignoff(deadline)

      this.signoffResult = decision
      if (decision.decision !== "expired") {
        await RunLifecycle.transition(this.runId, "running", "signoff_received", {
          decision: decision.decision,
        })
      }

      await RunLifecycle.completeStep(this.runId, stepId, [`signoff:${decision.decision}`])

      log.info("request_signoff completed", { runId: this.runId, decision: decision.decision })

      return {
        stepId,
        success: true,
        outputs: reviewOutputs,
      }
    } catch (error) {
      return this.handleStepError("request_signoff", error)
    }
  }

  private async executeFinalizeOutcome(_signoffOutputs: DraftArtifact[]): Promise<WorkflowStepResult> {
    log.info("executing finalize_outcome step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await RunLifecycle.addStep(this.runId, stepId, "Finalize Outcome", "executed")
      await RunLifecycle.startStep(this.runId, stepId)

      const outcomeArtifact: DraftArtifact = {
        type: "message",
        content: this.buildOutcomeContent(),
      }

      await RunLifecycle.completeStep(this.runId, stepId, [`outcome:${this.determineFinalState()}`])

      log.info("finalize_outcome completed", { runId: this.runId })

      return {
        stepId,
        success: true,
        outputs: [outcomeArtifact],
      }
    } catch (error) {
      return this.handleStepError("finalize_outcome", error)
    }
  }

  private async waitForSignoff(deadline: number): Promise<SignoffResult> {
    const checkInterval = setInterval(async () => {
      if (Date.now() > deadline) {
        clearInterval(checkInterval)
        return
      }

      try {
        const runState = await getProjectedRunState(this.runId)
        if (runState?.status === "waiting_approval") {
          const hasApproval = runState.pendingApprovalIds.length > 0
          if (hasApproval) {
            clearInterval(checkInterval)
            return
          }
        }
      } catch {
        // Continue polling
      }
    }, 1000)

    return new Promise<SignoffResult>((resolve) => {
      setTimeout(
        () => {
          clearInterval(checkInterval)
          resolve({
            decision: "expired",
            timestamp: new Date().toISOString(),
          })
        },
        Math.min(5000, deadline - Date.now()),
      )
    })
  }

  private buildContextContent(): string {
    const intent = this.contract.intent || "Review request"
    return `Review Context for: ${intent}

Scope: ${this.contract.workflowClass}
Risk Level: ${this.contract.riskLevel}
Execution Mode: ${this.contract.executionMode}

This context was collected for a professional review and signoff workflow.`
  }

  private buildReviewContent(contextOutputs: DraftArtifact[]): string {
    const context = contextOutputs[0]?.content || "No context available"
    const intent = this.contract.intent || "Review request"

    return `# Review Report

## Intent
${intent}

## Context Summary
${context}

## Findings

### Strengths
- Structured review process followed
- Clear documentation maintained
- Professional workflow standards applied

### Observations
- Context collected and analyzed
- Review artifact generated

### Recommendations
1. Proceed with informed decision
2. Consider all gathered information
3. Provide clear signoff decision

## Review Artifact
Generated at: ${new Date().toISOString()}

This review was generated by the review_and_signoff workflow.`
  }

  private buildOutcomeContent(): string {
    const decision = this.determineFinalState()
    const timestamp = new Date().toISOString()

    let outcome: string
    switch (decision) {
      case "signed_off":
        outcome = "SIGNED OFF"
        break
      case "rejected":
        outcome = "REJECTED"
        break
      default:
        outcome = "EXPIRED"
    }

    return `# Final Signoff Outcome

## Decision: ${outcome}

### Details
- Workflow: review_and_signoff
- Run ID: ${this.runId}
- Contract: ${this.contract.contractId}
- Intent: ${this.contract.intent}

### Signoff Information
${
  this.signoffResult?.decision === "expired"
    ? `- Operator signoff: not received
- Expired At: ${this.signoffResult.timestamp}`
    : this.signoffResult
      ? `- Decision: ${this.signoffResult.decision}
- Actor: ${this.signoffResult.actorId || "not recorded"}
- Reason: ${this.signoffResult.reason || "N/A"}
- Timestamp: ${this.signoffResult.timestamp}`
      : "- No explicit signoff recorded"
}}

### Outcome
This ${this.contract.workflowClass} workflow has reached its final state.

Recorded at: ${timestamp}`
  }

  private async failWorkflow(reason: string): Promise<void> {
    log.error("review_and_signoff workflow failed", { runId: this.runId, reason })
    await RunLifecycle.transition(this.runId, "failed", "workflow_failed", {
      error: { code: "workflow_failed", message: reason },
    })
  }

  private handleStepError(stepName: string, error: unknown): WorkflowStepResult {
    log.error(`${stepName} failed`, { runId: this.runId, error })
    const message = error instanceof Error ? error.message : String(error)
    return {
      stepId: `step_${Identifier.create("part", false)}`,
      success: false,
      outputs: [],
      error: message,
    }
  }
}
