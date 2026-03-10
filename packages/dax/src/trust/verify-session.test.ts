import { describe, expect, test } from "bun:test"
import { evaluateSessionVerification, formatSessionVerification } from "./verify-session"

describe("session verification evaluator", () => {
  test("returns verification_passed when trust signals are complete and clean", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_verified",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "governed",
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
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "governed",
        workspace_write_artifact_count: 1,
        risk_bucket: "governed_project_write",
        governance_expectation: "expected",
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
        assistant_message_count: 1,
        latest_activity_at: 1_700_000_000_000,
      },
    })

    expect(summary.verification_result).toBe("verification_failed")
    expect(summary.trust_posture).toBe("review_needed")
    expect(summary.blocking_factors).toContain("Policy checks reported blocking issues.")
    expect(summary.blocking_factors).toContain("1 blocking finding still need resolution.")
  })

  test("returns verification_incomplete when evidence and approvals are still missing", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_incomplete",
      lifecycle: {
        state: "active",
        terminal: false,
        requires_reconciliation: true,
      },
      approvals: { pending_count: 1 },
      write_governance: {
        status: "blocked",
        workspace_write_artifact_count: 0,
        risk_bucket: "governed_project_write",
        governance_expectation: "expected",
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
    expect(summary.degrading_factors).toContain("Execution produced visible output, but session completion was not finalized.")
    expect(summary.checks.filter((check) => check.status === "incomplete").length).toBeGreaterThan(0)
  })

  test("returns verification_degraded when warnings or overrides limit trust posture", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_degraded",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "governed",
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
    expect(summary.degrading_factors).toContain("2 warnings still require review.")
    expect(summary.degrading_factors).toContain("1 override decision was recorded and still require operator review.")
  })

  test("formats an operator-facing verification summary", () => {
    const rendered = formatSessionVerification(
      evaluateSessionVerification({
        session_id: "session_rendered",
        lifecycle: {
          state: "completed",
          terminal: true,
          requires_reconciliation: false,
        },
        approvals: { pending_count: 0 },
        write_governance: {
          status: "governed",
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
    expect(rendered).toContain("Verification: Verification passed")
    expect(rendered).toContain("Trust posture: Verified")
    expect(rendered).toContain("Checks")
    expect(rendered).toContain("Summary")
  })

  test("surfaces ungated retained writes as a write-governance concern", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_ungated_write",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "ungated",
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
        present: false,
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
    expect(summary.verification_result).toBe("verification_incomplete")
    expect(summary.degrading_factors).toContain(
      "2 retained workspace write artifacts changed governed project paths without visible governance evidence. Operator review is required before trusting the write path.",
    )
  })

  test("treats sensitive ungated writes as a verification failure", () => {
    const summary = evaluateSessionVerification({
      session_id: "session_sensitive_ungated_write",
      lifecycle: {
        state: "completed",
        terminal: true,
        requires_reconciliation: false,
      },
      approvals: { pending_count: 0 },
      write_governance: {
        status: "ungated",
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
        present: false,
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
    expect(summary.blocking_factors).toContain(
      "1 retained workspace write artifact touched sensitive or system-impacting paths without required governance evidence. Trust cannot be treated as clean.",
    )
  })
})
