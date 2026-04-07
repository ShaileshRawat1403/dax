import { describe, expect, it, afterAll, beforeAll } from "bun:test"
import { GitOperator } from "./git"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"

describe("GitOperator", () => {
  const testCwd = path.join(process.cwd(), "temp_git_test")

  beforeAll(async () => {
    await fs.mkdir(testCwd, { recursive: true })
    await $`git init`.cwd(testCwd)
    await $`git config user.email "test@example.com"`.cwd(testCwd)
    await $`git config user.name "Test User"`.cwd(testCwd)
  })

  afterAll(async () => {
    await fs.rm(testCwd, { recursive: true, force: true })
  })

  it("handles git status", async () => {
    const operator = new GitOperator()
    const result = await operator.execute(
      {
        id: "t1",
        name: "status",
        description: "check status",
        operator_type: "git",
        status: "pending",
        dependencies: [],
        context: { action: "status" },
      },
      { sessionId: "s1", cwd: testCwd }
    )
    expect(result.success).toBe(true)
    expect(result.output.result).toContain("On branch")
  })

  it("handles git add and commit", async () => {
    await $`touch test.txt`.cwd(testCwd)
    const operator = new GitOperator()
    
    // Add
    const addResult = await operator.execute(
      {
        id: "t2",
        name: "add",
        description: "stage files",
        operator_type: "git",
        status: "pending",
        dependencies: [],
        context: { action: "add", args: ["test.txt"] },
      },
      { sessionId: "s1", cwd: testCwd }
    )
    expect(addResult.success).toBe(true)

    // Commit
    const commitResult = await operator.execute(
      {
        id: "t3",
        name: "commit",
        description: "initial commit",
        operator_type: "git",
        status: "pending",
        dependencies: [],
        context: { action: "commit", message: "feat: initial commit" },
      },
      { sessionId: "s1", cwd: testCwd }
    )
    expect(commitResult.success).toBe(true)
    expect(commitResult.output.result).toContain("initial commit")
  })
})
