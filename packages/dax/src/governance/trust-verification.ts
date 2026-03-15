import { EOL } from "os"
import { Audit } from "./audit"
import { RAOLedger } from "../rao"
import { deriveSessionLifecycleFromMessages, type SessionLifecycleState } from "../session/lifecycle"
import { Instance } from "../project/instance"
import { Locale } from "../util/locale"
import { withLockedRetry } from "../util/locked-retry"
import { buildArtifactsForSession } from "../cli/cmd/artifacts"
import {
  deriveWriteGovernanceClassification,
  deriveWriteOutcome,
  deriveWriteGovernanceStatus,
  type WriteGovernanceExpectation,
  type WriteOutcome,
  type WriteGovernanceStatus,
  type WriteRiskBucket,
} from "./governance-writer"
import type {
  VerificationResult,
  VerificationTrustPosture,
  VerificationCheckStatus,
  VerificationCheckID,
  VerificationCheck,
  SessionVerificationSignals,
  SessionVerification,
} from "./types"

export async function collectSessionVerification(sessionID: string): Promise<SessionVerification> {
  const signals = await collectVerificationSignals(sessionID)
  return evaluateSessionVerification(signals)
}

export async function collectVerificationSignals(sessionID: string): Promise<SessionVerificationSignals> {
  const { Session } = await import("../session")
  const session = await withLockedRetry(() => Session.get(sessionID))
  const { MessageV2 } = await import("../session/message-v2")
  const messages = await MessageV2.list(sessionID)
  const audit = await Audit.get(sessionID)
  const approvals = await listPendingApprovals(sessionID)
  const artifacts = await buildArtifactsForSession(sessionID)
  const diff = await RAOLedger.Diff.list(sessionID)
  const overrides = await RAOLedger.Override.list(sessionID)

  const lifecycle = deriveSessionLifecycleFromMessages({
    messages,
    pendingApprovalCount: approvals.length,
    retainedArtifactCount: artifacts.length,
    diffCount: diff.length,
    archivedAt: session.time.archived,
  })

  const writeGovernanceClassification = deriveWriteGovernanceClassification(artifacts)

  return {
    session_id: sessionID,
    project_id: session.projectID,
    lifecycle: {
      state: lifecycle.lifecycle_state,
      terminal: lifecycle.terminal,
      requires_reconciliation: lifecycle.requires_reconciliation,
    },
    audit: {
      present: !!audit,
      status: audit?.status,
      blocker_count: audit?.findings.filter((f) => f.severity === "critical").length ?? 0,
      warning_count: audit?.findings.filter((f) => f.severity === "major").length ?? 0,
      info_count: audit?.findings.filter((f) => f.severity === "minor" || f.severity === "info").length ?? 0,
    },
    approvals: {
      pending_count: approvals.length,
    },
    write_governance: {
      status: deriveWriteGovernanceStatus({
        pendingApprovalCount: approvals.length,
        workspaceWriteArtifactCount: writeGovernanceClassification.workspaceWriteCount,
        overrideCount: overrides.length,
        policyEvaluated: !!audit, // Audit implies policy was evaluated
      }),
      outcome: deriveWriteOutcome({
        lifecycleTerminal: lifecycle.terminal,
        lifecycleRequiresReconciliation: lifecycle.requires_reconciliation,
        workspaceWriteArtifactCount: writeGovernanceClassification.workspaceWriteCount,
        pendingApprovalCount: approvals.length,
      }),
      workspace_write_artifact_count: writeGovernanceClassification.workspaceWriteCount,
      risk_bucket: writeGovernanceClassification.highestRiskBucket,
      governance_expectation: writeGovernanceClassification.governanceExpectation,
    },
    overrides: {
      count: overrides.length,
    },
    evidence: {
      diff_present: diff.length > 0,
      artifacts_present: artifacts.length > 0,
      artifact_count: artifacts.length,
    },
    trace: {
      assistant_message_count: messages.filter((m) => m.role === "assistant").length,
      latest_activity_at: messages.length > 0 ? messages[messages.length - 1].time.created : undefined,
    },
  }
}

export function evaluateSessionVerification(signals: SessionVerificationSignals): SessionVerification {
  const checks: VerificationCheck[] = [
    evaluateLifecycleCheck(signals.lifecycle),
    evaluateApprovalsCheck(signals.approvals),
    evaluateWriteGovernanceCheck(signals.write_governance),
    evaluateAuditCheck(signals.audit),
    evaluateTraceCheck(signals.trace),
  ]

  const blocking_factors = checks.filter((c) => c.status === "fail").map((c) => c.summary)
  const missing_evidence = checks.filter((c) => c.status === "incomplete").map((c) => c.summary)
  const passing_signals = checks.filter((c) => c.status === "pass").map((c) => c.summary)

  let verification_result: VerificationResult = "verification_passed"
  if (blocking_factors.length > 0) verification_result = "verification_failed"
  else if (missing_evidence.length > 0) verification_result = "verification_incomplete"
  else if (checks.some((c) => c.status === "warn")) verification_result = "verification_degraded"

  let trust_posture: VerificationTrustPosture = "verified"
  if (verification_result === "verification_failed") trust_posture = "review_needed"
  else if (verification_result === "verification_incomplete") trust_posture = "review_needed"
  else if (signals.overrides.count > 0) trust_posture = "policy_clean" // Policy clean but has overrides

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

function evaluateWriteGovernanceCheck(
  write: SessionVerificationSignals["write_governance"],
): VerificationCheck {
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

function evaluateAuditCheck(audit: SessionVerificationSignals["audit"]): VerificationCheck {
  if (!audit.present) {
    return {
      id: "policy_compliance",
      label: "Policy Compliance",
      status: "incomplete",
      summary: "No audit has been performed for this session.",
    }
  }
  if (audit.blocker_count > 0) {
    return {
      id: "policy_compliance",
      label: "Policy Compliance",
      status: "fail",
      summary: `${audit.blocker_count} critical policy blockers were identified.`,
    }
  }
  if (audit.warning_count > 0) {
    return {
      id: "policy_compliance",
      label: "Policy Compliance",
      status: "warn",
      summary: `${audit.warning_count} policy warnings should be reviewed.`,
    }
  }
  return {
    id: "policy_compliance",
    label: "Policy Compliance",
    status: "pass",
    summary: "Session is compliant with current policies.",
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
    verification.latest_activity_at ? `Latest activity: ${Locale.todayTimeOrDateTime(verification.latest_activity_at)}` : undefined,
    "",
    "Checks:",
    ...verification.checks.map((c) => `  ${formatCheckStatus(c.status)} ${c.label}: ${c.summary}`),
  ].filter((l) => l !== undefined) as string[]

  if (verification.blocking_factors.length > 0) {
    lines.push("", "Blocking Factors:", ...verification.blocking_factors.map((f) => `  ! ${f}`))
  }

  if (verification.next_actions && verification.next_actions.length > 0) {
    lines.push("", "Next Actions:", ...verification.next_actions.map((a) => `  → ${a}`))
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
