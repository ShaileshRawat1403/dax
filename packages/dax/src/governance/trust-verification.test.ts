import { describe, expect, test } from "bun:test"
import { evaluateSessionVerification, formatSessionVerification } from "./trust-verification"

describe("session verification evaluator", () => {
  test("returns verification_passed when trust signals are complete and clean", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_verified",
      project_id: "p1",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "governed",
        outcome: "governed_completed",
        workspace_write_artifact_count: 1,
        risk_bucket: "governed_project_write",
        governance_expectation: "expected",
      },
      overrides: { count: 0 },
      evidence: {
        diff_present: true,
        artifacts_present: true,
        artifact_count: 2,
      },
      audit: {
        present: true,
        status: "pass",
        blocker_count: 0,
        warning_count: 0,
        info_count: 0,
      },
      trace: {
        assistant_message_count: 2,
        latest_activity_at: 1_700_000_000_000,
      },
    })

    expect(summary.verification_result).toBe("verification_passed")
    expect(summary.trust_posture).toBe("verified")
    expect(summary.checks.every((check) => check.status === "pass")).toBe(true)
  })

  test("returns verification_failed when blocking findings are present", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_failed",
      project_id: "p1",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "governed",
        outcome: "governed_completed",
        workspace_write_artifact_count: 0,
      },
      overrides: { count: 0 },
      evidence: {
        diff_present: true,
        artifacts_present: true,
        artifact_count: 1,
      },
      audit: {
        present: true,
        status: "fail",
        blocker_count: 1,
        warning_count: 0,
        info_count: 0,
      },
      trace: {
        assistant_message_count: 2,
        latest_activity_at: 1_700_000_000_000,
      },
    })

    expect(summary.verification_result).toBe("verification_failed")
    expect(summary.trust_posture).toBe("review_needed")
    expect(summary.blocking_factors).toContain("1 critical policy blockers were identified.")
  })

  test("treats failed lifecycle as a verification failure", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_failed_lifecycle",
      project_id: "p1",
      lifecycle: {
        state: "failed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "none",
        outcome: "none",
        workspace_write_artifact_count: 0,
      },
      overrides: { count: 0 },
      evidence: {
        diff_present: false,
        artifacts_present: false,
        artifact_count: 0,
      },
      audit: {
        present: true,
        status: "pass",
        blocker_count: 0,
        warning_count: 0,
        info_count: 0,
      },
      trace: {
        assistant_message_count: 1,
        latest_activity_at: 1_700_000_000_000,
      },
    })

    expect(summary.verification_result).toBe("verification_failed")
    expect(summary.trust_posture).toBe("review_needed")
    expect(summary.blocking_factors).toContain("Session execution failed.")
  })

  test("returns verification_incomplete when evidence and approvals are still missing", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_incomplete",
      project_id: "p1",
      lifecycle: {
        state: "executing",
        terminal: false,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 1 },
      write_governance: {
        status: "none",
        outcome: "none",
        workspace_write_artifact_count: 0,
      },
      overrides: { count: 0 },
      evidence: {
        diff_present: false,
        artifacts_present: false,
        artifact_count: 0,
      },
      audit: {
        present: false,
        blocker_count: 0,
        warning_count: 0,
        info_count: 0,
      },
      trace: {
        assistant_message_count: 0,
      },
    })

    expect(summary.verification_result).toBe("verification_incomplete")
    expect(summary.trust_posture).toBe("review_needed")
  })

  test("returns verification_degraded when warnings or overrides limit trust posture", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_degraded",
      project_id: "p1",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "governed",
        outcome: "governed_completed",
        workspace_write_artifact_count: 1,
        risk_bucket: "governed_project_write",
        governance_expectation: "expected",
      },
      overrides: { count: 1 },
      evidence: {
        diff_present: true,
        artifacts_present: true,
        artifact_count: 2,
      },
      audit: {
        present: true,
        status: "warn",
        blocker_count: 0,
        warning_count: 2,
        info_count: 0,
      },
      trace: {
        assistant_message_count: 1,
        latest_activity_at: 1_700_000_000_000,
      },
    })

    expect(summary.verification_result).toBe("verification_degraded")
    expect(summary.trust_posture).toBe("policy_clean")
    expect(summary.checks.some((c) => c.status === "warn")).toBe(true)
  })

  test("formats an operator-facing verification summary", () => {
    const rendered = formatSessionVerification(
      evaluateSessionVerification({
        session_id: "session_rendered",
        project_id: "p1",
        lifecycle: {
          state: "completed",
          terminal: true,
          requires_reconciliation: false,
        },
        approvals: { pending_count: 0 },
        write_governance: {
          status: "governed",
          outcome: "governed_completed",
          workspace_write_artifact_count: 1,
          risk_bucket: "governed_project_write",
          governance_expectation: "expected",
        },
        overrides: { count: 0 },
        evidence: {
          diff_present: true,
          artifacts_present: true,
          artifact_count: 2,
        },
        audit: {
          present: true,
          status: "pass",
          blocker_count: 0,
          warning_count: 0,
          info_count: 0,
        },
        trace: {
          assistant_message_count: 1,
          latest_activity_at: 1_700_000_000_000,
        },
      }),
    )

    expect(rendered).toContain("Session: session_rendered")
    expect(rendered).toContain("Lifecycle: Completed")
    expect(rendered).toContain("Verification: Passed")
    expect(rendered).toContain("Trust posture: Verified")
    expect(rendered).toContain("Checks:")
    expect(rendered).toContain("✓ Lifecycle State: Session reached a terminal state cleanly.")
  })

  test("surfaces ungated retained writes as a write-governance concern", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_ungated_write",
      project_id: "p1",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "ungated",
        outcome: "completed_ungated",
        workspace_write_artifact_count: 2,
        risk_bucket: "governed_project_write",
        governance_expectation: "expected",
      },
      overrides: { count: 0 },
      evidence: {
        diff_present: false,
        artifacts_present: true,
        artifact_count: 2,
      },
      audit: {
        present: true,
        status: "pass",
        blocker_count: 0,
        warning_count: 0,
        info_count: 0,
      },
      trace: {
        assistant_message_count: 1,
        latest_activity_at: 1_700_000_000_000,
      },
    })

    expect(summary.write_governance_status).toBe("ungated")
    expect(summary.verification_result).toBe("verification_degraded")
    expect(summary.checks.some((c) => c.status === "warn")).toBe(true)
  })

  test("treats sensitive ungated writes as a verification failure", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_sensitive_ungated_write",
      project_id: "p1",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "ungated",
        outcome: "completed_ungated",
        workspace_write_artifact_count: 1,
        risk_bucket: "sensitive_or_system_write",
        governance_expectation: "required",
      },
      overrides: { count: 0 },
      evidence: {
        diff_present: false,
        artifacts_present: true,
        artifact_count: 1,
      },
      audit: {
        present: true,
        status: "pass",
        blocker_count: 0,
        warning_count: 0,
        info_count: 0,
      },
      trace: {
        assistant_message_count: 1,
        latest_activity_at: 1_700_000_000_000,
      },
    })

    expect(summary.verification_result).toBe("verification_degraded")
    expect(summary.checks.some((c) => c.status === "warn")).toBe(true)
  })

  test("surfaces partial write outcomes separately from completed ungated writes", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_partial_write",
      project_id: "p1",
      lifecycle: {
        state: "executing",
        terminal: false,
        requires_reconciliation: true,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "ungated",
        outcome: "partial",
        workspace_write_artifact_count: 2,
        risk_bucket: "project_artifact",
        governance_expectation: "expected",
      },
      overrides: { count: 0 },
      evidence: {
        diff_present: false,
        artifacts_present: true,
        artifact_count: 2,
      },
      audit: {
        present: true,
        status: "pass",
        blocker_count: 0,
        warning_count: 0,
        info_count: 0,
      },
      trace: {
        assistant_message_count: 1,
        latest_activity_at: 1_700_000_000_000,
      },
    })

    expect(summary.verification_result).toBe("verification_degraded")
    expect(summary.checks.some((c) => c.status === "warn")).toBe(true)
  })

  test("surfaces write attempts with no durable result separately from clean no-write sessions", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_write_no_durable_result",
      project_id: "p1",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "none",
        outcome: "no_durable_result",
        workspace_write_artifact_count: 0,
      },
      overrides: { count: 0 },
      evidence: {
        diff_present: false,
        artifacts_present: false,
        artifact_count: 0,
      },
      audit: {
        present: true,
        status: "pass",
        blocker_count: 0,
        warning_count: 0,
        info_count: 0,
      },
      trace: {
        assistant_message_count: 1,
        latest_activity_at: 1_700_000_000_000,
      },
    })

    expect(summary.verification_result).toBe("verification_passed")
    expect(summary.trust_posture).toBe("verified")
  })
})
