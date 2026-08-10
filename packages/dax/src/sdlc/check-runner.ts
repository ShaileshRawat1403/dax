import { spawn, type ChildProcess } from "node:child_process"
import { Shell } from "@/shell/shell"
import type { CheckDefinition, CheckResult } from "./check-types"

/** True while any process in the group still exists. Delivers no signal. */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Clear anything the check left behind after it exited.
 *
 * Skips the work entirely when the group is already empty, which is the
 * common case, so a clean check pays one syscall rather than a kill timeout.
 */
async function reapAfterExit(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (!pid || process.platform === "win32") return
  if (!groupAlive(pid)) return
  await Shell.killTree(child, { exited: () => !groupAlive(pid) })
}

function preview(value: string, max = 4_000): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n...[truncated]`
}

function baseResult(check: CheckDefinition, startedAt: string, started: number): Omit<CheckResult, "status" | "exitCode" | "stdoutPreview" | "stderrPreview"> {
  const ended = Date.now()
  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    command: [check.command, ...check.args].join(" "),
    cwd: check.cwd,
    required: check.required,
    risk: check.risk,
    startedAt,
    finishedAt: new Date(ended).toISOString(),
    durationMs: ended - started,
  }
}

export async function runCheck(check: CheckDefinition): Promise<CheckResult> {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  const executable = Bun.which(check.command)

  if (!executable) {
    return {
      ...baseResult(check, startedAt, started),
      exitCode: null,
      status: check.required ? "error" : "skipped",
      stdoutPreview: "",
      stderrPreview: `command not found: ${check.command}`,
    }
  }

  return await new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let finished = false

    const child = spawn(executable, check.args, {
      cwd: check.cwd,
      shell: false,
      env: process.env,
      // setsid(): the check leads its own process group so a timeout can reap
      // the whole tree (a check's own child can ignore SIGTERM and survive the
      // direct-child kill). On win32, Shell.killTree uses `taskkill /t`, which
      // needs only the pid.
      detached: process.platform !== "win32",
    })

    const finish = (result: Pick<CheckResult, "exitCode" | "status" | "stdoutPreview" | "stderrPreview">) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      resolve({
        ...baseResult(check, startedAt, started),
        ...result,
      })
    }

    // Kill the process group, not just the direct child, and report only after
    // the group is empty so a timed-out check cannot leave descendants behind.
    const timer = setTimeout(() => {
      void Shell.killTree(child).finally(() => {
        finish({
          exitCode: null,
          status: "timed_out",
          stdoutPreview: preview(stdout),
          stderrPreview: preview(stderr || "check timed out"),
        })
      })
    }, check.timeoutMs)

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", (err) => {
      finish({
        exitCode: null,
        status: "error",
        stdoutPreview: preview(stdout),
        stderrPreview: preview(err.message),
      })
    })

    child.on("close", (code) => {
      // Reap on the clean path too. A check can exit zero having started a
      // watcher, a dev server or a language kernel that outlives it, and
      // signalling only on timeout leaves those running. Same guarantee
      // runSupervisedProcess makes for governed workers.
      void reapAfterExit(child).finally(() => {
        finish({
          exitCode: code,
          status: code === 0 ? "passed" : "failed",
          stdoutPreview: preview(stdout),
          stderrPreview: preview(stderr),
        })
      })
    })
  })
}
