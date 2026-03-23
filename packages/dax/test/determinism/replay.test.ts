import { describe, test, expect } from "bun:test"
import { replayRunState } from "../../src/state/replay"
import { RunEvent } from "../../src/server/run-contract"

describe("State Reconstruction from Events", () => {
  test("reconstructs basic run creation and completion", () => {
    const events: RunEvent[] = [
      {
        schemaVersion: "v1",
        eventId: "evt_1",
        sequence: 1,
        cursor: "evt_1",
        runId: "run_test_1",
        type: "run.created",
        timestamp: "2024-01-01T00:00:00Z",
        payload: { status: "created" },
      },
      {
        schemaVersion: "v1",
        eventId: "evt_2",
        sequence: 2,
        cursor: "evt_2",
        runId: "run_test_1",
        type: "run.started",
        timestamp: "2024-01-01T00:00:01Z",
        payload: { status: "running" },
      },
      {
        schemaVersion: "v1",
        eventId: "evt_3",
        sequence: 3,
        cursor: "evt_3",
        runId: "run_test_1",
        type: "run.completed",
        timestamp: "2024-01-01T00:00:02Z",
        payload: { status: "completed", summaryAvailable: true },
      },
    ]

    const { state } = replayRunState(events)
    expect(state.runId).toBe("run_test_1")
    expect(state.status).toBe("completed")
    expect(state.startedAt).toBe("2024-01-01T00:00:01Z")
    expect(state.completedAt).toBe("2024-01-01T00:00:02Z")
  })

  test("reconstructs step lifecycle", () => {
    const events: RunEvent[] = [
      {
        schemaVersion: "v1",
        eventId: "evt_1",
        sequence: 1,
        cursor: "evt_1",
        runId: "run_test_2",
        type: "run.created",
        timestamp: "2024-01-01T00:00:00Z",
        payload: { status: "created" },
      },
      {
        schemaVersion: "v1",
        eventId: "evt_2",
        sequence: 2,
        cursor: "evt_2",
        runId: "run_test_2",
        type: "step.proposed",
        timestamp: "2024-01-01T00:00:01Z",
        payload: { stepId: "step_1", title: "Test Step" },
      },
      {
        schemaVersion: "v1",
        eventId: "evt_3",
        sequence: 3,
        cursor: "evt_3",
        runId: "run_test_2",
        type: "step.started",
        timestamp: "2024-01-01T00:00:02Z",
        payload: { stepId: "step_1", title: "Test Step" },
      },
      {
        schemaVersion: "v1",
        eventId: "evt_4",
        sequence: 4,
        cursor: "evt_4",
        runId: "run_test_2",
        type: "step.completed",
        timestamp: "2024-01-01T00:00:03Z",
        payload: { stepId: "step_1", title: "Test Step" },
      },
    ]

    const { state } = replayRunState(events)
    expect(state.steps).toHaveLength(1)
    expect(state.steps[0].stepId).toBe("step_1")
    expect(state.steps[0].status).toBe("completed")
    expect(state.currentStepId).toBeNull()
  })

  test("rejects invalid sequences", () => {
    const events: RunEvent[] = [
      {
        schemaVersion: "v1",
        eventId: "evt_1",
        sequence: 2, // Out of order!
        cursor: "evt_1",
        runId: "run_test_3",
        type: "run.created",
        timestamp: "2024-01-01T00:00:00Z",
        payload: { status: "created" },
      },
      {
        schemaVersion: "v1",
        eventId: "evt_2",
        sequence: 1, // Out of order!
        cursor: "evt_2",
        runId: "run_test_3",
        type: "run.started",
        timestamp: "2024-01-01T00:00:01Z",
        payload: { status: "running" },
      },
    ]

    expect(() => replayRunState(events)).not.toThrow() // The code sorts by sequence so it shouldn't throw just because array order is mixed, but let's see if duplicate sequences throw

    const duplicateEvents: RunEvent[] = [
      {
        schemaVersion: "v1",
        eventId: "evt_1",
        sequence: 1,
        cursor: "evt_1",
        runId: "run_test_3",
        type: "run.created",
        timestamp: "2024-01-01T00:00:00Z",
        payload: { status: "created" },
      },
      {
        schemaVersion: "v1",
        eventId: "evt_2",
        sequence: 1, // Duplicate
        cursor: "evt_2",
        runId: "run_test_3",
        type: "run.started",
        timestamp: "2024-01-01T00:00:01Z",
        payload: { status: "running" },
      },
    ]

    expect(() => replayRunState(duplicateEvents)).toThrow(/Invalid event sequence/)
  })
})
