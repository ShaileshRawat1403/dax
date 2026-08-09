import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import os from "os"
import path from "path"
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

  test("kills the whole process tree on timeout, including a descendant that ignores SIGTERM", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "dax-check-reap-"))
    const marker = path.join(dir, "descendant.pid")
    const script = `trap "" TERM; sleep 300 & echo $! > "${marker}"; sleep 300`

    const check: CheckDefinition = {
      id: "tree-reap",
      kind: "test",
      label: "Timeout reaps descendants",
      command: "sh",
      args: ["-c", script],
      cwd: dir,
      required: true,
      timeoutMs: 500,
      risk: "medium",
    }

    const result = await runCheck(check)
    expect(result.status).toBe("timed_out")

    const descendantPid = Number.parseInt(readFileSync(marker, "utf8").trim(), 10)
    expect(Number.isInteger(descendantPid)).toBe(true)

    let gone = false
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      try {
        process.kill(descendantPid, 0)
      } catch {
        gone = true
        break
      }
      await Bun.sleep(50)
    }
    expect(gone).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })
})
