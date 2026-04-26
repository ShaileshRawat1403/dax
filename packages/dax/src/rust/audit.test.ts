import { describe, expect, it } from "bun:test"
import { evaluateAuditWithRust, DaxAuditError } from "./audit"

const BASE_EVENTS = [
  { eventId: "e1", sequence: 1, cursor: "c1", runId: "run_ts_test", timestamp: "2026-04-26T10:00:00Z", type: "run.created", payload: { status: "created", title: "ts adapter test" } },
  { eventId: "e2", sequence: 2, cursor: "c2", runId: "run_ts_test", timestamp: "2026-04-26T10:00:01Z", type: "run.started", payload: { status: "running" } },
  { eventId: "e3", sequence: 3, cursor: "c3", runId: "run_ts_test", timestamp: "2026-04-26T10:00:02Z", type: "step.proposed", payload: { stepId: "s1", title: "analyse" } },
  { eventId: "e4", sequence: 4, cursor: "c4", runId: "run_ts_test", timestamp: "2026-04-26T10:00:03Z", type: "step.started", payload: { stepId: "s1", title: "analyse" } },
  { eventId: "e5", sequence: 5, cursor: "c5", runId: "run_ts_test", timestamp: "2026-04-26T10:00:04Z", type: "step.completed", payload: { stepId: "s1", title: "analyse", durationMs: 400 } },
  { eventId: "e6", sequence: 6, cursor: "c6", runId: "run_ts_test", timestamp: "2026-04-26T10:00:05Z", type: "artifact.created", payload: { artifact: { artifactId: "art_1" } } },
  { eventId: "e7", sequence: 7, cursor: "c7", runId: "run_ts_test", timestamp: "2026-04-26T10:00:06Z", type: "run.completed", payload: { status: "completed", summaryAvailable: true } },
]

describe("dax-audit Rust adapter", () => {
  it(
    "returns verified for a clean completed run with audit",
    async () => {
      const report = await evaluateAuditWithRust({
        session_id: "ses_ts_verified",
        events: BASE_EVENTS,
        findings: [],
        policy_decision_count: 5,
        override_count: 0,
        audit_present: true,
      })
      expect(report.schema_version).toBe("dax.audit.v1")
      expect(report.posture).toBe("verified")
      expect(report.verification_result).toBe("passed")
      expect(report.blocking_factors).toHaveLength(0)
    },
    120_000,
  )

  it(
    "returns policy_clean for a run with warnings only",
    async () => {
      const report = await evaluateAuditWithRust({
        session_id: "ses_ts_clean",
        events: BASE_EVENTS,
        findings: [{ id: "policy.pm.rules.empty", severity: "medium", category: "policy", title: "No PM rules", blocking: false }],
        policy_decision_count: 3,
        override_count: 0,
        audit_present: true,
      })
      expect(report.posture).toBe("policy_clean")
      expect(report.verification_result).toBe("degraded")
      expect(report.degrading_factors.length).toBeGreaterThan(0)
    },
    120_000,
  )

  it(
    "returns review_needed for a run with blocking findings",
    async () => {
      const report = await evaluateAuditWithRust({
        session_id: "ses_ts_blocked",
        events: BASE_EVENTS,
        findings: [{ id: "policy.critical", severity: "critical", category: "security", title: "Critical issue", blocking: true }],
        policy_decision_count: 2,
        override_count: 0,
        audit_present: true,
      })
      expect(report.posture).toBe("review_needed")
      expect(report.verification_result).toBe("failed")
      expect(report.blocking_factors.length).toBeGreaterThan(0)
    },
    120_000,
  )

  it(
    "returns review_needed when no audit has been run",
    async () => {
      const report = await evaluateAuditWithRust({
        session_id: "ses_ts_noaudit",
        events: BASE_EVENTS,
        findings: [],
        policy_decision_count: 0,
        override_count: 0,
        audit_present: false,
      })
      expect(report.posture).toBe("review_needed")
      expect(report.missing_evidence.length).toBeGreaterThan(0)
    },
    120_000,
  )

  it(
    "returns policy_clean when overrides are present even with no findings",
    async () => {
      const report = await evaluateAuditWithRust({
        session_id: "ses_ts_overrides",
        events: BASE_EVENTS,
        findings: [],
        policy_decision_count: 4,
        override_count: 1,
        audit_present: true,
      })
      expect(report.posture).toBe("policy_clean")
    },
    120_000,
  )

  it(
    "throws DaxAuditError on invalid input",
    async () => {
      await expect(
        evaluateAuditWithRust({ session_id: "", events: null as never }),
      ).rejects.toBeInstanceOf(DaxAuditError)
    },
    120_000,
  )
})
