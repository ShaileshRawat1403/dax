import { CONTRACT_GRANT_APPROVAL_TYPE } from "./contract-grant-approval"
import type { CanonicalRunState } from "./run-reducer"

/**
 * Replay validates every replacement edge. Completion additionally requires
 * its entire chain to terminate at the exact currently proven approval. Caller
 * obtains that ID from the common reviewed loader, never private status alone.
 */
export function supersededReviewApprovals(state: CanonicalRunState, provenApprovalId: string): Set<string> {
  const result = new Set<string>()
  const published = state.grantReview.published
  const activated = state.grantReview.activated
  const current = state.approvals.find((item) => item.approvalId === provenApprovalId)
  if (
    !published ||
    !activated ||
    published.approvalId !== provenApprovalId ||
    activated.revision !== published.revision ||
    activated.contractDigest !== published.contractDigest ||
    current?.status !== "approved" ||
    current.approvalType !== CONTRACT_GRANT_APPROVAL_TYPE
  )
    return result
  for (const approval of state.approvals) {
    let cursor = approval
    const seen = new Set<string>()
    while (cursor.approvalId !== provenApprovalId) {
      if (
        seen.has(cursor.approvalId) ||
        cursor.status !== "expired" ||
        cursor.approvalType !== CONTRACT_GRANT_APPROVAL_TYPE ||
        !cursor.supersededByApprovalId
      )
        break
      seen.add(cursor.approvalId)
      const next = state.approvals.find((item) => item.approvalId === cursor.supersededByApprovalId)
      if (!next) break
      cursor = next
    }
    if (cursor.approvalId === provenApprovalId && approval.status === "expired") result.add(approval.approvalId)
  }
  return result
}
