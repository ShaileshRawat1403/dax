import { describe, expect, test } from "bun:test"
import { GitOperator } from "./git"

describe("GitOperator", () => {
  test("fails honestly until workflow execution is implemented", async () => {
    const result = await new GitOperator().execute(
      {
        id: "git-review-task",
        name: "Git review",
        description: "Review git state",
        operator_type: "git",
        status: "pending",
        dependencies: [],
        context: {},
      },
      {
        cwd: "/repo",
        sessionId: "session-1",
      },
    )

    expect(result.success).toBe(false)
    expect(result.output.status).toBe("not_implemented")
    expect(result.error?.message).toContain("not implemented")
  })
})
