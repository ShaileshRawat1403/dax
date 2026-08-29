import {
  RunSnapshot,
  ApprovalRecord,
  ArtifactRecord,
  RunEvent,
  ProjectedRun,
  RunHeaderProjection,
  RunNarrativeItem,
  RunIntervention,
  InterventionKind,
  ProposedChange,
  RunSummary,
} from "./run-contract"

function interventionKindTitle(kind: InterventionKind | string | undefined): string {
  switch (kind) {
    case "approval":
      return "Approval review"
    case "ambiguity":
      return "Needs direction"
    case "recovery":
      return "Needs recovery"
    case "policy_violation":
      return "Policy blocked"
    case "risk_escalation":
      return "Risk escalated"
    default:
      // Defensive: the bus enum (hitl_task / error_recovery) and the contract
      // enum diverged historically. The gateway maps bus values to contract
      // values at appendEvent time, but if a new producer leaks a non-contract
      // value here, fall back to a generic label instead of "undefined: ...".
      return "Intervention"
  }
}

export function buildHeaderProjection(snapshot: RunSnapshot, interventions: RunIntervention[]): RunHeaderProjection {
  const activeInterventions = interventions.filter((i) => i.status === "requested" || i.status === "pending")

  const interventionSummary =
    activeInterventions.length > 0
      ? {
          activeCount: activeInterventions.length,
          primaryKind: activeInterventions[0].kind,
          message: activeInterventions[0].reason,
        }
      : undefined

  return {
    runId: snapshot.runId,
    title: snapshot.title,
    status: snapshot.status,
    currentStep: snapshot.currentStep,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    interventionSummary,
  }
}

export function buildInterventionProjection(events: RunEvent[]): RunIntervention[] {
  const interventions = new Map<string, RunIntervention>()

  for (const event of events) {
    if (event.type === "intervention.required") {
      const { interventionId, reason, kind, approvalId, metadata } = event.payload
      interventions.set(interventionId, {
        interventionId,
        runId: event.runId,
        kind,
        status: "requested",
        title: interventionKindTitle(kind),
        reason,
        createdAt: event.timestamp,
        approvalId,
        metadata,
      })
    } else if (event.type === "intervention.resolved") {
      const { interventionId, status, resolvedAt } = event.payload
      const existing = interventions.get(interventionId)
      if (existing) {
        existing.status = status
        existing.resolvedAt = resolvedAt
      }
    }
  }

  return Array.from(interventions.values()).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
}

export function buildProposedChangesProjection(approvals: ApprovalRecord[]): ProposedChange[] {
  const changes: ProposedChange[] = []

  for (const approval of approvals) {
    if (approval.context?.diffPreview) {
      const type: ProposedChange["type"] = approval.type === "patch_apply" ? "patch" : "file_edit"

      const status: ProposedChange["status"] =
        approval.status === "pending"
          ? "pending"
          : approval.status === "approved"
            ? "approved_not_applied"
            : approval.status === "denied"
              ? "rejected"
              : "stale"

      changes.push({
        changeId: `chg_${approval.approvalId}`,
        runId: approval.runId,
        approvalId: approval.approvalId,
        stepId: approval.context.stepId,
        type,
        filePath: approval.context.filePath ?? "unknown",
        diff: approval.context.diffPreview,
        status,
        createdAt: approval.createdAt,
      })
    }
  }

  return changes
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

export function mapEventToNarrativeItem(event: RunEvent): RunNarrativeItem | undefined {
  const { type, payload, timestamp, eventId } = event

  switch (type) {
    case "run.created":
      return {
        id: eventId,
        timestamp,
        type: "run.created",
        message: "Session initialized",
        metadata: { title: payload.title },
      }
    case "run.started":
      return {
        id: eventId,
        timestamp,
        type: "run.started",
        message: "Workstation active: beginning execution",
      }
    case "run.completed":
      return {
        id: eventId,
        timestamp,
        type: "run.completed",
        message: "Goal reached: execution successful",
      }
    case "run.failed":
      return {
        id: eventId,
        timestamp,
        type: "run.failed",
        message: payload.error?.message ?? "unknown failure",
        metadata: { error: payload.error },
      }
    case "intent.created":
      return {
        id: eventId,
        timestamp,
        type: "intent.created",
        message: payload.goal,
        metadata: { intentType: payload.intentType, confidence: payload.confidence },
      }
    case "plan.compiled":
      return {
        id: eventId,
        timestamp,
        type: "plan.compiled",
        message: `Strategy locked: ${payload.tasks?.length ?? 0} tasks mapped`,
        metadata: { planId: payload.planId },
      }
    case "step.proposed":
      return {
        id: eventId,
        timestamp,
        type: "step.proposed",
        message: `Preparing step: ${payload.title}`,
        metadata: { stepId: payload.stepId, detail: payload.detail },
      }
    case "step.started":
      return {
        id: eventId,
        timestamp,
        type: "step.started",
        message: payload.title,
        metadata: { stepId: payload.stepId },
      }
    case "step.completed":
      return {
        id: eventId,
        timestamp,
        type: "step.completed",
        message: payload.title,
        metadata: { stepId: payload.stepId, durationMs: payload.durationMs },
      }
    case "step.failed":
      return {
        id: eventId,
        timestamp,
        type: "step.failed",
        message: `Step failed: ${payload.title} (${payload.error?.message})`,
        metadata: { stepId: payload.stepId, error: payload.error },
      }
    case "approval.requested":
      return {
        id: eventId,
        timestamp,
        type: "approval.requested",
        message: `Policy Gate: ${payload.approval?.title} (${payload.approval?.risk.toUpperCase()} RISK)`,
        metadata: { approvalId: payload.approval?.approvalId, risk: payload.approval?.risk },
      }
    case "approval.resolved":
      return {
        id: eventId,
        timestamp,
        type: "approval.resolved",
        message: `Gate resolved: ${payload.decision === "approve" ? "APPROVED" : "DENIED"}`,
        metadata: { approvalId: payload.approvalId, decision: payload.decision, comment: payload.comment },
      }
    case "artifact.created":
      return {
        id: eventId,
        timestamp,
        type: "artifact.created",
        message: `Evidence produced: ${payload.artifact?.title}`,
        metadata: { artifactId: payload.artifact?.artifactId, artifactType: payload.artifact?.type },
      }
    case "audit.posture_updated":
      return {
        id: eventId,
        timestamp,
        type: "audit.posture_updated",
        message: `Trust status: ${payload.trust?.posture?.toUpperCase() ?? "UNKNOWN"}`,
        metadata: { score: payload.trust?.score, finding: payload.finding },
      }
    case "intervention.required":
      return {
        id: eventId,
        timestamp,
        type: "intervention.required",
        message: `${interventionKindTitle(payload.kind)}: ${payload.reason}`,
        metadata: { kind: payload.kind, approvalId: payload.approvalId },
      }
    case "intervention.resolved":
      return {
        id: eventId,
        timestamp,
        type: "intervention.resolved",
        message: `Intervention ${payload.status}: ${payload.comment ?? "Operator review completed"}`,
        metadata: { interventionId: payload.interventionId, status: payload.status },
      }
    default:
      return undefined
  }
}

export function buildProjectedRun(
  snapshot: RunSnapshot,
  events: RunEvent[],
  approvals: ApprovalRecord[],
  artifacts: ArtifactRecord[],
  summary?: RunSummary,
  options?: { compatibilityEventsAreNarrativeOnly?: boolean },
): ProjectedRun {
  // Event-authority runs may still expose the compatibility stream as UI/SSE
  // narration. Those records cannot create authoritative interventions absent
  // from canonical history, so only legacy runs project interventions from it.
  const interventions = options?.compatibilityEventsAreNarrativeOnly ? [] : buildInterventionProjection(events)
  const proposedChanges = buildProposedChangesProjection(approvals)
  return {
    header: buildHeaderProjection(snapshot, interventions),
    summary,
    narrative: buildNarrativeProjection(events),
    approvals,
    artifacts,
    interventions,
    proposedChanges,
  }
}
