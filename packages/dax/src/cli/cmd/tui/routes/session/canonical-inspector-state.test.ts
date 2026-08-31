import { describe, expect, test } from "bun:test"
import {
  acceptCanonicalInspectorRead,
  initialCanonicalInspectorState,
  rejectCanonicalInspectorRead,
} from "./canonical-inspector-state"
import { presentCanonicalInspector } from "./canonical-inspector-presentation"
import type { RunInspectorProjectionV1, RunInspectorReadResultV1 } from "@/server/run-inspector-projection"

const unreadable = { schemaVersion: "run-inspector.v1", kind: "authority_unreadable", runId: "run_1", reason: "canonical_log_unreadable" } satisfies RunInspectorReadResultV1
const legacy = { schemaVersion: "run-inspector.v1", kind: "legacy_unsupported", runId: "run_1", reason: "legacy_authority" } satisfies RunInspectorReadResultV1

function canonical(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "run-inspector.v1", kind: "canonical", runId: "run_1",
    authority: { source: "event-log", validated: true, eventSequence: 9, cursor: "9" }, canonicalStatus: "running",
    contract: { contractId: "ctr_1", workflowClass: "worker_run", executionMode: "approval_gated", riskLevel: "high", createdAt: "2026-01-01", timeoutMs: 1, toolAllowlist: [], toolAllowlistOmittedCount: 0, toolBlocklist: [], toolBlocklistOmittedCount: 0, approvalPolicy: { mode: "approval_gated" }, limits: { scope: { targetFiles: { values: [], omittedCount: 0 }, targetSubsystems: { values: [], omittedCount: 0 }, avoidAreas: { values: [], omittedCount: 0 } }, sensitivity: { sensitivePatterns: { values: [], omittedCount: 0 }, forbiddenPatterns: { values: [], omittedCount: 0 } }, postconditions: { verificationRequired: true, validationPlan: { values: [], omittedCount: 0 }, validationCommands: { values: [], omittedCount: 0 } }, egress: { filter: false, allowHosts: { values: [], omittedCount: 0 } } } },
    invocationIntent: { intent: "change one file", expectedOutputs: [], expectedOutputsOmittedCount: 0 },
    durableAuthorization: { items: [], omittedCount: 0 }, approvals: [], outcome: { terminal: null, unresolved: null, error: null },
    mutationEvidence: { receiptIds: [], changedPaths: [], receiptCount: 0, changedPathCount: 0, items: [], omittedCount: 0 },
    verificationEvidence: { required: true, satisfied: false, receiptIds: [], checks: [], checksOmittedCount: 0, receipts: [], receiptsOmittedCount: 0 },
    artifactEvidence: { items: [], omittedCount: 0 }, workerEvidence: { refinedContract: null, sandbox: null, egressDenialCount: 0, egressDenials: [], egressDenialsOmittedCount: 0 },
    completion: { terminalEvent: null, genericCompletionProof: null, workflowSpecificEvidence: null, integrityWarning: null }, uncertainty: [], chronology: { items: [], omittedCount: 0 }, ...overrides,
  } as RunInspectorProjectionV1
}

describe("canonical inspector state", () => {
  test("distinguishes unreadable authority from legacy unsupported without fallback", () => {
    expect(presentCanonicalInspector(unreadable, "operator")[0]).toMatchObject({ title: "CANONICAL AUTHORITY UNREADABLE", warning: true })
    expect(presentCanonicalInspector(legacy, "operator")[0]).toMatchObject({ title: "CANONICAL INSPECTOR UNSUPPORTED", warning: true })
  })

  test("only a validated canonical projection may survive a refresh failure as stale", () => {
    expect(rejectCanonicalInspectorRead(initialCanonicalInspectorState(), new Error("offline"))).toMatchObject({ status: "unavailable", stale: false })
    const canonicalReady = acceptCanonicalInspectorRead(canonical())
    const stale = rejectCanonicalInspectorRead(canonicalReady, new Error("offline"))
    expect(stale).toMatchObject({ status: "stale", stale: true, snapshot: { kind: "canonical" } })
    expect(rejectCanonicalInspectorRead(acceptCanonicalInspectorRead(unreadable), new Error("offline"))).toMatchObject({ status: "unavailable", stale: false })
    expect(rejectCanonicalInspectorRead(acceptCanonicalInspectorRead(legacy), new Error("offline"))).toMatchObject({ status: "unavailable", stale: false })
    expect(acceptCanonicalInspectorRead(canonical())).toMatchObject({ status: "ready", stale: false, snapshot: { kind: "canonical" } })
  })

  test("refuses an otherwise valid inspector response for a different run", () => {
    expect(acceptCanonicalInspectorRead(canonical(), "run_2")).toMatchObject({
      status: "unavailable", stale: false, error: "Inspector response run mismatch: expected run_2.",
    })
  })

  test("shows unresolved work and integrity warnings rather than inferring success", () => {
    const view = presentCanonicalInspector(canonical({
      durableAuthorization: { items: [{ invocationId: "i", toolId: "write", executor: { kind: "builtin", id: "write" }, status: "authorized", authorization: { finalDisposition: "allowed", contractDisposition: "allowed", runtimeGuardDisposition: "allowed", permissionDisposition: "allowed", approvalIds: [], reasonCodes: [] } }], omittedCount: 0 },
      uncertainty: [{ code: "unresolved_invocations", detail: "A tool result is not recorded." }],
      completion: { terminalEvent: null, genericCompletionProof: null, workflowSpecificEvidence: null, integrityWarning: "completed_without_generic_completion_proof" },
      chronology: { items: [{ sequence: 3, eventId: "e", occurredAt: "now", category: "evidence", eventType: "verification_recorded" }], omittedCount: 2 },
    }), "inspect")
    expect(view.find((section) => section.title === "CURRENT EXECUTION TRUTH")?.lines).toContain("write: authorized; terminal result unknown")
    expect(view.find((section) => section.title === "UNCERTAINTY")?.lines.join(" ")).toContain("completion proof")
    expect(view.find((section) => section.title === "CHRONOLOGY")?.lines.join(" ")).toContain("+2 chronology items omitted")
  })

  test("keeps the locked evidence chain ordered and preserves approval, worker, and completion distinctions", () => {
    const result = canonical({
      approvals: [{ approvalId: "apr_1", type: "mutation", risk: "high", status: "pending", reason: "mutation boundary", source: "workflow", context: null, requestedAt: "now" }],
      durableAuthorization: { items: [{ invocationId: "i", toolId: "write", executor: { kind: "builtin", id: "write" }, status: "pending" }], omittedCount: 0 },
      workerEvidence: { refinedContract: null, sandbox: { provider: "sandbox", providerId: null, filesystem: "isolated", network: "filtered", reapedDescendants: true, egress: null, egressEnforcement: null, egressAllowHosts: { values: [], omittedCount: 0 } }, egressDenialCount: 0, egressDenials: [], egressDenialsOmittedCount: 0 },
      completion: { terminalEvent: { eventType: "run_completed", occurredAt: "now" }, genericCompletionProof: { decision: "accepted", failedChecks: [], verificationExecuted: true, receiptIds: ["r_1"], artifactChecks: true, expectedOutputChecks: true, expectedOutputTypesSatisfied: ["report"], expectedOutputTypesMissing: [], scopeChecks: true, sensitivePathApprovalChecks: true, checkedAt: "now" }, workflowSpecificEvidence: null, integrityWarning: null },
    })
    const operator = presentCanonicalInspector(result, "operator")
    const inspect = presentCanonicalInspector(result, "inspect")
    const evidence = operator.find((section) => section.title === "EVIDENCE CHAIN")?.lines ?? []

    expect(evidence.slice(0, 6)).toEqual([
      "Intent: recorded",
      "Authorization: pending",
      "Execution result: not recorded",
      "Mutation evidence: not observed",
      "Verification: required · absent",
      "Completion: proof accepted",
    ])
    expect(operator.find((section) => section.title === "APPROVAL HISTORY")?.lines).toContain("mutation: pending")
    expect(evidence.join(" ")).toContain("detailed worker actions unavailable")
    expect(operator.map((section) => section.title)).toEqual(inspect.map((section) => section.title))
    expect(inspect.find((section) => section.title === "CANONICAL AUTHORITY · READ ONLY")?.lines.join(" ")).toContain("Cursor: 9")
  })
})
