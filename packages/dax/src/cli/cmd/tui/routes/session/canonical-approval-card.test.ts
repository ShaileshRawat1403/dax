import { describe, expect, test } from "bun:test"
import type { RunInspectorProjectionV1 } from "@/server/run-inspector-projection"
import {
  canResolveCanonicalApproval,
  canonicalApprovalHeading,
  canonicalApprovalResolutionRequest,
  pendingCanonicalApprovalCount,
  presentCanonicalApproval,
  resolveThenReadCanonicalApproval,
  selectAdjacentCanonicalApproval,
  selectCanonicalApproval,
} from "./canonical-approval-card"

function canonical(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "run-inspector.v1", kind: "canonical", runId: "run_1",
    authority: { source: "event-log", validated: true, eventSequence: 9, cursor: "9" }, canonicalStatus: "waiting_approval",
    contract: { contractId: "ctr_1", workflowClass: "generic", executionMode: "approval_gated", riskLevel: "high", createdAt: "now", timeoutMs: 1, toolAllowlist: [], toolAllowlistOmittedCount: 0, toolBlocklist: [], toolBlocklistOmittedCount: 0, approvalPolicy: { mode: "approval_gated" }, limits: { scope: { targetFiles: { values: ["src/settings.ts"], omittedCount: 0 }, targetSubsystems: { values: [], omittedCount: 0 }, avoidAreas: { values: [], omittedCount: 0 } }, sensitivity: { sensitivePatterns: { values: [], omittedCount: 0 }, forbiddenPatterns: { values: [], omittedCount: 0 } }, postconditions: { verificationRequired: false, validationPlan: { values: [], omittedCount: 0 }, validationCommands: { values: [], omittedCount: 0 } }, egress: { filter: true, allowHosts: { values: [], omittedCount: 0 } } } },
    invocationIntent: { intent: "update settings", expectedOutputs: [], expectedOutputsOmittedCount: 0 },
    durableAuthorization: { items: [{ invocationId: "inv_1", toolId: "write", executor: { kind: "builtin", id: "write" }, status: "pending" }], omittedCount: 0 },
    approvals: [{ approvalId: "apr_1", type: "file_write", risk: "high", status: "pending", title: "Write settings", reason: "bounded configuration update", expectedConsequence: "settings file may change", source: "permission", context: { filePath: "src/settings.ts", toolName: "write", diffPreview: "-old\n+new" }, requestedAt: "now", correlationId: "inv_1" }],
    outcome: { terminal: null, unresolved: { canonicalStatus: "waiting_approval", currentStepId: null, pendingApprovalIds: ["apr_1"] }, error: null },
    mutationEvidence: { receiptIds: [], changedPaths: [], receiptCount: 0, changedPathCount: 0, items: [], omittedCount: 0 }, verificationEvidence: { required: false, satisfied: false, receiptIds: [], checks: [], checksOmittedCount: 0, receipts: [], receiptsOmittedCount: 0 }, artifactEvidence: { items: [], omittedCount: 0 }, workerEvidence: { refinedContract: null, sandbox: null, egressDenialCount: 0, egressDenials: [], egressDenialsOmittedCount: 0 }, completion: { terminalEvent: null, genericCompletionProof: null, workflowSpecificEvidence: null, integrityWarning: null }, uncertainty: [], chronology: { items: [], omittedCount: 0 }, ...overrides,
  } as RunInspectorProjectionV1
}

describe("canonical approval card", () => {
  test("renders pending canonical facts and exact correlated context", () => {
    const card = presentCanonicalApproval(canonical())
    expect(card).toMatchObject({ risk: "high", reason: "bounded configuration update", expectedConsequence: "settings file may change" })
    expect(card?.correlation).toBe("Invocation inv_1 · write")
    expect(card?.actionContext).toContain("Path: src/settings.ts")
    expect(card?.scope).toContain("src/settings.ts")
  })

  test("discloses absent consequence, target, and correlation without inference", () => {
    const snapshot = canonical({ approvals: [{ approvalId: "apr_1", type: "tool_use", risk: "medium", status: "pending", source: "workflow", context: null, requestedAt: "now" }], durableAuthorization: { items: [], omittedCount: 0 } })
    expect(presentCanonicalApproval(snapshot)).toMatchObject({ expectedConsequence: "Expected consequence not recorded.", actionContext: "Exact target not recorded.", correlation: "No invocation correlation recorded." })
  })

  test("uses projection order for pending selection while retaining a resolved selection", () => {
    const snapshot = canonical({ approvals: [
      { approvalId: "apr_1", type: "tool_use", risk: "low", status: "approved", source: "workflow", context: null, requestedAt: "one", decidedAt: "two", decidedBy: "operator" },
      { approvalId: "apr_2", type: "tool_use", risk: "high", status: "pending", source: "workflow", context: null, requestedAt: "three" },
      { approvalId: "apr_3", type: "tool_use", risk: "medium", status: "pending", source: "workflow", context: null, requestedAt: "four" },
    ] })
    expect(selectCanonicalApproval(snapshot)?.approvalId).toBe("apr_2")
    expect(selectCanonicalApproval(snapshot, "apr_1")?.approvalId).toBe("apr_1")
    expect(selectAdjacentCanonicalApproval(snapshot, "apr_2", 1)?.approvalId).toBe("apr_3")
    expect(selectAdjacentCanonicalApproval(snapshot, "apr_3", 1)?.approvalId).toBe("apr_1")
    expect(pendingCanonicalApprovalCount(snapshot)).toBe(2)
    expect(presentCanonicalApproval(snapshot, "apr_1")).toMatchObject({
      status: "approved", decidedBy: "operator", decidedAt: "two",
    })
    expect(canonicalApprovalHeading("pending")).toBe("DECISION REQUIRED")
    expect(canonicalApprovalHeading("approved")).toBe("APPROVAL RECORDED")
  })

  test("builds the existing canonical resolution request with stable TUI provenance", () => {
    const request = canonicalApprovalResolutionRequest("run /1", "apr /1", "approve")
    expect(request.path).toBe("/runs/run%20%2F1/approvals/apr%20%2F1")
    expect(request.init.method).toBe("POST")
    expect(request.init.headers).toEqual({ "content-type": "application/json" })
    expect(JSON.parse(String(request.init.body))).toEqual({
      decision: "approve",
      actorId: "tui-operator",
      source: "dax",
    })
  })

  test("allows exactly fresh pending canonical approvals and records one request before a fresh read", async () => {
    const snapshot = canonical()
    expect(canResolveCanonicalApproval({ state: { status: "ready", stale: false, snapshot }, runId: "run_1", approvalId: "apr_1", inFlight: false })).toBe(true)
    expect(canResolveCanonicalApproval({ state: { status: "stale", stale: true, snapshot, error: "offline" }, runId: "run_1", approvalId: "apr_1", inFlight: false })).toBe(false)
    expect(canResolveCanonicalApproval({ state: { status: "unavailable", stale: false, error: "invalid response" }, runId: "run_1", approvalId: "apr_1", inFlight: false })).toBe(false)
    expect(canResolveCanonicalApproval({ state: { status: "ready", stale: false, snapshot: { schemaVersion: "run-inspector.v1", kind: "authority_unreadable", runId: "run_1", reason: "canonical_log_unreadable" } }, runId: "run_1", approvalId: "apr_1", inFlight: false })).toBe(false)
    expect(canResolveCanonicalApproval({ state: { status: "ready", stale: false, snapshot: { schemaVersion: "run-inspector.v1", kind: "legacy_unsupported", runId: "run_1", reason: "legacy_authority" } }, runId: "run_1", approvalId: "apr_1", inFlight: false })).toBe(false)
    expect(canResolveCanonicalApproval({ state: { status: "ready", stale: false, snapshot }, runId: "run_1", approvalId: "apr_1", inFlight: true })).toBe(false)

    const calls: string[] = []
    await resolveThenReadCanonicalApproval({
      resolve: async (_id, decision) => { calls.push(`resolve:${decision}`) },
      read: async () => { calls.push("read"); return snapshot },
    }, "apr_1", "approve")
    expect(calls).toEqual(["resolve:approve", "read"])

    calls.length = 0
    await resolveThenReadCanonicalApproval({
      resolve: async (_id, decision) => { calls.push(`resolve:${decision}`) },
      read: async () => { calls.push("read"); return snapshot },
    }, "apr_1", "deny")
    expect(calls).toEqual(["resolve:deny", "read"])
  })

  test("does not read or project a decision after a failed request", async () => {
    const calls: string[] = []
    await expect(resolveThenReadCanonicalApproval({
      resolve: async () => { calls.push("resolve"); throw new Error("rejected") },
      read: async () => { calls.push("read"); return canonical() },
    }, "apr_1", "approve")).rejects.toThrow("rejected")
    expect(calls).toEqual(["resolve"])
  })
})
