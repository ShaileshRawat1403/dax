import { describe, expect, test } from "bun:test"
import { runCheck } from "./check-runner"
import type { CheckDefinition } from "./check-types"

describe("SDLC check runner", () => {
  test("skips missing optional tools", async () => {
    const check: CheckDefinition = {
      id: "missing-optional",
      kind: "security",
      label: "Missing optional scanner",
      command: "dax-command-that-should-not-exist",
      args: [],
      cwd: process.cwd(),
      required: false,
      timeoutMs: 1_000,
      risk: "medium",
    }

    const result = await runCheck(check)

    expect(result.status).toBe("skipped")
    expect(result.exitCode).toBeNull()
    expect(result.stderrPreview).toContain("command not found")
  })

  test("marks missing required tools as errors", async () => {
    const check: CheckDefinition = {
      id: "missing-required",
      kind: "test",
      label: "Missing required command",
      command: "dax-command-that-should-not-exist",
      args: [],
      cwd: process.cwd(),
      required: true,
      timeoutMs: 1_000,
      risk: "high",
    }

    const result = await runCheck(check)

    expect(result.status).toBe("error")
    expect(result.exitCode).toBeNull()
  })
})
