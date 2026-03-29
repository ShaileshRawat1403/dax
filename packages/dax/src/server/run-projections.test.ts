import { describe, expect, test } from "bun:test"
import { buildInterventionProjection, buildProposedChangesProjection } from "./run-projections"
import type { ApprovalRecord, RunEvent } from "./run-contract"

describe("run projections", () => {
  test("keeps approved proposed changes distinct from applied changes", () => {
    const approvals: ApprovalRecord[] = [
      {
        approvalId: "approval_1",
        runId: "run_1",
        type: "patch_apply",
        status: "approved",
        risk: "medium",
        title: "Apply patch",
        reason: "Patch the file",
        context: {
          filePath: "src/index.ts",
          diffPreview: "--- a/src/index.ts\n+++ b/src/index.ts",
        },
        createdAt: "2026-03-29T10:00:00.000Z",
        updatedAt: "2026-03-29T10:01:00.000Z",
        resolvedAt: "2026-03-29T10:01:00.000Z",
        resolution: {
          decision: "approve",
          source: "system",
        },
      },
    ]

    const projected = buildProposedChangesProjection(approvals)

    expect(projected).toHaveLength(1)
    expect(projected[0].status).toBe("approved_not_applied")
  })

  test("tracks intervention resolution state from the event stream", () => {
    const events: RunEvent[] = [
      {
        schemaVersion: "v1",
        eventId: "event_1",
        sequence: 1,
        cursor: "cursor_1",
        runId: "run_1",
        type: "intervention.required",
        timestamp: "2026-03-29T10:00:00.000Z",
        payload: {
          interventionId: "int_1",
          reason: "Need clarification",
          kind: "ambiguity",
        },
      },
      {
        schemaVersion: "v1",
        eventId: "event_2",
        sequence: 2,
        cursor: "cursor_2",
        runId: "run_1",
        type: "intervention.resolved",
        timestamp: "2026-03-29T10:02:00.000Z",
        payload: {
          interventionId: "int_1",
          status: "resolved",
          resolvedAt: "2026-03-29T10:02:00.000Z",
        },
      },
    ]

    const projected = buildInterventionProjection(events)

    expect(projected).toHaveLength(1)
    expect(projected[0].status).toBe("resolved")
    expect(projected[0].resolvedAt).toBe("2026-03-29T10:02:00.000Z")
  })
})
