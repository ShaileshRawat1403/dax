import { describe, expect, test } from "bun:test"
import { shouldApplyCanonicalRefresh } from "./canonical-inspector-source-state"

describe("canonical inspector source refresh ordering", () => {
  test("does not apply an older refresh over a newer request", () => {
    expect(shouldApplyCanonicalRefresh({ requestEpoch: 1, currentEpoch: 2, requestedRunId: "run_1", currentRunId: "run_1" })).toBe(false)
    expect(shouldApplyCanonicalRefresh({ requestEpoch: 2, currentEpoch: 2, requestedRunId: "run_1", currentRunId: "run_1" })).toBe(true)
  })

  test("does not leak the previous run snapshot after route navigation", () => {
    expect(shouldApplyCanonicalRefresh({ requestEpoch: 3, currentEpoch: 3, requestedRunId: "run_1", currentRunId: "run_2" })).toBe(false)
  })
})
