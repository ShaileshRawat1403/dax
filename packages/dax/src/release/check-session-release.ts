import { EOL } from "os"
import { collectSessionShowSummary } from "../cli/cmd/session"
import { collectSessionVerification, type VerificationResult, type VerificationTrustPosture } from "../trust/verify-session"
import type { SessionLifecycleState } from "../session/lifecycle"
import { withLockedRetry } from "../util/locked-retry"
import type { WriteGovernanceStatus, WriteOutcome, WriteRiskBucket } from "../trust/write-governance"

export type ReleaseReadiness =
  | "not_ready"
  | "review_ready"
  | "handoff_ready"
  | "release_ready"

export type ReleaseCheckStatus = "pass" | "fail" | "incomplete"

export type ReleaseCheckID =
  | "lifecycle_terminal"
  | "verification_passed"
  | "approvals_complete"
  | "write_governance"
  | "artifacts_present"
  | "blocking_findings_absent"
  | "overrides_justified"
  | "trace_continuity"

export type ReleaseCheck = {
  id: ReleaseCheckID
  label: string
  status: ReleaseCheckStatus
  summary: string
}

export type SessionReleaseCheck = {
  type: "session_release_check"
  session_id: string
  lifecycle_state: SessionLifecycleState
  release_readiness: ReleaseReadiness
  trust_posture: VerificationTrustPosture
  verification_result: VerificationResult
  checks: ReleaseCheck[]
  blocking_factors: string[]
  missing_evidence: string[]
  passing_signals: string[]
}

export async function collectSessionReleaseCheck(sessionID: string): Promise<SessionReleaseCheck> {
  const verification = await withLockedRetry(() => collectSessionVerification(sessionID))
  const summary = await withLockedRetry(() => collectSessionShowSummary(sessionID))

  return evaluateSessionReleaseCheck({
    session_id: sessionID,
    lifecycle_state: verification.lifecycle_state,
    lifecycle_terminal: verification.lifecycle_terminal,
    lifecycle_requires_reconciliation: verification.lifecycle_requires_reconciliation,
    verification_result: verification.verification_result,
    trust_posture: verification.trust_posture,
    write_governance_status: verification.write_governance_status,
    write_outcome: verification.write_outcome,
    write_risk_bucket: verification.write_risk_bucket,
    approval_count: summary.approval_count,
    artifact_count: summary.artifact_count,
    override_count: summary.override_count,
    audit_posture: summary.audit_posture,
    trace_continuity_ok: typeof verification.latest_activity_at === "number",
  })
}

export function evaluateSessionReleaseCheck(input: {
  session_id: string
  lifecycle_state: SessionLifecycleState
  lifecycle_terminal: boolean
  lifecycle_requires_reconciliation: boolean
  verification_result: VerificationResult
  trust_posture: VerificationTrustPosture
  write_governance_status: WriteGovernanceStatus
  write_outcome: WriteOutcome
  write_risk_bucket?: WriteRiskBucket
  approval_count: number
  artifact_count: number
  override_count: number
  audit_posture: "clear" | "review_needed" | "blocked"
  trace_continuity_ok: boolean
}): SessionReleaseCheck {
  const checks: ReleaseCheck[] = [
    buildLifecycleCheck(input.lifecycle_state, input.lifecycle_terminal, input.lifecycle_requires_reconciliation),
    buildVerificationCheck(input.verification_result),
    buildApprovalsCheck(input.approval_count),
    buildWriteGovernanceCheck(input.write_governance_status, input.write_outcome, input.write_risk_bucket),
    buildArtifactsCheck(input.artifact_count),
    buildFindingsCheck(input.audit_posture),
    buildOverridesCheck(input.override_count),
    buildTraceCheck(input.trace_continuity_ok),
  ]

  const blocking_factors = checks.filter((check) => check.status === "fail").map((check) => check.summary)
  const missing_evidence = checks.filter((check) => check.status === "incomplete").map((check) => check.summary)
  const passing_signals = checks.filter((check) => check.status === "pass").map((check) => check.summary)

  return {
    type: "session_release_check",
    session_id: input.session_id,
    lifecycle_state: input.lifecycle_state,
    release_readiness: deriveReleaseReadiness(checks, input.verification_result),
    trust_posture: input.trust_posture,
    verification_result: input.verification_result,
    checks,
    blocking_factors,
    missing_evidence,
    passing_signals,
  }
}

export function formatSessionReleaseCheck(summary: SessionReleaseCheck) {
  const lines = [
    `Session: ${summary.session_id}`,
    `Lifecycle: ${formatLifecycleState(summary.lifecycle_state)}`,
    `Readiness: ${summary.release_readiness}`,
    `Trust posture: ${formatTrustPosture(summary.trust_posture)}`,
    `Verification: ${formatVerificationResult(summary.verification_result)}`,
    "",
  ]

  if (summary.blocking_factors.length > 0) {
    lines.push("Blockers", ...summary.blocking_factors.map((line) => `- ${line}`), "")
  }

  if (summary.missing_evidence.length > 0) {
    lines.push("Missing evidence", ...summary.missing_evidence.map((line) => `- ${line}`), "")
  }

  if (summary.passing_signals.length > 0) {
    lines.push("Signals", ...summary.passing_signals.map((line) => `- ${line}`), "")
  }

  lines.push("Summary", `- ${formatReadinessSummary(summary)}`)

  return lines.join(EOL)
}

function buildLifecycleCheck(
  lifecycleState: SessionLifecycleState,
  lifecycleTerminal: boolean,
  lifecycleRequiresReconciliation: boolean,
): ReleaseCheck {
  if (lifecycleTerminal && !lifecycleRequiresReconciliation) {
    return {
      id: "lifecycle_terminal",
      label: "Lifecycle complete",
      status: "pass",
      summary: "Session lifecycle reached a terminal execution state.",
    }
  }

  if (lifecycleRequiresReconciliation) {
    return {
      id: "lifecycle_terminal",
      label: "Lifecycle complete",
      status: "fail",
      summary: "Session produced visible output, but lifecycle completion was not finalized.",
    }
  }

  return {
    id: "lifecycle_terminal",
    label: "Lifecycle complete",
    status: "fail",
    summary: `Session lifecycle is still non-terminal: ${formatLifecycleState(lifecycleState)}.`,
  }
}

function deriveReleaseReadiness(checks: ReleaseCheck[], verificationResult: VerificationResult): ReleaseReadiness {
  if (checks.some((check) => check.status === "fail")) return "not_ready"
  if (verificationResult === "verification_incomplete" || verificationResult === "verification_degraded") return "review_ready"
  if (checks.some((check) => check.status === "incomplete")) return "handoff_ready"
  return "release_ready"
}

function buildVerificationCheck(result: VerificationResult): ReleaseCheck {
  switch (result) {
    case "verification_passed":
      return {
        id: "verification_passed",
        label: "Verification passed",
        status: "pass",
        summary: "Session trust verification passed.",
      }
    case "verification_degraded":
      return {
        id: "verification_passed",
        label: "Verification passed",
        status: "incomplete",
        summary: "Verification still needs human review before this session can move beyond review readiness.",
      }
    case "verification_incomplete":
      return {
        id: "verification_passed",
        label: "Verification passed",
        status: "incomplete",
        summary: "Verification is incomplete, so this session is only ready for human review.",
      }
    case "verification_failed":
      return {
        id: "verification_passed",
        label: "Verification passed",
        status: "fail",
        summary: "Verification failed, so this session is not ready for handoff or release.",
      }
  }
}

function buildApprovalsCheck(approvalCount: number): ReleaseCheck {
  if (approvalCount > 0) {
    return {
      id: "approvals_complete",
      label: "Approvals complete",
      status: "fail",
      summary: `${approvalCount} pending approval${approvalCount === 1 ? "" : "s"} still block handoff or release.`,
    }
  }

  return {
    id: "approvals_complete",
    label: "Approvals complete",
    status: "pass",
    summary: "No pending approvals remain.",
  }
}

function buildWriteGovernanceCheck(status: WriteGovernanceStatus, outcome: WriteOutcome, riskBucket?: WriteRiskBucket): ReleaseCheck {
  switch (status) {
    case "none":
      return {
        id: "write_governance",
        label: "Write governance",
        status: outcome === "no_durable_result" ? "incomplete" : "pass",
        summary:
          outcome === "no_durable_result"
            ? "Write-capable execution occurred without any durable retained workspace write artifacts, so stronger readiness still needs review."
            : "No governed write activity detected.",
      }
    case "governed":
      return {
        id: "write_governance",
        label: "Write governance",
        status: "pass",
        summary: `Retained workspace writes have matching governance evidence${riskBucket ? ` for ${formatWriteRiskBucket(riskBucket)} changes` : ""}.`,
      }
    case "blocked":
      return {
        id: "write_governance",
        label: "Write governance",
        status: "fail",
        summary:
          outcome === "blocked"
            ? "Write-capable work remained blocked on governance resolution, so handoff or release readiness is blocked."
            : "Write-capable work is still blocked on governance resolution.",
      }
    case "ungated":
      return {
        id: "write_governance",
        label: "Write governance",
        status:
          riskBucket === "sensitive_or_system_write"
            ? "fail"
            : riskBucket === "governed_project_write"
              ? "fail"
              : "incomplete",
        summary: formatReleaseWriteGovernanceSummary(outcome, riskBucket),
      }
  }
}

function formatReleaseWriteGovernanceSummary(outcome: WriteOutcome, riskBucket?: WriteRiskBucket) {
  if (outcome === "partial") {
    return "Retained writes were recorded, but the write path did not complete cleanly under governance, so stronger readiness is blocked pending review."
  }
  switch (riskBucket) {
    case "harmless_local":
      return "Retained writes only touched harmless local paths, so governance evidence is optional for readiness."
    case "project_artifact":
      return "Project artifact outputs were retained without visible governance evidence, so stronger readiness still needs review."
    case "governed_project_write":
      return "Governed project paths were changed without visible governance evidence, so handoff or release readiness is blocked."
    case "sensitive_or_system_write":
      return "Sensitive or system-impacting paths were changed without required governance evidence, so release readiness is blocked."
    default:
      return "Retained workspace writes were recorded without visible governance evidence."
  }
}

function formatWriteRiskBucket(bucket: WriteRiskBucket) {
  switch (bucket) {
    case "harmless_local":
      return "harmless local"
    case "project_artifact":
      return "project artifact"
    case "governed_project_write":
      return "governed project"
    case "sensitive_or_system_write":
      return "sensitive or system"
  }
}

function buildArtifactsCheck(artifactCount: number): ReleaseCheck {
  if (artifactCount > 0) {
    return {
      id: "artifacts_present",
      label: "Required artifacts present",
      status: "pass",
      summary: `${artifactCount} retained artifact${artifactCount === 1 ? "" : "s"} available for review.`,
    }
  }

  return {
    id: "artifacts_present",
    label: "Required artifacts present",
    status: "incomplete",
    summary: "No retained artifacts have been recorded for this session yet.",
  }
}

function buildFindingsCheck(posture: "clear" | "review_needed" | "blocked"): ReleaseCheck {
  if (posture === "blocked") {
    return {
      id: "blocking_findings_absent",
      label: "Blocking findings absent",
      status: "fail",
      summary: "Blocking audit findings still need resolution.",
    }
  }

  if (posture === "review_needed") {
    return {
      id: "blocking_findings_absent",
      label: "Blocking findings absent",
      status: "incomplete",
      summary: "Audit review is still needed before stronger readiness.",
    }
  }

  return {
    id: "blocking_findings_absent",
    label: "Blocking findings absent",
    status: "pass",
    summary: "No blocking audit findings remain.",
  }
}

function buildOverridesCheck(overrideCount: number): ReleaseCheck {
  if (overrideCount > 0) {
    return {
      id: "overrides_justified",
      label: "Overrides justified",
      status: "incomplete",
      summary: `${overrideCount} override${overrideCount === 1 ? "" : "s"} still require review before stronger readiness.`,
    }
  }

  return {
    id: "overrides_justified",
    label: "Overrides justified",
    status: "pass",
    summary: "No overrides require further review.",
  }
}

function buildTraceCheck(traceContinuityOk: boolean): ReleaseCheck {
  if (!traceContinuityOk) {
    return {
      id: "trace_continuity",
      label: "Trace continuity",
      status: "incomplete",
      summary: "Trace continuity evidence is incomplete.",
    }
  }

  return {
    id: "trace_continuity",
    label: "Trace continuity",
    status: "pass",
    summary: "Trace continuity is present for this session.",
  }
}

function formatReadinessSummary(summary: SessionReleaseCheck) {
  switch (summary.release_readiness) {
    case "not_ready":
      return "This session is not ready because blocking issues still prevent handoff or shipping."
    case "review_ready":
      return "This session is ready for human review, but trust or evidence still needs work before handoff."
    case "handoff_ready":
      return "This session is ready for handoff, but some non-blocking release evidence is still missing."
    case "release_ready":
      return "This session is ready to ship."
  }
}

function formatLifecycleState(state: SessionLifecycleState) {
  switch (state) {
    case "active":
      return "Active"
    case "executing":
      return "Executing"
    case "completed":
      return "Completed"
    case "interrupted":
      return "Interrupted"
    case "abandoned":
      return "Abandoned"
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
