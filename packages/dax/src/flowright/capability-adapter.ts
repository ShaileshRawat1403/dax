import type {
  ApprovalRecord,
  ArtifactRecord,
  RunEvent,
  RunSnapshot,
  WorkflowTerminalReason,
} from "@/server/run-contract"
import type { CapabilityApproval, CapabilityArtifactRef, CapabilityFailureCode, CapabilityRunReceipt } from "./capability-contract"
import { CAPABILITY_CONTRACT_VERSION } from "./capability-contract"
import { buildEvidenceRecords, computeBundleDigest } from "./evidence-export"

export function mapCapabilityFailureCode(input: {
  status: RunSnapshot["status"]
  terminalReason?: WorkflowTerminalReason
}): CapabilityFailureCode {
  switch (input.terminalReason) {
    case "workflow_rejected":
      return "approval_rejected"
    case "permission_denied":
      return "policy_denied"
    case "timeout":
      return "capability_timeout"
    case "contract_mutation":
      return "receipt_invalid"
    case "execution_error":
    case "workflow_failed":
      return "verification_failed"
    case "workflow_expired":
    case "workflow_cancelled":
    case "workflow_completed":
    case "workflow_signed_off":
    default:
      return input.status === "cancelled" ? "invocation_rejected" : "verification_failed"
  }
}

export function toCapabilityTerminalState(snapshot: RunSnapshot): CapabilityRunReceipt["terminalState"] {
  if (snapshot.pendingApprovalCount > 0 || snapshot.status === "waiting_approval") return "needs_approval"
  if (snapshot.status === "completed") return "succeeded"
  if (snapshot.status === "cancelled") return "cancelled"
  return "failed"
}

export function toCapabilityApprovals(approvals: ApprovalRecord[]): CapabilityApproval[] {
  return approvals.map((approval) => ({
    gateId: approval.approvalId,
    status:
      approval.status === "approved"
        ? "approved"
        : approval.status === "denied" || approval.status === "cancelled" || approval.status === "expired"
          ? "rejected"
          : "pending",
    summary: [approval.title, approval.reason].filter(Boolean).join(": "),
  }))
}

export function toCapabilityArtifacts(artifacts: ArtifactRecord[]): CapabilityArtifactRef[] {
  return artifacts.map((artifact) => ({
    ref: artifact.path ?? artifact.links?.self ?? artifact.artifactId,
    type: artifact.type,
    digest: typeof artifact.metadata?.digest === "string" ? artifact.metadata.digest : undefined,
    title: artifact.title,
  }))
}

export function computeEvidenceDigest(input: {
  snapshot: RunSnapshot
  approvals: ApprovalRecord[]
  artifacts: ArtifactRecord[]
  events: RunEvent[]
  invocationId?: string
}): string {
  // runledger.evidence.v0 bundle digest: sha256 over the canonical array of
  // the exported records' body digests. Recomputable by any caller that
  // fetches the evidence export — the receipt digest stops being opaque.
  return computeBundleDigest(buildEvidenceRecords(input))
}

export function buildCapabilityReceipt(input: {
  capability: string
  invocationId: string
  snapshot: RunSnapshot
  approvals: ApprovalRecord[]
  artifacts: ArtifactRecord[]
  events: RunEvent[]
  deepLink?: string
  timeoutReason?: string
}): CapabilityRunReceipt {
  const terminalState = input.timeoutReason ? "failed" : toCapabilityTerminalState(input.snapshot)
  const failure =
    terminalState === "failed"
      ? {
          code: input.timeoutReason
            ? ("capability_timeout" as const)
            : mapCapabilityFailureCode({
                status: input.snapshot.status,
                terminalReason: input.snapshot.terminalReason,
              }),
          reason:
            input.timeoutReason ??
            input.snapshot.terminalReason ??
            `DAX run ended with status ${input.snapshot.status}`,
          retryable: input.timeoutReason ? true : input.snapshot.terminalReason !== "permission_denied",
        }
      : undefined

  return {
    contractVersion: CAPABILITY_CONTRACT_VERSION,
    capability: input.capability,
    invocationId: input.invocationId,
    externalRunId: input.snapshot.runId,
    authority: "dax",
    terminalState,
    startedAt: input.snapshot.startedAt ?? input.snapshot.createdAt,
    completedAt: input.timeoutReason ? new Date().toISOString() : input.snapshot.completedAt,
    evidenceDigest: computeEvidenceDigest({ ...input, invocationId: input.invocationId }),
    artifacts: toCapabilityArtifacts(input.artifacts),
    approvals: toCapabilityApprovals(input.approvals),
    failure,
    deepLink: input.deepLink,
  }
}
