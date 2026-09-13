import { describe, expect, test } from "bun:test"
import type { RunInspectorProjectionV1 } from "@/server/run-inspector-projection"
import {
  formatCanonicalAuthorityRows,
  presentCanonicalAuthorityStrip,
  shouldShowCompatibilityHeaderChip,
} from "./canonical-authority-strip-presentation"
import type { CanonicalInspectorState } from "./canonical-inspector-state"

function canonical(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "run-inspector.v1", kind: "canonical", runId: "run_1",
    authority: { source: "event-log", validated: true, eventSequence: 7, cursor: "7" }, canonicalStatus: "running",
    invocationIntent: { intent: "Update bounded configuration", expectedOutputs: [], expectedOutputsOmittedCount: 0 },
    contract: { contractId: "ctr_1" }, approvals: [],
    completion: { genericCompletionProof: null, integrityWarning: null },
    ...overrides,
  } as unknown as RunInspectorProjectionV1
}

function ready(snapshot = canonical()): CanonicalInspectorState {
  return { status: "ready", stale: false, snapshot }
}

describe("canonical authority strip", () => {
  test("maps every canonical lifecycle to the required human label", () => {
    expect(presentCanonicalAuthorityStrip(ready(canonical({ canonicalStatus: "created" })), "operator").lifecycle).toBe("Prepared")
    expect(presentCanonicalAuthorityStrip(ready(canonical({ canonicalStatus: "compiled" })), "operator").lifecycle).toBe("Prepared")
    expect(presentCanonicalAuthorityStrip(ready(canonical({ canonicalStatus: "queued" })), "operator").lifecycle).toBe("Queued")
    expect(presentCanonicalAuthorityStrip(ready(canonical({ canonicalStatus: "running" })), "operator").lifecycle).toBe("Running")
    expect(presentCanonicalAuthorityStrip(ready(canonical({ canonicalStatus: "failed" })), "operator").lifecycle).toBe("Failed")
    expect(presentCanonicalAuthorityStrip(ready(canonical({ canonicalStatus: "cancelled" })), "operator").lifecycle).toBe("Cancelled")
  })

  test("separates completion from completion proof", () => {
    const proof = { decision: "pass", failedChecks: [], verificationExecuted: true, receiptIds: ["r"], artifactChecks: true, expectedOutputChecks: true, expectedOutputTypesSatisfied: [], expectedOutputTypesMissing: [], scopeChecks: true, sensitivePathApprovalChecks: true, checkedAt: "now" }
    expect(presentCanonicalAuthorityStrip(ready(canonical({ canonicalStatus: "completed", completion: { genericCompletionProof: proof, integrityWarning: null } })), "operator").lifecycle).toBe("Completed — proven")
    expect(presentCanonicalAuthorityStrip(ready(canonical({ canonicalStatus: "completed", completion: { genericCompletionProof: { ...proof, decision: "accepted" }, integrityWarning: null } })), "operator").lifecycle).toBe("Completed — proof unavailable")
    expect(presentCanonicalAuthorityStrip(ready(canonical({ canonicalStatus: "completed", completion: { genericCompletionProof: null, integrityWarning: "completed_without_generic_completion_proof" } })), "operator").lifecycle).toBe("Completed — proof unavailable")
  })

  test("canonical authority suppresses the competing compatibility lifecycle chip", () => {
    const legacy: CanonicalInspectorState = {
      status: "ready",
      stale: false,
      snapshot: { schemaVersion: "run-inspector.v1", kind: "legacy_unsupported", runId: "run_1", reason: "legacy_authority" },
    }
    const unreadable: CanonicalInspectorState = {
      status: "ready",
      stale: false,
      snapshot: { schemaVersion: "run-inspector.v1", kind: "authority_unreadable", runId: "run_1", reason: "canonical_log_unreadable" },
    }
    expect(shouldShowCompatibilityHeaderChip(undefined)).toBe(true)
    expect(shouldShowCompatibilityHeaderChip(legacy)).toBe(true)
    expect(shouldShowCompatibilityHeaderChip(ready())).toBe(false)
    expect(shouldShowCompatibilityHeaderChip({ status: "stale", stale: true, snapshot: canonical(), error: "offline" })).toBe(false)
    expect(shouldShowCompatibilityHeaderChip(unreadable)).toBe(false)
    expect(shouldShowCompatibilityHeaderChip({ status: "unavailable", stale: false, error: "invalid" })).toBe(false)
  })

  test("shows action required only for fresh canonical pending approvals", () => {
    const pending = canonical({ canonicalStatus: "waiting_approval", approvals: [{ approvalId: "apr_1", status: "pending" }] })
    expect(presentCanonicalAuthorityStrip(ready(pending), "operator")).toMatchObject({ lifecycle: "Waiting for your decision", pendingApprovals: 1 })
    expect(presentCanonicalAuthorityStrip({ status: "stale", stale: true, snapshot: pending, error: "offline" }, "operator")).toMatchObject({ pendingApprovals: 0, stale: true })
  })

  test("fails closed and keeps inspect meaning stable across display modes", () => {
    expect(presentCanonicalAuthorityStrip({ status: "ready", stale: false, snapshot: { schemaVersion: "run-inspector.v1", kind: "authority_unreadable", runId: "run_1", reason: "canonical_log_unreadable" } }, "operator").lifecycle).toBe("Authority unreadable")
    expect(presentCanonicalAuthorityStrip({ status: "ready", stale: false, snapshot: { schemaVersion: "run-inspector.v1", kind: "legacy_unsupported", runId: "run_1", reason: "legacy_authority" } }, "operator").lifecycle).toBe("Legacy authority — canonical inspector unsupported")
    expect(presentCanonicalAuthorityStrip({ status: "unavailable", stale: false, error: "invalid" }, "operator").lifecycle).toBe("Canonical status unavailable")
    const operator = presentCanonicalAuthorityStrip(ready(), "operator")
    const inspect = presentCanonicalAuthorityStrip(ready(), "inspect")
    expect(operator.lifecycle).toBe(inspect.lifecycle)
    expect(operator.authority).toBe(inspect.authority)
    expect(inspect.details).toContain("Run run_1")
  })

  test("renders goal, state, sequence and cursor distinctly in separate presentation rows", () => {
    const snap = canonical({
      canonicalStatus: "running",
      authority: { source: "event-log", validated: true, eventSequence: 2, cursor: "2" },
      invocationIntent: { intent: "hi", expectedOutputs: [], expectedOutputsOmittedCount: 0 },
    })
    const strip = presentCanonicalAuthorityStrip(ready(snap), "operator")
    expect(strip.lifecycle).toBe("Running")
    expect(strip.intent).toBe("hi")
    expect(strip.sequence).toBe(2)
    expect(strip.cursor).toBe("2")
    expect(strip.authority).toBe("Authority log validated · sequence 2 · cursor 2")

    const rows = formatCanonicalAuthorityRows(strip)
    expect(rows).toEqual([
      "Running",
      "Goal: hi",
      "Authority log validated · sequence 2 · cursor 2",
    ])
  })

  test("compact-width rendering does not concatenate semantic labels", () => {
    const snap = canonical({
      canonicalStatus: "running",
      authority: { source: "event-log", validated: true, eventSequence: 2, cursor: "2" },
      invocationIntent: { intent: "hi", expectedOutputs: [], expectedOutputsOmittedCount: 0 },
    })
    const strip = presentCanonicalAuthorityStrip(ready(snap), "operator")
    const rows = formatCanonicalAuthorityRows(strip, { maxColumns: 40 })

    // Ensures goal and authority are on completely separate lines, preventing "Goal:hiValidated sequence 2..."
    expect(rows[0]).toBe("Running")
    expect(rows[1]).toBe("Goal: hi")
    expect(rows[2]).toBe("Authority log validated")
    expect(rows[3]).toBe("sequence 2 · cursor 2")
    expect(rows.some((r) => r.includes("Goal:hi"))).toBe(false)
    expect(rows.some((r) => r.includes("hiValidated"))).toBe(false)
  })

  test("formats stale authority without mutating canonical sequence or cursor", () => {
    const snap = canonical({
      canonicalStatus: "running",
      authority: { source: "event-log", validated: true, eventSequence: 5, cursor: "c_5" },
      invocationIntent: { intent: "Deploy worker", expectedOutputs: [], expectedOutputsOmittedCount: 0 },
    })
    const strip = presentCanonicalAuthorityStrip({ status: "stale", stale: true, snapshot: snap, error: "offline" }, "operator")
    expect(strip.stale).toBe(true)
    expect(strip.authority).toBe("STALE — last validated canonical state · sequence 5 · cursor c_5")
    expect(strip.sequence).toBe(5)
    expect(strip.cursor).toBe("c_5")
  })
})
