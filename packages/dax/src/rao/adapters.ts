import type { Approval as InternalApproval } from "@/approval/approval-types"
import type { ExecutionContract as InternalExecutionContract } from "@/execution/execution-contract"
import type { RunState as InternalRunState, StepRecord } from "@/state/run-state"
import { RAOProtocol } from "./schema"

export namespace RAOAdapter {
  export function toRAORunState(internal: InternalRunState): RAOProtocol.RunState {
    let status: RAOProtocol.RunState["status"] = "failed"
    switch (internal.status) {
      case "created":
      case "compiled":
        status = "planned"
        break
      case "queued":
      case "running":
        status = "running"
        break
      case "waiting_approval":
        status = "waiting_approval"
        break
      case "completed":
        status = "verified"
        break
      case "failed":
      case "cancelled":
        status = "failed"
        break
      default:
        status = "failed"
    }

    let currentStep: RAOProtocol.Step | undefined
    if (internal.currentStepId) {
      const step = internal.steps.find((s: StepRecord) => s.stepId === internal.currentStepId)
      if (step) {
        currentStep = {
          stepId: step.stepId,
          description: step.title,
          status: mapStepStatus(step.status),
        }
      }
    }

    return {
      runId: internal.runId,
      status,
      currentStep,
      evidence: buildEvidence(internal),
    }
  }

  /**
   * Evidence is drawn from what the run actually recorded, never invented. A run
   * that recorded nothing verifiable yields an empty list rather than a
   * placeholder receipt — an honest empty beats evidence theater. Each receipt
   * references the real ledger receipt ids the run captured (completion proof,
   * DAX-run verification, mutation ledger), so a consumer can resolve the full
   * proof from the ledger by id.
   */
  function buildEvidence(internal: InternalRunState): RAOProtocol.EvidenceReceipt[] {
    const receipts: RAOProtocol.EvidenceReceipt[] = []
    const gov = internal.governance
    const verifiedAt = internal.completedAt ?? internal.updatedAt ?? internal.createdAt

    const proof = gov.completionProof
    if (proof) {
      receipts.push({
        receiptId: `evd_completion_${internal.runId}`,
        runId: internal.runId,
        claim: `Completion proof ${proof.decision}`,
        proof: JSON.stringify({
          decision: proof.decision,
          verificationExecuted: proof.verificationExecuted,
          receiptIds: proof.receiptIds,
          failedChecks: proof.failedChecks,
        }),
        source: "dax_completion_proof",
        verifiedAt: proof.checkedAt,
      })
    }

    if (gov.verification.receiptIds.length > 0) {
      receipts.push({
        receiptId: `evd_verification_${internal.runId}`,
        runId: internal.runId,
        claim: gov.verification.satisfied ? "Verification satisfied" : "Verification recorded",
        proof: JSON.stringify({
          satisfied: gov.verification.satisfied,
          receiptIds: gov.verification.receiptIds,
        }),
        source: "dax_verification",
        verifiedAt,
      })
    }

    if (gov.mutationReceiptIds.length > 0) {
      receipts.push({
        receiptId: `evd_mutation_${internal.runId}`,
        runId: internal.runId,
        claim: `Mutations recorded (${gov.mutationReceiptIds.length})`,
        proof: JSON.stringify({ receiptIds: gov.mutationReceiptIds }),
        source: "dax_mutation_ledger",
        verifiedAt,
      })
    }

    return receipts
  }

  function mapStepStatus(status: StepRecord["status"]): RAOProtocol.Step["status"] {
    switch (status) {
      case "proposed":
      case "blocked":
        return "pending"
      case "running":
        return "running"
      case "completed":
        return "completed"
      case "failed":
        return "failed"
      default:
        return "failed"
    }
  }

  export function toRAOApprovalRequest(internal: InternalApproval): RAOProtocol.ApprovalRequest {
    const proposedTool = internal.context?.toolName || internal.context?.command || internal.type
    return {
      approvalId: internal.approvalId,
      runId: internal.runId,
      reason: internal.reason,
      proposedAction: {
        tool: proposedTool,
        parameters: {
          filePath: internal.context?.filePath,
          command: internal.context?.command,
        },
      },
      risk: internal.risk,
      diffPreview: internal.context?.diffPreview
        ? buildDiffPreview(internal.context.diffPreview)
        : undefined,
    }
  }

  function buildDiffPreview(patch: string): { filesChanged: number; additions: number; deletions: number; patch: string } {
    const gitHeaders = (patch.match(/^diff --git /gm) ?? []).length
    const unifiedHeaders = (patch.match(/^--- /gm) ?? []).length
    const filesChanged = Math.max(1, gitHeaders > 0 ? gitHeaders : unifiedHeaders)
    const additions = (patch.match(/^\+(?!\+\+)/gm) ?? []).length
    const deletions = (patch.match(/^-(?!--)/gm) ?? []).length
    return { filesChanged, additions, deletions, patch }
  }

  export function toRAORunRequest(internal: InternalExecutionContract): RAOProtocol.RunRequest {
    return {
      intent: internal.intent,
      scope: {
        projectId: internal.projectId || "unknown-project",
        directories: internal.repoPath ? [internal.repoPath] : undefined,
      },
      actor: {
        id: internal.initiatedBy || "system",
        type: "system", // Defaulting to system unless actor type is specifically tracked
      },
      riskProfile: {
        level: internal.riskLevel,
        factors: [], // Risk factors to be populated from internal policies
      },
      allowedTools: internal.toolAllowlist.map((tool: string) => ({
        name: tool,
      })),
    }
  }
}
