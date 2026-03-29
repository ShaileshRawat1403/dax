import {
  RunSnapshot,
  ApprovalRecord,
  ArtifactRecord,
  RunEvent,
  ProjectedRun,
  RunHeaderProjection,
  RunNarrativeItem,
} from "./run-contract"

export function buildHeaderProjection(snapshot: RunSnapshot): RunHeaderProjection {
  return {
    runId: snapshot.runId,
    title: snapshot.title,
    status: snapshot.status,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    targeting: snapshot.metadata?.targeting,
  }
}

export function buildNarrativeProjection(events: RunEvent[]): RunNarrativeItem[] {
  const narrative: RunNarrativeItem[] = []

  for (const event of events) {
    const item = mapEventToNarrativeItem(event)
    if (item) {
      narrative.push(item)
    }
  }

  return narrative
}

function mapEventToNarrativeItem(event: RunEvent): RunNarrativeItem | undefined {
  const { type, payload, timestamp, eventId } = event

  switch (type) {
    case "run.created":
      return {
        id: eventId,
        timestamp,
        type: "run.created",
        message: "Session created",
        metadata: { title: payload.title },
      }
    case "run.started":
      return {
        id: eventId,
        timestamp,
        type: "run.started",
        message: "Execution started",
      }
    case "run.completed":
      return {
        id: eventId,
        timestamp,
        type: "run.completed",
        message: "Session completed successfully",
      }
    case "run.failed":
      return {
        id: eventId,
        timestamp,
        type: "run.failed",
        message: `Session failed: ${payload.error?.message ?? "Unknown error"}`,
        metadata: { error: payload.error },
      }
    case "intent.created":
      return {
        id: eventId,
        timestamp,
        type: "intent.created",
        message: `Intent identified: ${payload.goal}`,
        metadata: { intentType: payload.intentType, confidence: payload.confidence },
      }
    case "plan.compiled":
      return {
        id: eventId,
        timestamp,
        type: "plan.compiled",
        message: `Plan compiled with ${payload.tasks?.length ?? 0} tasks`,
        metadata: { planId: payload.planId },
      }
    case "step.proposed":
      return {
        id: eventId,
        timestamp,
        type: "step.proposed",
        message: `Proposed step: ${payload.title}`,
        metadata: { stepId: payload.stepId, detail: payload.detail },
      }
    case "step.started":
      return {
        id: eventId,
        timestamp,
        type: "step.started",
        message: `Starting step: ${payload.title}`,
        metadata: { stepId: payload.stepId },
      }
    case "step.completed":
      return {
        id: eventId,
        timestamp,
        type: "step.completed",
        message: `Completed step: ${payload.title}`,
        metadata: { stepId: payload.stepId, durationMs: payload.durationMs },
      }
    case "step.failed":
      return {
        id: eventId,
        timestamp,
        type: "step.failed",
        message: `Step failed: ${payload.title} - ${payload.error?.message}`,
        metadata: { stepId: payload.stepId, error: payload.error },
      }
    case "approval.requested":
      return {
        id: eventId,
        timestamp,
        type: "approval.requested",
        message: `Approval requested: ${payload.approval?.title}`,
        metadata: { approvalId: payload.approval?.approvalId, risk: payload.approval?.risk },
      }
    case "approval.resolved":
      return {
        id: eventId,
        timestamp,
        type: "approval.resolved",
        message: `Approval resolved: ${payload.decision === "approve" ? "Approved" : "Denied"}`,
        metadata: { approvalId: payload.approvalId, decision: payload.decision, comment: payload.comment },
      }
    case "artifact.created":
      return {
        id: eventId,
        timestamp,
        type: "artifact.created",
        message: `Artifact produced: ${payload.artifact?.title}`,
        metadata: { artifactId: payload.artifact?.artifactId, artifactType: payload.artifact?.type },
      }
    case "audit.posture_updated":
      return {
        id: eventId,
        timestamp,
        type: "audit.posture_updated",
        message: `Trust posture updated to ${payload.trust?.posture ?? "unknown"}`,
        metadata: { score: payload.trust?.score, finding: payload.finding },
      }
    case "intervention.required":
      return {
        id: eventId,
        timestamp,
        type: "intervention.required",
        message: `Intervention required: ${payload.reason}`,
        metadata: { type: payload.type, approvalId: payload.approvalId },
      }
    default:
      return undefined
  }
}

export function buildProjectedRun(
  snapshot: RunSnapshot,
  events: RunEvent[],
  approvals: ApprovalRecord[],
  artifacts: ArtifactRecord[]
): ProjectedRun {
  return {
    header: buildHeaderProjection(snapshot),
    narrative: buildNarrativeProjection(events),
    approvals,
    artifacts,
  }
}
