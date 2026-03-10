import { EOL } from "os"
import { Audit } from "../audit"
import { RAOLedger } from "../rao"
import { Session } from "../session"
import { Instance } from "../project/instance"
import { Locale } from "../util/locale"
import { buildArtifactsForSession } from "../cli/cmd/artifacts"

export type VerificationResult =
  | "verification_passed"
  | "verification_failed"
  | "verification_incomplete"
  | "verification_degraded"

export type VerificationTrustPosture = "review_needed" | "policy_clean" | "verified"

export type VerificationCheckStatus = "pass" | "fail" | "incomplete" | "degraded"

export type VerificationCheckID =
  | "approvals"
  | "policy_compliance"
  | "artifacts_present"
  | "evidence_completeness"
  | "findings_resolution"
  | "overrides_justified"
  | "trace_continuity"

export type VerificationCheck = {
  id: VerificationCheckID
  label: string
  status: VerificationCheckStatus
  summary: string
}

export type SessionVerificationSignals = {
  session_id: string
  project_id?: string
  audit: {
    present: boolean
    status?: Audit.Status
    blocker_count: number
    warning_count: number
    info_count: number
  }
  approvals: {
    pending_count: number
  }
  overrides: {
    count: number
  }
  evidence: {
    diff_present: boolean
    artifacts_present: boolean
    artifact_count: number
  }
  trace: {
    assistant_message_count: number
    latest_activity_at?: number
  }
}

export type SessionVerification = {
  type: "session_verification"
  project_id: string
  session_id: string
  verification_result: VerificationResult
  trust_posture: VerificationTrustPosture
  checks: VerificationCheck[]
  blocking_factors: string[]
  degrading_factors: string[]
  latest_activity_at?: number
}

type LedgerEvent = Awaited<ReturnType<typeof RAOLedger.list>>[number]

export async function collectSessionVerification(sessionID: string): Promise<SessionVerification> {
  const session = await Session.get(sessionID)
  const [messages, diffs, pendingApprovals, events] = await Promise.all([
    Session.messages({ sessionID }),
    Session.diff(sessionID),
    listPendingApprovals(sessionID),
    RAOLedger.list({
      project_id: Instance.project.id,
      limit: 200,
    }).then((rows) => rows.filter((row) => row.session_id === sessionID)),
  ])

  const artifacts = buildArtifactsForSession(session, messages, diffs)
  const latestAudit = latestAuditEvent(events)
  const latestActivityAt = latestActivityTimestamp({
    sessionUpdatedAt: session.time.updated,
    messageTimes: messages.map((message) => message.info.time.created),
    eventTimes: events.map((row) => row.created_at),
    artifactTimes: artifacts.map((artifact) => artifact.created_at).filter((value): value is number => typeof value === "number"),
  })

  return evaluateSessionVerification({
    session_id: sessionID,
    project_id: Instance.project.id,
    approvals: {
      pending_count: pendingApprovals.length,
    },
    overrides: {
      count: events.filter((row) => row.event_type === "override").length,
    },
    evidence: {
      diff_present: diffs.length > 0,
      artifacts_present: artifacts.length > 0,
      artifact_count: artifacts.length,
    },
    audit: {
      present: !!latestAudit,
      status: latestAudit?.status,
      blocker_count: latestAudit?.blocker_count ?? 0,
      warning_count: latestAudit?.warning_count ?? 0,
      info_count: latestAudit?.info_count ?? 0,
    },
    trace: {
      assistant_message_count: messages.filter((message) => message.info.role === "assistant").length,
      latest_activity_at: latestActivityAt,
    },
  })
}

export function evaluateSessionVerification(input: SessionVerificationSignals): SessionVerification {
  const checks: VerificationCheck[] = [
    buildApprovalsCheck(input.approvals.pending_count),
    buildPolicyCheck(input.audit.present, input.audit.status, input.audit.blocker_count),
    buildArtifactsCheck(input.evidence.diff_present, input.evidence.artifacts_present, input.evidence.artifact_count),
    buildEvidenceCompletenessCheck({
      auditPresent: input.audit.present,
      diffPresent: input.evidence.diff_present,
      artifactsPresent: input.evidence.artifacts_present,
      assistantMessageCount: input.trace.assistant_message_count,
    }),
    buildFindingsCheck(input.audit.present, input.audit.blocker_count, input.audit.warning_count),
    buildOverridesCheck(input.overrides.count),
    buildTraceCheck(input.trace.assistant_message_count, input.trace.latest_activity_at),
  ]

  const blocking_factors = checks.filter((check) => check.status === "fail").map((check) => check.summary)
  const incomplete_factors = checks.filter((check) => check.status === "incomplete").map((check) => check.summary)
  const degrading_factors = checks.filter((check) => check.status === "degraded").map((check) => check.summary)

  const verification_result = deriveVerificationResult(checks)
  const trust_posture = deriveTrustPosture(verification_result)

  return {
    type: "session_verification",
    project_id: input.project_id ?? "unknown",
    session_id: input.session_id,
    verification_result,
    trust_posture,
    checks,
    blocking_factors,
    degrading_factors: [...incomplete_factors, ...degrading_factors],
    latest_activity_at: input.trace.latest_activity_at,
  }
}

export function formatSessionVerification(summary: SessionVerification) {
  const lines = [
    `Session: ${summary.session_id}`,
    `Verification: ${formatVerificationResult(summary.verification_result)}`,
    `Trust posture: ${formatTrustPosture(summary.trust_posture)}`,
    summary.latest_activity_at ? `Latest activity: ${Locale.todayTimeOrDateTime(summary.latest_activity_at)}` : undefined,
    "",
    "Checks",
    ...summary.checks.map((check) => `- ${check.label}: ${formatCheckStatus(check.status)}${check.summary ? ` — ${check.summary}` : ""}`),
  ].filter(Boolean)

  const summaryLines =
    summary.blocking_factors.length > 0
      ? summary.blocking_factors
      : summary.degrading_factors.length > 0
        ? summary.degrading_factors
        : ["All verification checks passed."]

  return [...lines, "", "Summary", ...summaryLines.map((line) => `- ${line}`)].join(EOL)
}

function deriveVerificationResult(checks: VerificationCheck[]): VerificationResult {
  if (checks.some((check) => check.status === "fail")) return "verification_failed"
  if (checks.some((check) => check.status === "incomplete")) return "verification_incomplete"
  if (checks.some((check) => check.status === "degraded")) return "verification_degraded"
  return "verification_passed"
}

function deriveTrustPosture(result: VerificationResult): VerificationTrustPosture {
  switch (result) {
    case "verification_passed":
      return "verified"
    case "verification_degraded":
      return "policy_clean"
    default:
      return "review_needed"
  }
}

function buildApprovalsCheck(pendingCount: number): VerificationCheck {
  if (pendingCount > 0) {
    return {
      id: "approvals",
      label: "Approvals",
      status: "incomplete",
      summary: `${pendingCount} pending approval${pendingCount === 1 ? "" : "s"} still require an operator decision.`,
    }
  }

  return {
    id: "approvals",
    label: "Approvals",
    status: "pass",
    summary: "No pending approvals remain.",
  }
}

function buildPolicyCheck(auditPresent: boolean, status: Audit.Status | undefined, blockerCount: number): VerificationCheck {
  if (!auditPresent || !status) {
    return {
      id: "policy_compliance",
      label: "Policy compliance",
      status: "incomplete",
      summary: "No policy evaluation has been recorded for this session yet.",
    }
  }

  if (status === "fail" || blockerCount > 0) {
    return {
      id: "policy_compliance",
      label: "Policy compliance",
      status: "fail",
      summary: "Policy checks reported blocking issues.",
    }
  }

  return {
    id: "policy_compliance",
    label: "Policy compliance",
    status: "pass",
    summary: "No blocking policy failures were recorded.",
  }
}

function buildArtifactsCheck(diffPresent: boolean, artifactsPresent: boolean, artifactCount: number): VerificationCheck {
  if (!diffPresent && !artifactsPresent) {
    return {
      id: "artifacts_present",
      label: "Artifacts present",
      status: "incomplete",
      summary: "No retained artifacts or session diff evidence were recorded.",
    }
  }

  if (diffPresent && artifactsPresent) {
    return {
      id: "artifacts_present",
      label: "Artifacts present",
      status: "pass",
      summary: `${artifactCount} retained artifact${artifactCount === 1 ? "" : "s"} and session diff evidence are available.`,
    }
  }

  return {
    id: "artifacts_present",
    label: "Artifacts present",
    status: "pass",
    summary: diffPresent ? "Session diff evidence is available." : `${artifactCount} retained artifact${artifactCount === 1 ? "" : "s"} recorded.`,
  }
}

function buildEvidenceCompletenessCheck(input: {
  auditPresent: boolean
  diffPresent: boolean
  artifactsPresent: boolean
  assistantMessageCount: number
}): VerificationCheck {
  if (input.auditPresent && input.diffPresent && input.artifactsPresent && input.assistantMessageCount > 0) {
    return {
      id: "evidence_completeness",
      label: "Evidence completeness",
      status: "pass",
      summary: "Execution, audit, and retained output evidence are all present.",
    }
  }

  return {
    id: "evidence_completeness",
    label: "Evidence completeness",
    status: "incomplete",
    summary: "The session does not yet contain a complete set of execution, audit, and retained output evidence.",
  }
}

function buildFindingsCheck(auditPresent: boolean, blockerCount: number, warningCount: number): VerificationCheck {
  if (!auditPresent) {
    return {
      id: "findings_resolution",
      label: "Findings resolution",
      status: "incomplete",
      summary: "No audit findings have been evaluated for this session yet.",
    }
  }

  if (blockerCount > 0) {
    return {
      id: "findings_resolution",
      label: "Findings resolution",
      status: "fail",
      summary: `${blockerCount} blocking finding${blockerCount === 1 ? "" : "s"} still need resolution.`,
    }
  }

  if (warningCount > 0) {
    return {
      id: "findings_resolution",
      label: "Findings resolution",
      status: "degraded",
      summary: `${warningCount} warning${warningCount === 1 ? "" : "s"} still require review.`,
    }
  }

  return {
    id: "findings_resolution",
    label: "Findings resolution",
    status: "pass",
    summary: "No unresolved audit findings remain.",
  }
}

function buildOverridesCheck(overrideCount: number): VerificationCheck {
  if (overrideCount > 0) {
    return {
      id: "overrides_justified",
      label: "Overrides justified",
      status: "degraded",
      summary: `${overrideCount} override decision${overrideCount === 1 ? " was" : "s were"} recorded and still require operator review.`,
    }
  }

  return {
    id: "overrides_justified",
    label: "Overrides justified",
    status: "pass",
    summary: "No override decisions were recorded.",
  }
}

function buildTraceCheck(assistantMessageCount: number, latestActivityAt?: number): VerificationCheck {
  if (assistantMessageCount > 0 && typeof latestActivityAt === "number") {
    return {
      id: "trace_continuity",
      label: "Trace continuity",
      status: "pass",
      summary: "The session contains a continuous execution trace.",
    }
  }

  return {
    id: "trace_continuity",
    label: "Trace continuity",
    status: "incomplete",
    summary: "The recorded session trace is too sparse to confirm continuity yet.",
  }
}

function formatVerificationResult(result: VerificationResult) {
  switch (result) {
    case "verification_passed":
      return "Verification passed"
    case "verification_failed":
      return "Verification failed"
    case "verification_incomplete":
      return "Verification incomplete"
    case "verification_degraded":
      return "Verification degraded"
  }
}

function formatTrustPosture(posture: VerificationTrustPosture) {
  switch (posture) {
    case "review_needed":
      return "Review needed"
    case "policy_clean":
      return "Policy clean"
    case "verified":
      return "Verified"
  }
}

function formatCheckStatus(status: VerificationCheckStatus) {
  switch (status) {
    case "pass":
      return "pass"
    case "fail":
      return "fail"
    case "incomplete":
      return "incomplete"
    case "degraded":
      return "degraded"
  }
}

function latestAuditEvent(events: LedgerEvent[]) {
  const rows = events
    .filter((row) => row.event_type === "audit" && "run_id" in row.payload)
    .sort((a, b) => b.created_at - a.created_at)

  const latest = rows[0]
  if (!latest) return undefined

  return {
    status: typeof latest.payload.status === "string" ? (latest.payload.status as Audit.Status) : undefined,
    blocker_count: asNumber(latest.payload.blockers),
    warning_count: asNumber(latest.payload.warnings),
    info_count: asNumber(latest.payload.info),
  }
}

function latestActivityTimestamp(input: {
  sessionUpdatedAt: number
  messageTimes: number[]
  eventTimes: number[]
  artifactTimes: number[]
}) {
  const timestamps = [input.sessionUpdatedAt, ...input.messageTimes, ...input.eventTimes, ...input.artifactTimes].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  )
  return timestamps.length > 0 ? Math.max(...timestamps) : undefined
}

async function listPendingApprovals(sessionID: string) {
  const { PermissionNext } = await import("../governance/next")
  const pending = await PermissionNext.list()
  return pending.filter((item) => item.sessionID === sessionID)
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
