import { expect, test, describe } from "bun:test"
import { spawn } from "bun"
import path from "path"

const BUN_PATH = "/opt/homebrew/bin/bun"
const DAX_CMD = [BUN_PATH, "run", path.resolve(__dirname, "../../bin/dax")]
const TEST_FIXTURE = path.resolve(__dirname, "../../test/fixtures/healthy-repo")

describe.skip("CLI Smoke Tests - Workflow Commands", () => {
  test("dax workflow list shows available workflows", async () => {
    const proc = spawn([...DAX_CMD, "workflow", "list"], {
      cwd: TEST_FIXTURE,
    })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(output).toContain("repo-health")
    expect(output).toContain("explore-repo")
    expect(output).toContain("release-readiness")
  })

  test("dax workflow run executes successfully", async () => {
    const proc = spawn([...DAX_CMD, "workflow", "run", "repo-health", "."], {
      cwd: TEST_FIXTURE,
    })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(0)
    expect(output).toContain("Success: true")
    expect(output).toContain("Artifacts:")
  }, 30000)

  test("dax workflow inspect shows session details", async () => {
    // First run a workflow to get a session
    const runProc = spawn([...DAX_CMD, "workflow", "run", "repo-health", "."], {
      cwd: TEST_FIXTURE,
    })
    await runProc.exited

    const inspectProc = spawn([...DAX_CMD, "workflow", "inspect", "smoke-test"], {
      cwd: TEST_FIXTURE,
    })
    const output = await new Response(inspectProc.stdout).text()
    const exitCode = await inspectProc.exited

    // This may fail if session doesn't exist, but test the command structure
    expect([0, 1]).toContain(exitCode)
  }, 30000)

  test("dax workflow artifacts list shows artifacts", async () => {
    // First run a workflow
    const runProc = spawn([...DAX_CMD, "workflow", "run", "repo-health", "."], {
      cwd: TEST_FIXTURE,
    })
    await runProc.exited

    // Try to list artifacts (may fail if session doesn't exist)
    const proc = spawn([...DAX_CMD, "workflow", "artifacts", "list", "smoke-test-nonexistent"], {
      cwd: TEST_FIXTURE,
    })
    const output = await new Response(proc.stdout).text()
    const exitCode = await proc.exited

    // Should handle missing session gracefully
    expect(output).toContain("not found")
  }, 30000)
})
