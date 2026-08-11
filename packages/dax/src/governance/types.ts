import type { SessionLifecycleState } from "../session/lifecycle"
import { Audit } from "./audit"
import type { 
  WriteGovernanceStatus, 
  WriteOutcome, 
  WriteRiskBucket, 
  WriteGovernanceExpectation 
} from "./governance-writer"

export type VerificationResult =
  | "verification_passed"
  | "verification_failed"
  | "verification_incomplete"
  | "verification_degraded"

export type VerificationTrustPosture = "review_needed" | "policy_clean" | "verified"

export type VerificationCheckStatus = "pass" | "fail" | "incomplete" | "degraded" | "warn"

export type VerificationCheckID =
  | "lifecycle_state"
  | "approvals"
  | "write_governance"
  | "policy_compliance"
  | "project_audit"
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
  lifecycle: {
    state: SessionLifecycleState
    terminal: boolean
    requires_reconciliation: boolean
  }
  /**
   * The project's last release audit. Named for its scope on purpose: Audit.run
   * inspects the repository (required release files, docs, integration, policy)
   * and takes no session, so this says nothing about what a given session did.
   */
  project_audit: {
    present: boolean
    status?: Audit.Status
    blocker_count: number
    warning_count: number
    info_count: number
  }
  /**
   * Whether this session's activity actually passed through policy evaluation.
   * Derived from RAO ledger entries carrying this session's id, which is the
   * only source that knows about the session.
   */
  session_policy: {
    evaluated: boolean
    decision_count: number
    override_count: number
  }
  approvals: {
    pending_count: number
  }
  write_governance: {
    status: WriteGovernanceStatus
    outcome: WriteOutcome
    workspace_write_artifact_count: number
    risk_bucket?: WriteRiskBucket
    governance_expectation?: WriteGovernanceExpectation
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
  lifecycle_state: SessionLifecycleState
  lifecycle_terminal: boolean
  lifecycle_requires_reconciliation: boolean
  verification_result: VerificationResult
  trust_posture: VerificationTrustPosture
  write_governance_status: WriteGovernanceStatus
  write_outcome: WriteOutcome
  write_risk_bucket?: WriteRiskBucket
  checks: VerificationCheck[]
  blocking_factors: string[]
  missing_evidence: string[]
  passing_signals: string[]
  degrading_factors: string[]
  latest_activity_at?: number
}
