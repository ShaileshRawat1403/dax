import { Log } from "@/util/log"
import { generateText } from "ai"
import { HybridTransitions } from "@/state/hybrid-transitions"
import { ApprovalTransitions } from "@/approval/approval-transitions"
import type { ExecutionContract } from "@/execution/execution-contract"
import type { WorkflowContext, WorkflowExecutionResult, WorkflowStepResult } from "./types"
import { DraftArtifactSchema, type DraftArtifact } from "./types"
import { Identifier } from "@/id/id"
import { getEventAuthorityState } from "@/state/events/event-transitions"

const log = Log.create({ service: "draft-approve-execute" })

export type DraftRequest = {
  intent: string
  /** The output the contract promised, which the draft has to be. */
  output: { type: string; description: string; pathHint?: string }
  /** Paths the draft must confine itself to, when the contract declares them. */
  writeScope: string[]
  forbiddenPaths: string[]
  providerHint?: string
  modelHint?: string
}

export type DraftApproveExecuteEffectsShape = {
  /** Produce the content an operator is being asked to approve. */
  generateDraft: (request: DraftRequest) => Promise<string>
}

/**
 * Render the contract as the instruction the drafting model receives.
 *
 * Exported for tests: the prompt is the whole interface between the contract
 * and the draft, so it is worth asserting that scope and forbidden paths
 * actually reach the model rather than being silently dropped.
 */
export function renderDraftPrompt(request: DraftRequest): string {
  const lines = [
    `INTENT: ${request.intent}`,
    ``,
    `EXPECTED OUTPUT: ${request.output.type}`,
    `DESCRIPTION: ${request.output.description}`,
  ]
  if (request.output.pathHint) lines.push(`TARGET PATH: ${request.output.pathHint}`)
  if (request.writeScope.length > 0) lines.push(``, `CONFINE CHANGES TO: ${request.writeScope.join(", ")}`)
  if (request.forbiddenPaths.length > 0) lines.push(`NEVER TOUCH: ${request.forbiddenPaths.join(", ")}`)
  lines.push(
    ``,
    `Produce only the ${request.output.type} content itself. No preamble, no`,
    `explanation, no code fences around the whole response. A human operator`,
    `reviews this verbatim before it is applied.`,
  )
  return lines.join("\n")
}

const defaultEffects: DraftApproveExecuteEffectsShape = {
  async generateDraft(request) {
    // Imported at call time, not module load. The provider graph reaches the
    // workflow registry, which constructs this workflow, so a top-level import
    // is a cycle that fails as a TDZ error the moment a test loads this module
    // directly.
    const { Provider } = await import("@/provider/provider")
    const selected =
      request.providerHint && request.modelHint
        ? { providerID: request.providerHint, modelID: request.modelHint }
        : await Provider.defaultModel()
    if (!selected) {
      throw new Error("no model available to draft with")
    }
    const model = await Provider.getModel(selected.providerID, selected.modelID)
    const result = await generateText({
      model: await Provider.getLanguage(model),
      system: [
        "You are DAX's drafting step. You produce the artifact a human operator",
        "will approve or reject. You never apply anything yourself.",
        "Stay inside the declared scope. If the intent is too ambiguous to draft",
        "responsibly, say so plainly instead of inventing requirements.",
      ].join(" "),
      prompt: renderDraftPrompt(request),
    })
    return result.text
  },
}

/** Test seam: swap effects, always restore. */
export const DraftApproveExecuteEffects = {
  current: defaultEffects,
  set(effects: Partial<DraftApproveExecuteEffectsShape>) {
    DraftApproveExecuteEffects.current = { ...defaultEffects, ...effects }
  },
  reset() {
    DraftApproveExecuteEffects.current = defaultEffects
  },
}

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
      await HybridTransitions.addStep(this.runId, stepId, "Prepare Draft", "executed")
      await HybridTransitions.startStep(this.runId, stepId)

      const expectedOutputs = this.contract.expectedOutputs
      const promised = expectedOutputs.find((o) => o.type === "file" || o.type === "patch") ?? expectedOutputs[0]
      const draftType = (promised?.type === "patch" ? "patch" : "file") satisfies DraftArtifact["type"]
      const targetPath = expectedOutputs.find((o) => o.pathHint)?.pathHint

      const content = await DraftApproveExecuteEffects.current.generateDraft({
        intent: this.contract.intent,
        output: {
          type: draftType,
          description: promised?.description ?? this.contract.intent,
          pathHint: targetPath,
        },
        writeScope: this.contract.runtimePolicy?.scope.targetFiles ?? [],
        forbiddenPaths: this.contract.runtimePolicy?.sensitivity.forbiddenPatterns ?? [],
        providerHint: this.contract.providerHint,
        modelHint: this.contract.modelHint,
      })

      // Fail closed on an empty draft. The step's only product is the thing a
      // human is asked to approve, so shipping a placeholder to an approval
      // gate is worse than failing: it invites a real approval of nothing.
      if (!content.trim()) {
        throw new Error("draft step produced no content — nothing to approve")
      }

      const draftArtifact: DraftArtifact = DraftArtifactSchema.parse({
        type: draftType,
        content,
        targetPath,
      })

      this.draftArtifact = draftArtifact

      const draftId = `draft_${Identifier.create("session", false)}`
      await HybridTransitions.createDraft(
        this.runId,
        draftId,
        draftArtifact.type,
        draftArtifact.content,
        draftArtifact.targetPath,
      )

      await HybridTransitions.completeStep(this.runId, stepId, [`draft:${draftArtifact.type}`])

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
      await HybridTransitions.addStep(this.runId, stepId, "Prepare Draft", "executed")
      await HybridTransitions.startStep(this.runId, stepId)
      await HybridTransitions.failStep(this.runId, stepId, { code: "draft_failed", message: errorMessage })

      return {
        stepId,
        success: false,
        outputs: [],
        error: errorMessage,
      }
    }
  }

  private async executeRequestApproval(drafts: DraftArtifact[]): Promise<WorkflowStepResult> {
    log.info("executing request_approval step", { runId: this.runId })

    try {
      const stepId = `step_${Identifier.create("part", false)}`
      await HybridTransitions.addStep(this.runId, stepId, "Request Approval", "approved")
      await HybridTransitions.startStep(this.runId, stepId)

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

      await HybridTransitions.addApproval(this.runId, approval.approvalId)
      await HybridTransitions.transition(this.runId, "waiting_approval", "approval_required")

      await HybridTransitions.completeStep(this.runId, stepId, [approval.approvalId])

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
      await HybridTransitions.transition(this.runId, "running", "approval_resumed")

      const stepId = `step_${Identifier.create("part", false)}`
      await HybridTransitions.addStep(this.runId, stepId, "Commit Execution", "executed")
      await HybridTransitions.startStep(this.runId, stepId)

      const draft = drafts[0]
      const artifactId = `art_${Identifier.create("session", false)}`
      const verificationArtifactId = `verification_${Identifier.create("session", false)}`

      await HybridTransitions.addArtifact(this.runId, artifactId)
      await HybridTransitions.addArtifact(this.runId, verificationArtifactId)

      await HybridTransitions.completeStep(this.runId, stepId, [artifactId])

      await HybridTransitions.transition(this.runId, "completed", "workflow_completed")

      log.info("commit_execution completed", { runId: this.runId, artifactId })

      return {
        stepId,
        success: true,
        outputs: [
          { type: draft.type, content: draft.content, artifactId },
          {
            type: "report",
            content: "Verification receipt recorded for approved draft execution.",
            artifactId: verificationArtifactId,
          },
        ],
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error("commit_execution failed", { runId: this.runId, error: errorMessage })

      const stepId = `step_${Identifier.create("part", false)}`
      await HybridTransitions.addStep(this.runId, stepId, "Commit Execution", "executed")
      await HybridTransitions.startStep(this.runId, stepId)
      await HybridTransitions.failStep(this.runId, stepId, { code: "execution_failed", message: errorMessage })

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
      await HybridTransitions.resolveApproval(this.runId, approvalId, "rejected")
      await HybridTransitions.transition(this.runId, "failed", "approval_denied")
      return {
        success: false,
        error: "Approval was denied",
        stepResults: [],
      }
    }

    await HybridTransitions.resolveApproval(this.runId, approvalId, "approved")

    const reconstructedDraft = await this.reconstructDraftArtifact()
    const executionResult = await this.executeCommitExecution(reconstructedDraft ? [reconstructedDraft] : [])
    return {
      success: executionResult.success,
      finalArtifactId: executionResult.success ? executionResult.outputs.find((item) => item.artifactId)?.artifactId : undefined,
      stepResults: [executionResult],
      error: executionResult.success ? undefined : executionResult.error,
    }
  }

  private async reconstructDraftArtifact(): Promise<DraftArtifact | null> {
    if (this.draftArtifact) {
      return this.draftArtifact
    }

    try {
      const state = await getEventAuthorityState(this.runId)
      if (!state) {
        return null
      }

      if (state.draft) {
        return {
          type: state.draft.type as DraftArtifact["type"],
          content: state.draft.content,
          targetPath: state.draft.targetPath,
        }
      }

      const draftStep = state.steps.find((s) => s.outputs.some((o) => o.startsWith("draft:")))
      if (!draftStep || !draftStep.outputs.length) {
        return null
      }

      const draftOutput = draftStep.outputs.find((o) => o.startsWith("draft:"))
      if (!draftOutput) {
        return null
      }

      const draftType = draftOutput.replace("draft:", "") as DraftArtifact["type"]
      return {
        type: draftType,
        content: "",
        targetPath: undefined,
      }
    } catch (error) {
      log.warn("failed to reconstruct draft artifact from events", { runId: this.runId })
      return null
    }
  }
}
