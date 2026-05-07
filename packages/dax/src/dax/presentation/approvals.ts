import type { ApprovalRecord } from "@/server/run-contract"

/**
 * Shared predicate for "is this approval still actionable?"
 *
 * Approval records remain in the projected run after resolution as
 * historical entries (status = approved | denied | expired | cancelled).
 * Every UI surface that shows actionable work must filter to status =
 * "pending" before counting or rendering.
 *
 * Anything without a `status` field defaults to NOT pending — defensive
 * default so partial / mapped shapes never inflate the count.
 */
export type ApprovalLike = { status?: ApprovalRecord["status"] | string | null }

export function isPendingApproval(approval: ApprovalLike): boolean {
  return approval.status === "pending"
}

export function pendingApprovals<T extends ApprovalLike>(approvals: ReadonlyArray<T>): T[] {
  return approvals.filter(isPendingApproval)
}

export function pendingApprovalCount<T extends ApprovalLike>(
  approvals: ReadonlyArray<T>,
  questionCount = 0,
): number {
  return pendingApprovals(approvals).length + questionCount
}
