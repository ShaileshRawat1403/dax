import { describe, expect, test } from "bun:test"
import { deriveAuditPosture, formatAuditSummary, summarizeNextActions, type AuditSummary } from "./audit"
import { Audit } from "../../audit"

describe("audit command helpers", () => {
  test("marks blocked posture when audit blockers are present", () => {
    expect(
      deriveAuditPosture({
        auditStatus: "fail",
        blockerCount: 1,
        pendingApprovalCount: 0,
        overrideCount: 0,
        evidence: {
          diff_present: true,
          artifacts_present: true,
          sessions_with_diffs: 1,
          artifact_count: 1,
        },
      }),
    ).toBe("blocked")
  })

  test("marks review-needed posture when overrides or evidence gaps exist", () => {
    expect(
      deriveAuditPosture({
        auditStatus: "pass",
        blockerCount: 0,
        pendingApprovalCount: 0,
        overrideCount: 1,
        evidence: {
          diff_present: true,
          artifacts_present: false,
          sessions_with_diffs: 1,
          artifact_count: 0,
        },
      }),
    ).toBe("review_needed")

    expect(
      deriveAuditPosture({
        auditStatus: "pass",
        blockerCount: 0,
        pendingApprovalCount: 0,
        overrideCount: 0,
        evidence: {
          diff_present: false,
          artifacts_present: false,
          sessions_with_diffs: 0,
          artifact_count: 0,
        },
      }),
    ).toBe("review_needed")
  })

  test("marks clear posture when trust signals are healthy", () => {
    expect(
      deriveAuditPosture({
        auditStatus: "pass",
        blockerCount: 0,
        pendingApprovalCount: 0,
        overrideCount: 0,
        evidence: {
          diff_present: true,
          artifacts_present: true,
          sessions_with_diffs: 1,
          artifact_count: 2,
        },
      }),
    ).toBe("clear")
  })

  test("adds operator-facing next actions for approvals, overrides, and evidence gaps", () => {
    const result = Audit.Result.parse({
      run_id: "audit_actions",
      timestamp: new Date().toISOString(),
      profile: "strict",
      status: "warn",
      findings: [],
      summary: {
        blocker_count: 0,
        warning_count: 1,
        info_count: 0,
      },
      next_actions: ["Resolve warnings before next release cut."],
      metadata: {
        trigger: "manual",
        project_id: "proj_1",
        github_enabled: false,
        auto_triggers: [],
      },
    })

    const actions = summarizeNextActions({
      auditResult: result,
      pendingApprovalCount: 1,
      overrideCount: 1,
      evidence: {
        diff_present: false,
        artifacts_present: false,
        sessions_with_diffs: 0,
        artifact_count: 0,
      },
    })

    expect(actions[0]).toBe("Review pending approvals before continuing execution.")
    expect(actions).toContain("Review override decisions and confirm they were intentional.")
    expect(actions).toContain("Collect execution evidence before handoff or release review.")
  })

  test("formats readable trust summary for operators", () => {
    const rendered = formatAuditSummary({
      type: "audit_summary",
      project_id: "project_123",
      session_id: "session_123",
      posture: "review_needed",
      approvals: {
        requested: 2,
        overrides: 1,
      },
      evidence: {
        diff_present: true,
        artifacts_present: true,
        sessions_with_diffs: 1,
        artifact_count: 3,
      },
      findings: {
        status: "warn",
        blocker_count: 0,
        warning_count: 2,
        info_count: 1,
      },
      latest_activity_at: 1_700_000_000_000,
      next_actions: ["Review pending approvals before continuing execution."],
    } satisfies AuditSummary)

    expect(rendered).toContain("Session: session_123")
    expect(rendered).toContain("Trust posture: Review needed")
    expect(rendered).toContain("Pending approvals: 2")
    expect(rendered).toContain("Overrides recorded: 1")
    expect(rendered).toContain("Audit findings: WARN")
    expect(rendered).toContain("Next actions:")
  })
})
