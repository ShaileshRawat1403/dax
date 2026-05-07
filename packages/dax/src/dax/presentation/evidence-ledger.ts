import type {
  ArtifactRecord,
  ApprovalRecord,
  ProposedChange,
  RunIntervention,
  RunNarrativeItem,
  ProjectedRun,
} from "@/server/run-contract"

export type EvidenceKind = "artifact" | "approval" | "proposed_change" | "audit" | "intervention" | "step"

export type EvidenceStatus =
  | "observed"
  | "produced"
  | "pending"
  | "approved"
  | "denied"
  | "verified"
  | "warning"
  | "blocked"
  | "failed"

export type EvidenceSeverity = "neutral" | "info" | "success" | "warning" | "error"

export type EvidenceLedgerItem = {
  id: string
  runId: string
  timestamp: string
  kind: EvidenceKind
  title: string
  detail?: string
  proofLabel?: string
  proofRef?: string
  status: EvidenceStatus
  severity: EvidenceSeverity
  inspectable: boolean
  metadata?: Record<string, unknown>
}

export function buildEvidenceLedger(run: ProjectedRun | undefined): EvidenceLedgerItem[] {
  if (!run) return []

  const runId = run.header.runId

  const items: EvidenceLedgerItem[] = [
    ...run.artifacts.map(mapArtifactToEvidence),
    ...run.approvals.map(mapApprovalToEvidence),
    ...run.proposedChanges.map(mapProposedChangeToEvidence),
    ...run.interventions.map(mapInterventionToEvidence),
    ...run.narrative.filter(isEvidenceNarrativeItem).map((item) => mapNarrativeToEvidence(item, runId)),
  ]

  return dedupeEvidence(items).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
}

function mapArtifactToEvidence(artifact: ArtifactRecord): EvidenceLedgerItem {
  return {
    id: `artifact:${artifact.artifactId}`,
    runId: artifact.runId,
    timestamp: artifact.createdAt,
    kind: "artifact",
    title: `Artifact produced: ${artifact.title}`,
    detail: artifact.path ?? artifact.preview?.text,
    proofLabel: artifact.type,
    proofRef: artifact.artifactId,
    status: "produced",
    severity: "success",
    inspectable: Boolean(artifact.path || artifact.preview || artifact.links),
    metadata: artifact.metadata,
  }
}

function mapApprovalToEvidence(approval: ApprovalRecord): EvidenceLedgerItem {
  const status: EvidenceStatus =
    approval.status === "approved"
      ? "approved"
      : approval.status === "denied"
        ? "denied"
        : approval.status === "pending"
          ? "pending"
          : "observed"

  const severity: EvidenceSeverity =
    approval.status === "denied" ? "error" : approval.status === "pending" ? "warning" : "success"

  return {
    id: `approval:${approval.approvalId}`,
    runId: approval.runId,
    timestamp: approval.resolvedAt ?? approval.createdAt,
    kind: "approval",
    title: `Approval ${approval.status}: ${approval.title}`,
    detail: approval.reason,
    proofLabel: `${approval.risk} risk`,
    proofRef: approval.approvalId,
    status,
    severity,
    inspectable: Boolean(approval.context),
    metadata: {
      type: approval.type,
      context: approval.context,
      resolution: approval.resolution,
    },
  }
}

function mapProposedChangeToEvidence(change: ProposedChange): EvidenceLedgerItem {
  const status: EvidenceStatus =
    change.status === "rejected"
      ? "denied"
      : change.status === "applied"
        ? "verified"
        : change.status === "pending" || change.status === "approved_not_applied"
          ? "pending"
          : "observed" // stale

  const severity: EvidenceSeverity =
    change.status === "rejected" ? "error" : change.status === "pending" ? "warning" : "info"

  return {
    id: `change:${change.changeId}`,
    runId: change.runId,
    timestamp: change.createdAt,
    kind: "proposed_change",
    title: `Proposed change: ${change.filePath}`,
    detail: change.type.replace(/_/g, " "),
    proofLabel: change.status,
    proofRef: change.changeId,
    status,
    severity,
    inspectable: Boolean(change.diff),
    metadata: {
      approvalId: change.approvalId,
      stepId: change.stepId,
      diff: change.diff,
    },
  }
}

function mapInterventionToEvidence(intervention: RunIntervention): EvidenceLedgerItem {
  const status: EvidenceStatus =
    intervention.status === "resolved"
      ? "verified"
      : intervention.status === "escalated"
        ? "blocked"
        : "pending"

  const severity: EvidenceSeverity =
    intervention.status === "resolved"
      ? "success"
      : intervention.status === "escalated"
        ? "error"
        : "warning"

  return {
    id: `intervention:${intervention.interventionId}`,
    runId: intervention.runId,
    timestamp: intervention.resolvedAt ?? intervention.createdAt,
    kind: "intervention",
    title: intervention.title,
    detail: intervention.reason,
    proofLabel: intervention.kind,
    proofRef: intervention.interventionId,
    status,
    severity,
    inspectable: Boolean(intervention.metadata || intervention.approvalId),
    metadata: intervention.metadata,
  }
}

// Only narrative types that represent governance proof worth surfacing.
// Excludes step.completed to avoid flooding the ledger on long runs.
// Excludes artifact.created because artifacts are already mapped from run.artifacts.
const EVIDENCE_NARRATIVE_TYPES = new Set([
  "audit.posture_updated",
  "step.failed",
  "run.completed",
  "run.failed",
])

function isEvidenceNarrativeItem(item: RunNarrativeItem): boolean {
  return EVIDENCE_NARRATIVE_TYPES.has(item.type)
}

function mapNarrativeToEvidence(item: RunNarrativeItem, runId: string): EvidenceLedgerItem {
  if (item.type === "audit.posture_updated") {
    const score = typeof item.metadata?.score === "number" ? item.metadata.score : undefined
    return {
      id: `audit:${item.id}`,
      runId,
      timestamp: item.timestamp,
      kind: "audit",
      title: item.message,
      detail: typeof item.metadata?.finding === "object" && item.metadata.finding !== null
        ? String((item.metadata.finding as Record<string, unknown>).title ?? "")
        : undefined,
      proofLabel: score !== undefined ? `score ${score}` : "trust update",
      proofRef: item.id,
      status: "observed",
      severity: "info",
      inspectable: Boolean(item.metadata),
      metadata: item.metadata,
    }
  }

  if (item.type === "step.failed" || item.type === "run.failed") {
    return {
      id: `event:${item.id}`,
      runId,
      timestamp: item.timestamp,
      kind: "step",
      title: item.message,
      proofLabel: item.type,
      proofRef: item.id,
      status: "failed",
      severity: "error",
      inspectable: Boolean(item.metadata),
      metadata: item.metadata,
    }
  }

  // run.completed
  return {
    id: `event:${item.id}`,
    runId,
    timestamp: item.timestamp,
    kind: "step",
    title: item.message,
    proofLabel: item.type,
    proofRef: item.id,
    status: "verified",
    severity: "success",
    inspectable: Boolean(item.metadata),
    metadata: item.metadata,
  }
}

function dedupeEvidence(items: EvidenceLedgerItem[]): EvidenceLedgerItem[] {
  const seen = new Set<string>()
  const result: EvidenceLedgerItem[] = []
  for (const item of items) {
    const key = item.proofRef ? `${item.kind}:${item.proofRef}` : item.id
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

export function evidenceSeverityGlyph(severity: EvidenceSeverity): string {
  switch (severity) {
    case "success":
      return "✓"
    case "warning":
      return "⚠"
    case "error":
      return "✕"
    case "info":
      return "●"
    case "neutral":
      return "○"
  }
}
