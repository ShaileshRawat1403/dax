import { EOL } from "os"
import { Audit } from "./audit"
import { RAOLedger } from "../rao"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { deriveSessionLifecycleFromMessages, type SessionLifecycleState } from "../session/lifecycle"
import { Locale } from "../util/locale"
import { withLockedRetry } from "../util/locked-retry"
import { buildArtifactsForSession } from "../cli/cmd/artifacts"
import {
  deriveWriteGovernanceClassification,
  deriveWriteOutcome,
  deriveWriteGovernanceStatus,
} from "./governance-writer"
import type {
  VerificationResult,
  VerificationTrustPosture,
  VerificationCheckStatus,
  VerificationCheck,
  SessionVerificationSignals,
  SessionVerification,
} from "./types"

export async function collectSessionVerification(sessionID: string): Promise<SessionVerification> {
  const signals = await collectVerificationSignals(sessionID)
  return evaluateSessionVerification(signals)
}

export async function collectVerificationSignals(sessionID: string): Promise<SessionVerificationSignals> {
  const session = await withLockedRetry(() => Session.get(sessionID))
  const messages = await MessageV2.filterCompacted(MessageV2.stream(sessionID))
  const projectAudit = await resolveProjectAudit(session.projectID)
  const sessionPolicy = await resolveSessionPolicy(session.projectID, sessionID)
  const approvals = await listPendingApprovals(sessionID)
  const diffs = await Session.diff(sessionID)
  const artifacts = buildArtifactsForSession(session, messages, diffs)
  const overrides = await RAOLedger.list({ project_id: session.projectID, limit: 100, event_type: "override" })

  const lifecycle = deriveSessionLifecycleFromMessages({
    messages,
    pendingApprovalCount: approvals.length,
    retainedArtifactCount: artifacts.length,
    diffCount: diffs.length,
    archivedAt: session.time.archived,
    sessionUpdatedAt: session.time.updated,
  })

  const writeGovernanceClassification = deriveWriteGovernanceClassification({
    sessionDirectory: session.directory,
    references: artifacts.map((a) => a.id),
  })

  return {
    session_id: sessionID,
    project_id: session.projectID,
    lifecycle: {
      state: lifecycle.lifecycle_state,
      terminal: lifecycle.terminal,
      requires_reconciliation: lifecycle.requires_reconciliation,
    },
    project_audit: {
      present: !!projectAudit,
      status: projectAudit?.status,
      blocker_count: projectAudit?.blocker_count ?? 0,
      warning_count: projectAudit?.warning_count ?? 0,
      info_count: projectAudit?.info_count ?? 0,
    },
    session_policy: sessionPolicy,
    approvals: {
      pending_count: approvals.length,
    },
    write_governance: {
      status: deriveWriteGovernanceStatus({
        write_intent_detected: !!writeGovernanceClassification,
        pending_approval_count: approvals.length,
        workspace_write_artifact_count: writeGovernanceClassification?.workspaceWriteCount ?? 0,
        override_count: overrides.length,
        policy_evaluated: sessionPolicy.evaluated,
        lifecycle_terminal: lifecycle.terminal,
        lifecycle_requires_reconciliation: lifecycle.requires_reconciliation,
      }),
      outcome: deriveWriteOutcome({
        lifecycle_terminal: lifecycle.terminal,
        lifecycle_requires_reconciliation: lifecycle.requires_reconciliation,
        workspace_write_artifact_count: writeGovernanceClassification?.workspaceWriteCount ?? 0,
        pending_approval_count: approvals.length,
        write_intent_detected: !!writeGovernanceClassification,
        override_count: overrides.length,
        policy_evaluated: sessionPolicy.evaluated,
      }),
      workspace_write_artifact_count: writeGovernanceClassification?.workspaceWriteCount ?? 0,
      risk_bucket: writeGovernanceClassification?.bucket,
      governance_expectation: writeGovernanceClassification?.governance_expectation,
    },
    overrides: {
      count: overrides.length,
    },
    evidence: {
      diff_present: diffs.length > 0,
      artifacts_present: artifacts.length > 0,
      artifact_count: artifacts.length,
    },
    trace: {
      assistant_message_count: messages.filter((m) => m.info.role === "assistant").length,
      latest_activity_at: messages.length > 0 ? messages[messages.length - 1].info.time.created : undefined,
    },
  }
}

/**
 * The project's last release audit.
 *
 * Deliberately project-scoped, because Audit.run is: it inspects the repository
 * for required release files, documentation, integration and policy, and takes
 * no session at all. This previously reached through `(Audit as any)?.state` for
 * a member the namespace does not export, so it always returned undefined and
 * every session reported no audit whether or not one had run. The `as any` is
 * what let a reference to a non-existent member compile.
 */
async function resolveProjectAudit(projectID: string): Promise<ProjectAuditState | undefined> {
  const events = await RAOLedger.list({ project_id: projectID, limit: 1, event_type: "audit" })
  const latest = events[0]
  if (!latest) return undefined
  // list_events already parses the payload.
  const payload = latest.payload as {
    status?: Audit.Status
    blockers?: number
    warnings?: number
    info?: number
  }
  return {
    status: payload.status,
    blocker_count: payload.blockers ?? 0,
    warning_count: payload.warnings ?? 0,
    info_count: payload.info ?? 0,
  }
}

type ProjectAuditState = {
  status?: Audit.Status
  blocker_count: number
  warning_count: number
  info_count: number
}

/**
 * Whether this session's work actually passed through policy evaluation.
 *
 * This is the question the write-governance checks were asking when they read
 * `policy_evaluated`, and a repository release audit could never answer it. RAO
 * entries carry the session they belong to, so they can.
 */
async function resolveSessionPolicy(projectID: string, sessionID: string) {
  // Scoped at the query. Reading the project's newest events and filtering here
  // spent the limit on other sessions, so on a busy project this returned none
  // of the session it was asked about and reported it ungoverned. A false
  // "no policy was evaluated" downgrades trust for a session that was in fact
  // fully gated.
  const forSession = await RAOLedger.list({ project_id: projectID, session_id: sessionID, limit: 500 })
  const overrides = forSession.filter((event) => event.event_type === "override")
  return {
    evaluated: forSession.length > 0,
    decision_count: forSession.length,
    override_count: overrides.length,
  }
}

export function evaluateSessionVerification(signals: SessionVerificationSignals): SessionVerification {
  const checks: VerificationCheck[] = [
    evaluateLifecycleCheck(signals.lifecycle),
    evaluateApprovalsCheck(signals.approvals),
    evaluateWriteGovernanceCheck(signals.write_governance),
    evaluateProjectAuditCheck(signals.project_audit),
    evaluateSessionPolicyCheck(signals.session_policy),
    evaluateTraceCheck(signals.trace),
  ]

  const blocking_factors = checks.filter((c) => c.status === "fail").map((c) => c.summary)
  const missing_evidence = checks.filter((c) => c.status === "incomplete").map((c) => c.summary)
  const degrading_factors = checks.filter((c) => c.status === "warn" || c.status === "degraded").map((c) => c.summary)
  const passing_signals = checks.filter((c) => c.status === "pass").map((c) => c.summary)

  let verification_result: VerificationResult = "verification_passed"
  if (blocking_factors.length > 0) verification_result = "verification_failed"
  else if (missing_evidence.length > 0) verification_result = "verification_incomplete"
  else if (degrading_factors.length > 0) verification_result = "verification_degraded"

  let trust_posture: VerificationTrustPosture = "verified"
  if (verification_result === "verification_failed") trust_posture = "review_needed"
  else if (verification_result === "verification_incomplete") trust_posture = "review_needed"
  else if (signals.overrides.count > 0 || degrading_factors.length > 0) trust_posture = "policy_clean"

  return {
    type: "session_verification",
    project_id: signals.project_id ?? "unknown",
    session_id: signals.session_id,
    lifecycle_state: signals.lifecycle.state,
    lifecycle_terminal: signals.lifecycle.terminal,
    lifecycle_requires_reconciliation: signals.lifecycle.requires_reconciliation,
    verification_result,
    trust_posture,
    write_governance_status: signals.write_governance.status,
    write_outcome: signals.write_governance.outcome,
    write_risk_bucket: signals.write_governance.risk_bucket,
    checks,
    blocking_factors,
    missing_evidence,
    passing_signals,
    degrading_factors,
    latest_activity_at: signals.trace.latest_activity_at,
  }
}

function evaluateLifecycleCheck(lifecycle: SessionVerificationSignals["lifecycle"]): VerificationCheck {
  if (lifecycle.state === "failed") {
    return {
      id: "lifecycle_state",
      label: "Lifecycle State",
      status: "fail",
      summary: "Session execution failed.",
    }
  }
  if (lifecycle.terminal && !lifecycle.requires_reconciliation) {
    return {
      id: "lifecycle_state",
      label: "Lifecycle State",
      status: "pass",
      summary: "Session reached a terminal state cleanly.",
    }
  }
  if (lifecycle.requires_reconciliation) {
    return {
      id: "lifecycle_state",
      label: "Lifecycle State",
      status: "warn",
      summary: "Session finished with visible output but was not explicitly closed.",
    }
  }
  return {
    id: "lifecycle_state",
    label: "Lifecycle State",
    status: "incomplete",
    summary: `Session is still ${lifecycle.state}.`,
  }
}

function evaluateApprovalsCheck(approvals: SessionVerificationSignals["approvals"]): VerificationCheck {
  if (approvals.pending_count > 0) {
    return {
      id: "approvals",
      label: "Approvals",
      status: "incomplete",
      summary: `${approvals.pending_count} pending approval requests remain.`,
    }
  }
  return {
    id: "approvals",
    label: "Approvals",
    status: "pass",
    summary: "No pending approvals.",
  }
}

function evaluateWriteGovernanceCheck(write: SessionVerificationSignals["write_governance"]): VerificationCheck {
  if (write.status === "blocked") {
    return {
      id: "write_governance",
      label: "Write Governance",
      status: "fail",
      summary: "Write activity was blocked by governance rules.",
    }
  }
  if (write.status === "governed") {
    return {
      id: "write_governance",
      label: "Write Governance",
      status: "pass",
      summary: "All write activity was performed within governed paths.",
    }
  }
  if (write.workspace_write_artifact_count > 0) {
    return {
      id: "write_governance",
      label: "Write Governance",
      status: "warn",
      summary: `${write.workspace_write_artifact_count} writes were performed without explicit governance.`,
    }
  }
  return {
    id: "write_governance",
    label: "Write Governance",
    status: "pass",
    summary: "No workspace writes detected.",
  }
}

/**
 * The project's release-audit posture. Worded for project scope: it is true of
 * the repository, not of anything this session did.
 */
function evaluateProjectAuditCheck(audit: SessionVerificationSignals["project_audit"]): VerificationCheck {
  if (!audit.present) {
    return {
      id: "project_audit",
      label: "Project Audit",
      status: "incomplete",
      summary: "No audit has been run for this project.",
    }
  }
  if (audit.blocker_count > 0) {
    return {
      id: "project_audit",
      label: "Project Audit",
      status: "fail",
      summary: `The project's last audit found ${audit.blocker_count} critical blockers.`,
    }
  }
  if (audit.warning_count > 0) {
    return {
      id: "project_audit",
      label: "Project Audit",
      status: "warn",
      summary: `The project's last audit raised ${audit.warning_count} warnings to review.`,
    }
  }
  return {
    id: "project_audit",
    label: "Project Audit",
    status: "pass",
    summary: "The project's last audit was clean.",
  }
}

/**
 * Whether this session's own work was governed. This is the check that used to
 * be answered with a repository audit, which is why it could never fail for the
 * right reason.
 */
function evaluateSessionPolicyCheck(policy: SessionVerificationSignals["session_policy"]): VerificationCheck {
  if (!policy.evaluated) {
    return {
      id: "policy_compliance",
      label: "Policy Compliance",
      status: "incomplete",
      summary: "No policy decisions were recorded for this session.",
    }
  }
  if (policy.override_count > 0) {
    return {
      id: "policy_compliance",
      label: "Policy Compliance",
      status: "warn",
      summary: `${policy.override_count} policy ${policy.override_count === 1 ? "decision was" : "decisions were"} overridden in this session.`,
    }
  }
  return {
    id: "policy_compliance",
    label: "Policy Compliance",
    status: "pass",
    summary: `${policy.decision_count} governed ${policy.decision_count === 1 ? "decision" : "decisions"} recorded for this session.`,
  }
}

function evaluateTraceCheck(trace: SessionVerificationSignals["trace"]): VerificationCheck {
  if (trace.assistant_message_count === 0) {
    return {
      id: "trace_continuity",
      label: "Trace Continuity",
      status: "incomplete",
      summary: "No assistant activity recorded in the session trace.",
    }
  }
  return {
    id: "trace_continuity",
    label: "Trace Continuity",
    status: "pass",
    summary: `Trace contains ${trace.assistant_message_count} assistant turns.`,
  }
}

export function formatSessionVerification(verification: SessionVerification): string {
  const lines = [
    `Session: ${verification.session_id}`,
    `Lifecycle: ${formatLifecycleState(verification.lifecycle_state)}${verification.lifecycle_requires_reconciliation ? " (needs reconciliation)" : ""}`,
    `Verification: ${formatVerificationResult(verification.verification_result)}`,
    `Trust posture: ${formatTrustPosture(verification.trust_posture)}`,
    verification.latest_activity_at
      ? `Latest activity: ${Locale.todayTimeOrDateTime(verification.latest_activity_at)}`
      : undefined,
    "",
    "Checks:",
    ...verification.checks.map((c) => `  ${formatCheckStatus(c.status)} ${c.label}: ${c.summary}`),
  ].filter((l) => l !== undefined) as string[]

  if (verification.blocking_factors.length > 0) {
    lines.push("", "Blocking Factors:", ...verification.blocking_factors.map((f) => `  ! ${f}`))
  }

  return lines.join(EOL)
}

function formatLifecycleState(state: SessionLifecycleState) {
  switch (state) {
    case "created":
      return "Created"
    case "planning":
      return "Planning"
    case "ready":
      return "Ready"
    case "executing":
      return "Executing"
    case "awaiting_approval":
      return "Awaiting Approval"
    case "blocked":
      return "Blocked"
    case "completed":
      return "Completed"
    case "failed":
      return "Failed"
    case "archived":
      return "Archived"
  }
}

function formatVerificationResult(result: VerificationResult) {
  switch (result) {
    case "verification_passed":
      return "Passed"
    case "verification_failed":
      return "Failed"
    case "verification_incomplete":
      return "Incomplete"
    case "verification_degraded":
      return "Degraded"
  }
}

function formatTrustPosture(posture: VerificationTrustPosture) {
  switch (posture) {
    case "review_needed":
      return "Review Needed"
    case "policy_clean":
      return "Policy Clean"
    case "verified":
      return "Verified"
  }
}

function formatCheckStatus(status: VerificationCheckStatus) {
  switch (status) {
    case "pass":
      return "✓"
    case "fail":
      return "✗"
    case "warn":
      return "!"
    case "incomplete":
      return "○"
    case "degraded":
      return "!"
  }
}

async function listPendingApprovals(sessionID: string) {
  const { Permission } = await import("./next")
  const pending = await Permission.list()
  return pending.filter((item) => item.sessionID === sessionID)
}
