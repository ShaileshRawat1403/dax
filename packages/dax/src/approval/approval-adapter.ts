import type { Approval } from "./approval-types"
import type { ApprovalRecord } from "../server/run-contract"

/**
 * Adapts internal Approval objects to the external v1 ApprovalRecord contract.
 */
export function toApprovalRecordV1(approval: Approval): ApprovalRecord {
  return {
    approvalId: approval.approvalId,
    runId: approval.runId,
    type: approval.type,
    status: approval.status as any,
    risk: approval.risk as any,
    title: approval.title,
    reason: approval.reason,
    context: approval.context ? {
      stepId: approval.context.stepId,
      filePath: approval.context.filePath,
      command: approval.context.command,
      toolName: approval.context.toolName,
      diffPreview: approval.context.diffPreview,
      notes: approval.context.notes,
    } : undefined,
    createdAt: approval.requestedAt,
    updatedAt: approval.resolvedAt ?? approval.requestedAt,
    resolvedAt: approval.resolvedAt ?? undefined,
    resolution: approval.resolution ? {
      decision: approval.resolution.decision as any,
      actorId: approval.resolution.actorId,
      source: approval.source as any,
      comment: approval.resolution.comment,
    } : undefined,
  }
}
