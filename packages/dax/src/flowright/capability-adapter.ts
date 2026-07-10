import { createHash } from "node:crypto"
import type {
  ApprovalRecord,
  ArtifactRecord,
  RunEvent,
  RunSnapshot,
  WorkflowTerminalReason,
} from "@/server/run-contract"
import type { CapabilityApproval, CapabilityArtifactRef, CapabilityFailureCode, CapabilityRunReceipt } from "./capability-contract"
import { CAPABILITY_CONTRACT_VERSION } from "./capability-contract"

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
}): string {
  const evidenceBundle = {
    contract: "dax.flowright.evidence.v0",
    snapshot: {
      runId: input.snapshot.runId,
      authority: input.snapshot.authority,
      status: input.snapshot.status,
      workflow: input.snapshot.workflow,
      terminalReason: input.snapshot.terminalReason,
      lastEvent: input.snapshot.lastEvent,
    },
    approvals: input.approvals.map((approval) => ({
      approvalId: approval.approvalId,
      status: approval.status,
      risk: approval.risk,
      title: approval.title,
      updatedAt: approval.updatedAt,
    })),
    artifacts: input.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      type: artifact.type,
      title: artifact.title,
      path: artifact.path,
      createdAt: artifact.createdAt,
    })),
    eventTail: input.events.slice(-25).map((event) => ({
      eventId: event.eventId,
      sequence: event.sequence,
      type: event.type,
      timestamp: event.timestamp,
    })),
  }

  return `sha256:${createHash("sha256").update(JSON.stringify(evidenceBundle)).digest("hex")}`
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
    evidenceDigest: computeEvidenceDigest(input),
    artifacts: toCapabilityArtifacts(input.artifacts),
    approvals: toCapabilityApprovals(input.approvals),
    failure,
    deepLink: input.deepLink,
  }
}
