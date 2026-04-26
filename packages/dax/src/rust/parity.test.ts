import { describe, expect, test } from "bun:test"
import type { RunEvent } from "@/server/run-contract"
import { replayRunState } from "@/state/replay"
import { replayRunStateWithRust, type DaxCoreRunState } from "./core"

// Build a RunEvent-compatible object. The runtime schema is the same for both
// TypeScript replay and Rust replay — schemaVersion + envelope + typed payload.
function e(
  sequence: number,
  runId: string,
  timestamp: string,
  type: string,
  payload: Record<string, unknown>,
): RunEvent {
  return {
    schemaVersion: "v1",
    eventId: `evt_${sequence}`,
    sequence,
    cursor: `c${sequence}`,
    runId,
    timestamp,
    type,
    payload,
  } as unknown as RunEvent
}

// Canonical event log shared by both TypeScript and Rust in the main parity test
const PARITY_EVENTS: RunEvent[] = [
  e(1,  "run_parity", "2026-04-26T10:00:01Z", "run.created",       { status: "created", title: "Parity test run" }),
  e(2,  "run_parity", "2026-04-26T10:00:02Z", "run.state_changed", { previousStatus: "created",  currentStatus: "compiled", reason: "compiled" }),
  e(3,  "run_parity", "2026-04-26T10:00:03Z", "run.state_changed", { previousStatus: "compiled", currentStatus: "queued",   reason: "queued" }),
  e(4,  "run_parity", "2026-04-26T10:00:04Z", "run.started",       { status: "running" }),
  e(5,  "run_parity", "2026-04-26T10:00:05Z", "step.proposed",     { stepId: "step_1", title: "Analyse codebase" }),
  e(6,  "run_parity", "2026-04-26T10:00:06Z", "step.started",      { stepId: "step_1", title: "Analyse codebase" }),
  e(7,  "run_parity", "2026-04-26T10:00:07Z", "step.completed",    { stepId: "step_1", title: "Analyse codebase", durationMs: 800 }),
  e(8,  "run_parity", "2026-04-26T10:00:08Z", "artifact.created",  { artifact: { artifactId: "art_1" } }),
  e(9,  "run_parity", "2026-04-26T10:00:09Z", "audit.posture_updated", { trust: { posture: "moderate", score: 72.0, blocked: false, reasons: [] } }),
  e(10, "run_parity", "2026-04-26T10:00:10Z", "run.completed",     { status: "completed", summaryAvailable: true }),
]

// Fields that both TypeScript RunState and Rust DaxCoreRunState share
type ParitySnapshot = {
  runId: string
  status: string
  currentStepId: string | null
  pendingApprovalIds: string[]
  artifactIds: string[]
  startedAt: string | null
  completedAt: string | null
  stepCount: number
  stepStatuses: string[]
  trustPosture: string | null
}

function snapshotTs(state: ReturnType<typeof replayRunState>["state"]): ParitySnapshot {
  return {
    runId: state.runId,
    status: state.status,
    currentStepId: state.currentStepId,
    pendingApprovalIds: state.pendingApprovalIds,
    artifactIds: state.artifactIds,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    stepCount: state.steps.length,
    stepStatuses: state.steps.map((s) => s.status),
    trustPosture: state.trust?.posture ?? null,
  }
}

function snapshotRust(state: DaxCoreRunState): ParitySnapshot {
  return {
    runId: state.runId,
    status: state.status,
    currentStepId: state.currentStepId,
    pendingApprovalIds: state.pendingApprovalIds,
    artifactIds: state.artifactIds,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    stepCount: state.steps.length,
    stepStatuses: state.steps.map((s) => s.status),
    trustPosture: state.trust?.posture ?? null,
  }
}

describe("TypeScript / Rust replay parity", () => {
  test(
    "TypeScript and Rust produce the same final state for the same event log",
    async () => {
      const tsResult = replayRunState(PARITY_EVENTS)
      const rustState = await replayRunStateWithRust(PARITY_EVENTS)

      expect(snapshotRust(rustState)).toEqual(snapshotTs(tsResult.state))
    },
    60_000,
  )

  test(
    "TypeScript and Rust agree on terminal status across completed, failed, and cancelled runs",
    async () => {
      const scenarios = [
        {
          name: "completed",
          events: PARITY_EVENTS,
        },
        {
          name: "failed",
          events: [
            e(1, "run_fail", "2026-04-26T11:00:01Z", "run.created",  { status: "created" }),
            e(2, "run_fail", "2026-04-26T11:00:02Z", "run.started",  { status: "running" }),
            e(3, "run_fail", "2026-04-26T11:00:03Z", "run.failed",   { status: "failed", error: { code: "E_STEP", message: "step failed" } }),
          ],
        },
        {
          name: "cancelled",
          events: [
            e(1, "run_cancel", "2026-04-26T12:00:01Z", "run.created",      { status: "created" }),
            e(2, "run_cancel", "2026-04-26T12:00:02Z", "run.started",      { status: "running" }),
            e(3, "run_cancel", "2026-04-26T12:00:03Z", "run.state_changed", { previousStatus: "running", currentStatus: "cancelled", reason: "user cancelled" }),
          ],
        },
      ] as const

      for (const { name, events } of scenarios) {
        const tsStatus = replayRunState(events as unknown as RunEvent[]).state.status
        const rustStatus = (await replayRunStateWithRust([...events])).status
        expect(rustStatus, `status parity failed for "${name}"`).toBe(tsStatus)
      }
    },
    60_000,
  )

  test(
    "TypeScript and Rust agree on step-level outcomes",
    async () => {
      const events: RunEvent[] = [
        e(1, "run_steps", "2026-04-26T13:00:01Z", "run.created",   { status: "created" }),
        e(2, "run_steps", "2026-04-26T13:00:02Z", "run.started",   { status: "running" }),
        e(3, "run_steps", "2026-04-26T13:00:03Z", "step.proposed", { stepId: "s1", title: "Step one" }),
        e(4, "run_steps", "2026-04-26T13:00:04Z", "step.started",  { stepId: "s1", title: "Step one" }),
        e(5, "run_steps", "2026-04-26T13:00:05Z", "step.failed",   { stepId: "s1", title: "Step one", error: { code: "ERR", message: "fail" } }),
        e(6, "run_steps", "2026-04-26T13:00:06Z", "run.failed",    { status: "failed", error: { code: "STEP_FAIL", message: "step failed" } }),
      ]

      const tsStep = replayRunState(events).state.steps[0]!
      const rustStep = (await replayRunStateWithRust(events)).steps[0]!

      expect(rustStep.status).toBe(tsStep.status)
      expect(rustStep.startedAt).toBe(tsStep.startedAt)
      expect(rustStep.completedAt).toBe(tsStep.completedAt)
      expect(rustStep.error?.code).toBe(tsStep.error?.code)
    },
    60_000,
  )
})
