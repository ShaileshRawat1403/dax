import { describe, expect, test } from "bun:test"
import type { ApprovalRecord, ArtifactRecord, RunEvent, RunSnapshot } from "@/server/run-contract"
import { buildCapabilityReceipt, computeEvidenceDigest, mapCapabilityFailureCode } from "./capability-adapter"
import { CapabilityRunReceipt } from "./capability-contract"

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: "v1",
    authority: "dax-state-machine",
    runId: "run_123",
    status: "completed",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:01.000Z",
    startedAt: "2026-07-10T00:00:00.000Z",
    completedAt: "2026-07-10T00:00:01.000Z",
    pendingApprovalCount: 0,
    artifactSummary: { total: 1, byType: { report: 1 }, latestArtifactIds: ["art_1"] },
    lastEvent: null,
    ...overrides,
  }
}

const artifact: ArtifactRecord = {
  artifactId: "art_1",
  runId: "run_123",
  type: "report",
  title: "Repository analysis",
  createdAt: "2026-07-10T00:00:01.000Z",
  path: "reports/repo.md",
}

const event: RunEvent = {
  schemaVersion: "v1",
  eventId: "evt_1",
  sequence: 1,
  cursor: "evt_1",
  runId: "run_123",
  timestamp: "2026-07-10T00:00:01.000Z",
  type: "run.completed",
  payload: { status: "completed", summaryAvailable: true },
}

describe("Flowright capability receipt adapter", () => {
  test("builds a valid succeeded receipt without mirroring DAX internals", () => {
    const receipt = buildCapabilityReceipt({
      capability: "dax.repo_analyze",
      invocationId: "cap_123",
      snapshot: snapshot(),
      approvals: [],
      artifacts: [artifact],
      events: [event],
      deepLink: "/runs/run_123",
    })

    expect(CapabilityRunReceipt.parse(receipt)).toEqual(receipt)
    expect(receipt.contractVersion).toBe("flowright.capability.v0")
    expect(receipt.terminalState).toBe("succeeded")
    expect(receipt.externalRunId).toBe("run_123")
    expect(receipt.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(receipt.artifacts).toEqual([
      {
        ref: "reports/repo.md",
        type: "report",
        title: "Repository analysis",
      },
    ])
  })

  test("surfaces pending DAX approvals as delegated Flowright gates", () => {
    const approval: ApprovalRecord = {
      approvalId: "apr_123",
      runId: "run_123",
      type: "workflow_gate",
      status: "pending",
      risk: "high",
      title: "Approve draft",
      reason: "DAX needs human approval before continuing.",
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    }
    const receipt = buildCapabilityReceipt({
      capability: "dax.draft_and_approve",
      invocationId: "cap_approval",
      snapshot: snapshot({ status: "waiting_approval", pendingApprovalCount: 1, completedAt: undefined }),
      approvals: [approval],
      artifacts: [],
      events: [],
    })

    expect(receipt.terminalState).toBe("needs_approval")
    expect(receipt.approvals).toEqual([
      {
        gateId: "apr_123",
        status: "pending",
        summary: "Approve draft: DAX needs human approval before continuing.",
      },
    ])
    expect(receipt.failure).toBeUndefined()
  })

  test("maps DAX terminal reasons onto Flowright's closed failure taxonomy", () => {
    expect(mapCapabilityFailureCode({ status: "failed", terminalReason: "workflow_rejected" })).toBe(
      "approval_rejected",
    )
    expect(mapCapabilityFailureCode({ status: "failed", terminalReason: "permission_denied" })).toBe("policy_denied")
    expect(mapCapabilityFailureCode({ status: "failed", terminalReason: "execution_error" })).toBe(
      "verification_failed",
    )
    expect(mapCapabilityFailureCode({ status: "failed", terminalReason: "timeout" })).toBe("capability_timeout")
  })

  test("fails closed when invocation does not reach terminal or approval state in time", () => {
    const receipt = buildCapabilityReceipt({
      capability: "dax.repo_analyze",
      invocationId: "cap_timeout",
      snapshot: snapshot({ status: "running", completedAt: undefined }),
      approvals: [],
      artifacts: [],
      events: [],
      timeoutReason: "DAX run did not reach a terminal state.",
    })

    expect(receipt.terminalState).toBe("failed")
    expect(receipt.failure).toEqual({
      code: "capability_timeout",
      reason: "DAX run did not reach a terminal state.",
      retryable: true,
    })
    expect(receipt.evidenceDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
  })

  test("evidence digest changes when DAX-owned evidence changes", () => {
    // Under runledger.evidence.v0 the digest covers evidence RECORDS, not the
    // raw snapshot: run status alone is not evidence (state transitions come
    // from run.state_changed events). Vary evidence-visible inputs.
    const stateChanged: RunEvent = {
      ...event,
      eventId: "evt_2",
      sequence: 2,
      cursor: "evt_2",
      type: "run.state_changed",
      payload: { previousStatus: "running", currentStatus: "completed" },
    } as RunEvent

    const first = computeEvidenceDigest({ snapshot: snapshot(), approvals: [], artifacts: [artifact], events: [stateChanged] })
    const withoutTransition = computeEvidenceDigest({
      snapshot: snapshot(),
      approvals: [],
      artifacts: [artifact],
      events: [],
    })
    const differentArtifact = computeEvidenceDigest({
      snapshot: snapshot(),
      approvals: [],
      artifacts: [{ ...artifact, title: "Different Report" }],
      events: [stateChanged],
    })

    expect(first).not.toBe(withoutTransition)
    expect(first).not.toBe(differentArtifact)

    // Run status alone (no evidence-record change) does NOT move the digest —
    // the receipt's terminalState covers status; evidence covers evidence.
    const statusOnly = computeEvidenceDigest({
      snapshot: snapshot({ status: "failed", terminalReason: "execution_error" }),
      approvals: [],
      artifacts: [artifact],
      events: [stateChanged],
    })
    expect(statusOnly).toBe(first)
  })
})
