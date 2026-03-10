import { describe, expect, test } from "bun:test"
import { evaluateSessionReleaseCheck, formatSessionReleaseCheck } from "./check-session-release"

describe("session release evaluator", () => {
  test("returns release_ready when trust and readiness signals are complete", () => {
    const summary = evaluateSessionReleaseCheck({
      session_id: "session_release_ready",
      verification_result: "verification_passed",
      trust_posture: "verified",
      approval_count: 0,
      artifact_count: 2,
      override_count: 0,
      audit_posture: "clear",
      trace_continuity_ok: true,
    })

    expect(summary.release_readiness).toBe("release_ready")
    expect(summary.checks.every((check) => check.status === "pass")).toBe(true)
  })

  test("returns not_ready when blocking readiness factors are present", () => {
    const summary = evaluateSessionReleaseCheck({
      session_id: "session_not_ready",
      verification_result: "verification_failed",
      trust_posture: "review_needed",
      approval_count: 0,
      artifact_count: 1,
      override_count: 0,
      audit_posture: "blocked",
      trace_continuity_ok: true,
    })

    expect(summary.release_readiness).toBe("not_ready")
    expect(summary.blocking_factors).toContain("Trust verification failed.")
    expect(summary.blocking_factors).toContain("Blocking audit findings still need resolution.")
  })

  test("returns review_ready when verification is not yet complete", () => {
    const summary = evaluateSessionReleaseCheck({
      session_id: "session_review_ready",
      verification_result: "verification_incomplete",
      trust_posture: "review_needed",
      approval_count: 0,
      artifact_count: 1,
      override_count: 0,
      audit_posture: "clear",
      trace_continuity_ok: true,
    })

    expect(summary.release_readiness).toBe("review_ready")
    expect(summary.missing_evidence).toContain("Trust verification is incomplete.")
  })

  test("returns handoff_ready when verification passed but completeness gaps remain", () => {
    const summary = evaluateSessionReleaseCheck({
      session_id: "session_handoff_ready",
      verification_result: "verification_passed",
      trust_posture: "verified",
      approval_count: 0,
      artifact_count: 0,
      override_count: 1,
      audit_posture: "review_needed",
      trace_continuity_ok: true,
    })

    expect(summary.release_readiness).toBe("handoff_ready")
    expect(summary.missing_evidence).toContain("No retained artifacts have been recorded for this session yet.")
    expect(summary.missing_evidence).toContain("Audit review is still needed before stronger readiness.")
  })

  test("formats an operator-facing release summary", () => {
    const rendered = formatSessionReleaseCheck(
      evaluateSessionReleaseCheck({
        session_id: "session_rendered",
        verification_result: "verification_passed",
        trust_posture: "verified",
        approval_count: 0,
        artifact_count: 2,
        override_count: 0,
        audit_posture: "clear",
        trace_continuity_ok: true,
      }),
    )

    expect(rendered).toContain("Session: session_rendered")
    expect(rendered).toContain("Readiness: Release ready")
    expect(rendered).toContain("Verification: Passed")
    expect(rendered).toContain("Checks")
    expect(rendered).toContain("Summary")
  })
})
