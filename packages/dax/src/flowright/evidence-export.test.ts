import { describe, expect, test } from "bun:test"
import type { ApprovalRecord, ArtifactRecord, RunEvent, RunSnapshot } from "@/server/run-contract"
import { buildCapabilityReceipt } from "./capability-adapter"
import {
  EvidenceRecordV0,
  buildEvidenceExport,
  buildEvidenceRecords,
  canonicalJson,
  computeBodyDigest,
  computeBundleDigest,
} from "./evidence-export"

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    schemaVersion: "v1",
    authority: "dax",
    runId: "run-evidence-1",
    status: "completed",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:05:00.000Z",
    startedAt: "2026-07-10T00:00:01.000Z",
    completedAt: "2026-07-10T00:05:00.000Z",
    pendingApprovalCount: 0,
    ...overrides,
  } as RunSnapshot
}

function stateChangedEvent(sequence: number, previousStatus: string, currentStatus: string, timestamp: string): RunEvent {
  return {
    eventId: `evt-${sequence}`,
    sequence,
    cursor: `c-${sequence}`,
    runId: "run-evidence-1",
    type: "run.state_changed",
    timestamp,
    payload: { previousStatus, currentStatus },
  } as unknown as RunEvent
}

function artifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    artifactId: "art-1",
    runId: "run-evidence-1",
    type: "report",
    title: "Analysis Report",
    createdAt: "2026-07-10T00:03:00.000Z",
    ...overrides,
  } as ArtifactRecord
}

function approval(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    approvalId: "gate-1",
    runId: "run-evidence-1",
    type: "workflow_gate",
    status: "approved",
    risk: "medium",
    title: "Approve draft",
    reason: "Human gate before execution",
    createdAt: "2026-07-10T00:02:00.000Z",
    updatedAt: "2026-07-10T00:04:00.000Z",
    resolvedAt: "2026-07-10T00:04:00.000Z",
    resolution: { decision: "approve", actorId: "flowright-operator", source: "soothsayer" },
    ...overrides,
  } as ApprovalRecord
}

const baseInput = () => ({
  snapshot: snapshot(),
  approvals: [approval()],
  artifacts: [artifact()],
  events: [
    stateChangedEvent(1, "created", "running", "2026-07-10T00:00:01.000Z"),
    stateChangedEvent(2, "running", "waiting_approval", "2026-07-10T00:02:00.000Z"),
    stateChangedEvent(3, "waiting_approval", "completed", "2026-07-10T00:05:00.000Z"),
  ],
  invocationId: "inv-1",
})

describe("canonicalJson", () => {
  test("sorts keys and drops undefined (byte-compatible with Flowright)", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, { z: 3, y: 4 }] } })).toBe('{"a":{"c":[2,{"y":4,"z":3}]},"b":1}')
  })
})

describe("buildEvidenceRecords", () => {
  test("projects transitions, artifacts, and resolved approvals in deterministic order", () => {
    const records = buildEvidenceRecords(baseInput())
    expect(records.map((r) => r.class)).toEqual([
      "state_transition",
      "state_transition",
      "artifact_snapshot",
      "human_decision_record",
      "state_transition",
    ])
    // Chain links: each prevDigest points at the previous bodyDigest.
    records.forEach((record, i) => {
      if (i === 0) expect(record.integrity.prevDigest).toBeUndefined()
      else expect(record.integrity.prevDigest).toBe(records[i - 1].integrity.bodyDigest)
    })
    // Every record validates against the schema.
    for (const record of records) expect(EvidenceRecordV0.safeParse(record).success).toBe(true)
  })

  test("body digests are recomputable and tamper-evident", () => {
    const records = buildEvidenceRecords(baseInput())
    const { integrity, ...body } = records[0]
    expect(computeBodyDigest(body)).toBe(integrity.bodyDigest)
    const tamperedBody = { ...body, payload: { ...body.payload, to: "failed" } }
    expect(computeBodyDigest(tamperedBody)).not.toBe(integrity.bodyDigest)
  })

  test("approvals without actor identity produce no human-authority evidence", () => {
    const input = baseInput()
    input.approvals = [approval({ resolution: { decision: "approve", source: "system" } })]
    const records = buildEvidenceRecords(input)
    expect(records.some((r) => r.class === "human_decision_record")).toBe(false)
  })

  test("artifact without stored digest is honest about digest scope", () => {
    const records = buildEvidenceRecords(baseInput())
    const snap = records.find((r) => r.class === "artifact_snapshot")!
    expect(snap.payload.digestScope).toBe("descriptor")
    const withDigest = baseInput()
    withDigest.artifacts = [artifact({ metadata: { digest: "sha256:realcontent" } } as Partial<ArtifactRecord>)]
    const snap2 = buildEvidenceRecords(withDigest).find((r) => r.class === "artifact_snapshot")!
    expect(snap2.payload.digestScope).toBe("content")
    expect(snap2.payload.contentDigest).toBe("sha256:realcontent")
  })
})

describe("receipt <-> evidence export meeting point", () => {
  test("receipt evidenceDigest equals the export bundle digest (recomputable verification)", () => {
    const input = baseInput()
    const receipt = buildCapabilityReceipt({
      capability: "dax.repo_analyze",
      ...input,
    })
    const exported = buildEvidenceExport(input)
    expect(receipt.evidenceDigest).toBe(exported.bundleDigest)
    expect(exported.bundleDigest).toBe(computeBundleDigest(exported.records))
  })

  test("bundle digest is order-sensitive", () => {
    const exported = buildEvidenceExport(baseInput())
    const reversed = [...exported.records].reverse()
    expect(computeBundleDigest(reversed)).not.toBe(exported.bundleDigest)
  })
})
