import { describe, expect, test } from "bun:test"
import { buildEvidenceLedger, evidenceSeverityGlyph } from "./evidence-ledger"
import type { ProjectedRun } from "@/server/run-contract"

function makeRun(overrides: Partial<ProjectedRun> = {}): ProjectedRun {
  return {
    header: {
      runId: "run-001",
      status: "running",
      createdAt: "2026-05-07T10:00:00Z",
      updatedAt: "2026-05-07T10:00:00Z",
    },
    summary: undefined,
    narrative: [],
    approvals: [],
    artifacts: [],
    interventions: [],
    proposedChanges: [],
    ...overrides,
  }
}

describe("buildEvidenceLedger", () => {
  test("returns empty array for undefined run", () => {
    expect(buildEvidenceLedger(undefined)).toEqual([])
  })

  test("returns empty array for run with no evidence", () => {
    expect(buildEvidenceLedger(makeRun())).toEqual([])
  })

  test("maps artifact to produced/success evidence", () => {
    const run = makeRun({
      artifacts: [
        {
          artifactId: "art-1",
          runId: "run-001",
          type: "report",
          title: "Lifecycle patch summary",
          createdAt: "2026-05-07T10:05:00Z",
          path: "/tmp/report.md",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      id: "artifact:art-1",
      kind: "artifact",
      status: "produced",
      severity: "success",
      title: "Artifact produced: Lifecycle patch summary",
      proofLabel: "report",
      proofRef: "art-1",
      inspectable: true,
    })
  })

  test("maps pending approval to pending/warning evidence", () => {
    const run = makeRun({
      approvals: [
        {
          approvalId: "appr-1",
          runId: "run-001",
          type: "patch_apply",
          status: "pending",
          risk: "high",
          title: "Apply patch to workstation.ts",
          reason: "Modifies lifecycle type definition",
          createdAt: "2026-05-07T10:02:00Z",
          updatedAt: "2026-05-07T10:02:00Z",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      kind: "approval",
      status: "pending",
      severity: "warning",
      proofLabel: "high risk",
    })
  })

  test("maps approved approval to approved/success evidence", () => {
    const run = makeRun({
      approvals: [
        {
          approvalId: "appr-2",
          runId: "run-001",
          type: "command_execute",
          status: "approved",
          risk: "medium",
          title: "Run tests",
          reason: "Validate patch",
          createdAt: "2026-05-07T10:03:00Z",
          updatedAt: "2026-05-07T10:04:00Z",
          resolvedAt: "2026-05-07T10:04:00Z",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ status: "approved", severity: "success" })
  })

  test("maps denied approval to denied/error evidence", () => {
    const run = makeRun({
      approvals: [
        {
          approvalId: "appr-3",
          runId: "run-001",
          type: "file_write",
          status: "denied",
          risk: "critical",
          title: "Write to protected path",
          reason: "Sensitive directory",
          createdAt: "2026-05-07T10:01:00Z",
          updatedAt: "2026-05-07T10:01:30Z",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ status: "denied", severity: "error" })
  })

  test("maps applied proposed change to verified/info evidence", () => {
    const run = makeRun({
      proposedChanges: [
        {
          changeId: "chg-1",
          runId: "run-001",
          type: "file_edit",
          filePath: "workstation.ts",
          diff: "@@ -1 +1 @@\n-old\n+new",
          status: "applied",
          createdAt: "2026-05-07T10:06:00Z",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ status: "verified", severity: "info", inspectable: true })
  })

  test("maps rejected proposed change to denied/error evidence", () => {
    const run = makeRun({
      proposedChanges: [
        {
          changeId: "chg-2",
          runId: "run-001",
          type: "file_edit",
          filePath: "config.ts",
          diff: "@@ -1 +1 @@\n-a\n+b",
          status: "rejected",
          createdAt: "2026-05-07T10:07:00Z",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ status: "denied", severity: "error" })
  })

  test("maps approved_not_applied proposed change to pending evidence", () => {
    const run = makeRun({
      proposedChanges: [
        {
          changeId: "chg-3",
          runId: "run-001",
          type: "patch",
          filePath: "index.ts",
          diff: "@@ -1 +1 @@\n-x\n+y",
          status: "approved_not_applied",
          createdAt: "2026-05-07T10:08:00Z",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ status: "pending" })
  })

  test("maps stale proposed change to observed evidence", () => {
    const run = makeRun({
      proposedChanges: [
        {
          changeId: "chg-4",
          runId: "run-001",
          type: "file_create",
          filePath: "new-file.ts",
          diff: "+content",
          status: "stale",
          createdAt: "2026-05-07T10:09:00Z",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ status: "observed" })
  })

  test("maps resolved intervention to verified/success evidence", () => {
    const run = makeRun({
      interventions: [
        {
          interventionId: "int-1",
          runId: "run-001",
          kind: "approval",
          status: "resolved",
          title: "Manual review required",
          reason: "High blast radius detected",
          createdAt: "2026-05-07T10:10:00Z",
          resolvedAt: "2026-05-07T10:12:00Z",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ status: "verified", severity: "success" })
  })

  test("maps escalated intervention to blocked/error evidence", () => {
    const run = makeRun({
      interventions: [
        {
          interventionId: "int-2",
          runId: "run-001",
          kind: "risk_escalation",
          status: "escalated",
          title: "Policy violation escalated",
          reason: "Unsafe command attempted",
          createdAt: "2026-05-07T10:11:00Z",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ status: "blocked", severity: "error" })
  })

  test("maps audit.posture_updated narrative to audit/info evidence", () => {
    const run = makeRun({
      narrative: [
        {
          id: "evt-1",
          timestamp: "2026-05-07T10:13:00Z",
          type: "audit.posture_updated",
          message: "Trust posture updated: GUARDED",
          metadata: { score: 72, finding: { type: "scope", severity: "minor", title: "Scope too broad" } },
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      kind: "audit",
      status: "observed",
      severity: "info",
      proofLabel: "score 72",
    })
  })

  test("maps run.failed narrative to failed/error evidence", () => {
    const run = makeRun({
      narrative: [
        {
          id: "evt-2",
          timestamp: "2026-05-07T10:14:00Z",
          type: "run.failed",
          message: "Run failed: tool timeout",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ kind: "step", status: "failed", severity: "error" })
  })

  test("maps run.completed narrative to verified/success evidence", () => {
    const run = makeRun({
      narrative: [
        {
          id: "evt-3",
          timestamp: "2026-05-07T10:15:00Z",
          type: "run.completed",
          message: "Run completed successfully",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)

    expect(ledger[0]).toMatchObject({ kind: "step", status: "verified", severity: "success" })
  })

  test("excludes step.completed narrative to avoid flooding ledger", () => {
    const run = makeRun({
      narrative: [
        { id: "s1", timestamp: "2026-05-07T10:01:00Z", type: "step.completed", message: "Step 1 done" },
        { id: "s2", timestamp: "2026-05-07T10:02:00Z", type: "step.completed", message: "Step 2 done" },
        { id: "s3", timestamp: "2026-05-07T10:03:00Z", type: "step.completed", message: "Step 3 done" },
      ],
    })

    expect(buildEvidenceLedger(run)).toHaveLength(0)
  })

  test("deduplicates narrative items with the same id and type", () => {
    // Two audit narrative items with the same event id should collapse to one
    const run = makeRun({
      narrative: [
        {
          id: "evt-audit-1",
          timestamp: "2026-05-07T10:05:00Z",
          type: "audit.posture_updated",
          message: "Trust updated: first",
          metadata: { score: 60 },
        },
        {
          id: "evt-audit-1", // same id — duplicate
          timestamp: "2026-05-07T10:05:00Z",
          type: "audit.posture_updated",
          message: "Trust updated: first",
          metadata: { score: 60 },
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)
    expect(ledger).toHaveLength(1)
  })

  test("sorts all evidence by timestamp ascending", () => {
    const run = makeRun({
      artifacts: [
        {
          artifactId: "art-late",
          runId: "run-001",
          type: "log",
          title: "Late artifact",
          createdAt: "2026-05-07T10:30:00Z",
        },
      ],
      approvals: [
        {
          approvalId: "appr-early",
          runId: "run-001",
          type: "tool_use",
          status: "approved",
          risk: "low",
          title: "Early approval",
          reason: "Safe tool",
          createdAt: "2026-05-07T10:01:00Z",
          updatedAt: "2026-05-07T10:01:00Z",
        },
      ],
      narrative: [
        {
          id: "mid-evt",
          timestamp: "2026-05-07T10:15:00Z",
          type: "run.completed",
          message: "Done",
        },
      ],
    })

    const ledger = buildEvidenceLedger(run)
    const timestamps = ledger.map((i) => i.timestamp)
    expect(timestamps).toEqual([...timestamps].sort())
  })
})

describe("evidenceSeverityGlyph", () => {
  test("returns correct glyph for each severity", () => {
    expect(evidenceSeverityGlyph("success")).toBe("✓")
    expect(evidenceSeverityGlyph("warning")).toBe("⚠")
    expect(evidenceSeverityGlyph("error")).toBe("✕")
    expect(evidenceSeverityGlyph("info")).toBe("●")
    expect(evidenceSeverityGlyph("neutral")).toBe("○")
  })
})
