import { RAOProtocol } from "./schema"
import { randomUUID } from "crypto"

export namespace EvidenceFactory {
  export function createFromAudit(
    runId: string,
    findingId: string,
    title: string,
    status: string,
    isBlocking: boolean,
  ): RAOProtocol.EvidenceReceipt {
    return {
      receiptId: `evd_${randomUUID()}`,
      runId,
      claim: isBlocking ? `Failed Audit: ${title}` : `Audit Passed: ${title}`,
      proof: JSON.stringify({ findingId, status, isBlocking }),
      source: "dax_audit_engine",
      verifiedAt: new Date().toISOString(),
    }
  }

  export function createFromApproval(
    runId: string,
    approvalId: string,
    decision: string,
    actorId?: string,
  ): RAOProtocol.EvidenceReceipt {
    return {
      receiptId: `evd_${randomUUID()}`,
      runId,
      claim: `Approval ${decision.toUpperCase()} for ${approvalId}`,
      proof: JSON.stringify({ approvalId, decision, actorId: actorId ?? "unknown" }),
      source: "dax_operator_plane",
      verifiedAt: new Date().toISOString(),
    }
  }
}
