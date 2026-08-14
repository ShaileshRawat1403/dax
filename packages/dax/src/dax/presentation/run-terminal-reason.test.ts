import { describe, expect, test } from "bun:test"
import { humanTerminalReason } from "./run-terminal-reason"

describe("humanTerminalReason", () => {
  test("maps known terminal reasons to a short human label", () => {
    expect(humanTerminalReason("permission_denied")).toBe("Permission denied")
    expect(humanTerminalReason("timeout")).toBe("Timed out")
    expect(humanTerminalReason("execution_error")).toBe("Execution error")
    expect(humanTerminalReason("workflow_rejected")).toBe("Rejected in review")
  })

  test("returns undefined for a missing or unrecognized reason", () => {
    expect(humanTerminalReason()).toBeUndefined()
    expect(humanTerminalReason("")).toBeUndefined()
    expect(humanTerminalReason("something_new")).toBeUndefined()
  })
})
