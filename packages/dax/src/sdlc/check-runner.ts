import { spawn } from "node:child_process"
import type { CheckDefinition, CheckResult } from "./check-types"

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

    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      finish({
        exitCode: null,
        status: "timed_out",
        stdoutPreview: preview(stdout),
        stderrPreview: preview(stderr || "check timed out"),
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
      finish({
        exitCode: code,
        status: code === 0 ? "passed" : "failed",
        stdoutPreview: preview(stdout),
        stderrPreview: preview(stderr),
      })
    })
  })
}
