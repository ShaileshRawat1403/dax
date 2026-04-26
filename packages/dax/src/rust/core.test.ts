import { describe, expect, test } from "bun:test"
import { createRustProofReport, DaxCoreError, replayRunStateWithRust } from "./core"

function event(sequence: number, type: string, payload: Record<string, unknown>) {
  return {
    eventId: `evt_${sequence}`,
    sequence,
    cursor: `cursor_${sequence}`,
    runId: "run_1",
    timestamp: `2026-04-26T00:00:0${sequence}Z`,
    type,
    payload,
  }
}

const COMPLETED_EVENTS = [
  event(1, "run.created", { status: "created", title: "Test run" }),
  event(2, "run.state_changed", { previousStatus: "created", currentStatus: "compiled", reason: "contract compiled" }),
  event(3, "run.state_changed", { previousStatus: "compiled", currentStatus: "queued", reason: "queued" }),
  event(4, "run.started", { status: "running" }),
  event(5, "run.completed", { status: "completed", summaryAvailable: true }),
]

describe("rust dax-core adapter", () => {
  test(
    "replays a completed run through the Rust sidecar",
    async () => {
      const state = await replayRunStateWithRust(COMPLETED_EVENTS)

      expect(state.runId).toBe("run_1")
      expect(state.status).toBe("completed")
      expect(state.pendingApprovalIds).toEqual([])
      expect(state.currentStepId).toBeNull()
      expect(state.completedAt).toBe("2026-04-26T00:00:05Z")
    },
    60_000,
  )

  test(
    "creates a deterministic proof report through the Rust sidecar",
    async () => {
      const events = [
        event(1, "run.created", { status: "created", title: "Test run" }),
        event(2, "run.state_changed", {
          previousStatus: "created",
          currentStatus: "compiled",
          reason: "contract compiled",
        }),
      ]

      const report = await createRustProofReport(events)

      expect(report.schemaVersion).toBe("dax.core.proof.v1")
      expect(report.result).toBe("pass")
      expect(report.eventCount).toBe(2)
      expect(report.stateHash).toMatch(/^sha256:/)
      expect(report.eventSequenceHash).toMatch(/^sha256:/)
    },
    60_000,
  )

  test(
    "proof is deterministic — same events produce same hashes",
    async () => {
      const a = await createRustProofReport(COMPLETED_EVENTS)
      const b = await createRustProofReport(COMPLETED_EVENTS)

      expect(a.stateHash).toBe(b.stateHash)
      expect(a.eventSequenceHash).toBe(b.eventSequenceHash)
    },
    60_000,
  )

  test(
    "surfaces Rust replay failures as structured DaxCoreError",
    async () => {
      const events = [event(1, "run.started", { status: "running" })]

      await expect(replayRunStateWithRust(events)).rejects.toBeInstanceOf(DaxCoreError)
    },
    60_000,
  )
})
