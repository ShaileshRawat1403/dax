import { describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import os from "os"
import path from "path"
import { runCheck } from "./check-runner"
import { Shell } from "@/shell/shell"
import type { CheckDefinition } from "./check-types"

// Clean-exit reaping uses POSIX process groups; Windows timeout-tree cleanup
// remains covered above through Shell.killTree's taskkill branch.
const posixCleanExitReapingTest = test.skipIf(process.platform === "win32")

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
    // MSYS $! is not necessarily a Windows PID. Use native Bun descendants
    // on Windows so process.kill(pid, 0) checks the process we actually own.
    const windows = process.platform === "win32"
    const script = windows
      ? `const child = Bun.spawn([process.execPath, "-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" }); require("node:fs").writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ parent: process.pid, descendant: child.pid })); setInterval(() => {}, 1000)`
      : `trap "" TERM; sleep 300 & echo $! > "${marker}"; sleep 300`

    const check: CheckDefinition = {
      id: "tree-reap",
      kind: "test",
      label: "Timeout reaps descendants",
      command: windows ? process.execPath : "sh",
      args: [windows ? "-e" : "-c", script],
      cwd: dir,
      required: true,
      timeoutMs: 500,
      risk: "medium",
    }

    let descendantPid: number | undefined
    let parentPid: number | undefined
    try {
      const result = await runCheck(check)
      expect(result.status).toBe("timed_out")
      const recorded = readFileSync(marker, "utf8").trim()
      if (windows) {
        const native = JSON.parse(recorded) as { parent: number; descendant: number }
        parentPid = native.parent
        descendantPid = native.descendant
      } else descendantPid = Number.parseInt(recorded, 10)
      expect(Number.isInteger(descendantPid)).toBe(true)

      let gone = false
      const deadline = Date.now() + 5_000
      while (Date.now() < deadline) {
        try {
          process.kill(descendantPid!, 0)
        } catch {
          gone = true
          break
        }
        await Bun.sleep(50)
      }
      expect(gone).toBe(true)
    } finally {
      // Only fixture-owned PIDs; failed assertions must not leave sleepers.
      if (windows && descendantPid === undefined) {
        try {
          const native = JSON.parse(readFileSync(marker, "utf8")) as { parent: number; descendant: number }
          parentPid = native.parent
          descendantPid = native.descendant
        } catch { /* The producer may have failed before publishing its PIDs. */ }
      }
      for (const pid of [parentPid, descendantPid]) {
        if (!pid || !Number.isInteger(pid)) continue
        try { process.kill(pid, "SIGKILL") } catch { /* Already gone. */ }
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)

  test("timeout outcome waits for tree cleanup even when the child closes first", async () => {
    let cleanupComplete = false
    const cleanup = spyOn(Shell, "killTree").mockImplementation(async (child) => {
      child.kill("SIGKILL")
      await Bun.sleep(100)
      cleanupComplete = true
    })
    try {
      const result = await runCheck({
        id: "cleanup-owner", kind: "test", label: "Timeout owns outcome",
        command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"],
        cwd: process.cwd(), required: true, timeoutMs: 100, risk: "medium",
      })
      expect(cleanupComplete).toBe(true)
      expect(result.status).toBe("timed_out")
    } finally { cleanup.mockRestore() }
  })

  posixCleanExitReapingTest("kills a descendant the check leaves behind after exiting cleanly", async () => {
    // The leak the timeout path did not cover: a check exits zero having
    // started a watcher or kernel that outlives it. Reaping only on timeout
    // means a passing check quietly leaks.
    const dir = mkdtempSync(path.join(os.tmpdir(), "dax-check-clean-reap-"))
    const marker = path.join(dir, "descendant.pid")
    const script = `sleep 300 >/dev/null 2>&1 & echo $! > "${marker}"; exit 0`

    const check: CheckDefinition = {
      id: "clean-exit-reap",
      kind: "test",
      label: "Clean exit reaps descendants",
      command: "sh",
      args: ["-c", script],
      cwd: dir,
      required: true,
      timeoutMs: 30_000,
      risk: "medium",
    }

    const result = await runCheck(check)
    expect(result.status).toBe("passed")
    expect(result.exitCode).toBe(0)

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
