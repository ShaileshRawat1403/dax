import { describe, expect, test } from "bun:test"
import { runStatusForGraphStatus } from "./run-graph"
import { RunStatus } from "@/server/run-contract"
import type { TaskStatus } from "../planner/task-graph"

const ALL_TASK_STATUSES: TaskStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "blocked",
  "awaiting_approval",
]

describe("graph status projected onto run status", () => {
  test("every task status maps to something run.state_changed accepts", () => {
    // The two casts this replaces published "pending" and "blocked" into a
    // RunStatus field. Bus.publish does not validate, so those reached
    // subscribers and the server's RunStateChangedPayload schema unchecked.
    for (const status of ALL_TASK_STATUSES) {
      expect(() => RunStatus.parse(runStatusForGraphStatus(status))).not.toThrow()
    }
  })

  test("a graph that has not started reads as created, not as running", () => {
    expect(runStatusForGraphStatus("pending")).toBe("created")
  })

  test("both blocked forms surface as waiting_approval", () => {
    // run-graph marks the graph blocked when a task raises an approval request
    // or reaches a human checkpoint. At the run level that is one thing.
    expect(runStatusForGraphStatus("blocked")).toBe("waiting_approval")
    expect(runStatusForGraphStatus("awaiting_approval")).toBe("waiting_approval")
  })

  test("terminal and in-flight statuses keep their meaning", () => {
    expect(runStatusForGraphStatus("running")).toBe("running")
    expect(runStatusForGraphStatus("completed")).toBe("completed")
    expect(runStatusForGraphStatus("failed")).toBe("failed")
  })

  test("no task status is silently dropped", () => {
    // Guards the mapping against someone returning undefined for a case they
    // are unsure about, which the exhaustive switch alone would not catch.
    for (const status of ALL_TASK_STATUSES) {
      expect(typeof runStatusForGraphStatus(status)).toBe("string")
    }
  })
})
