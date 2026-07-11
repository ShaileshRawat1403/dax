import type { CheckDefinition, CheckResult } from "@/sdlc/check-types"

export type WorkerSandboxProvider = "seatbelt" | "bwrap"
export type WorkerSandboxNetwork = "full" | "none"

export type WorkerSandboxPlan = {
  provider: WorkerSandboxProvider
  command: string[]
  network: WorkerSandboxNetwork
  summary: string
}

export type WorkerSandboxCheck =
  | { available: true; provider: WorkerSandboxProvider; summary: string }
  | { available: false; reason: string }

type Platform = "darwin" | "linux" | "win32" | string
type Which = (binary: string) => string | null
type Probe = (plan: WorkerSandboxPlan) => { exitCode: number; stderr?: string }

function escapeSeatbelt(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
}

function macProfile(cwd: string, network: WorkerSandboxNetwork): string {
  const writable = [cwd, process.env.TMPDIR, "/tmp", "/private/tmp"]
    .filter((value): value is string => Boolean(value))
    .map((value) => `(allow file-write* (subpath "${escapeSeatbelt(value)}"))`)
    .join("\n")

  return [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    "(allow file-read*)",
    writable,
    network === "full" ? "(allow network*)" : "(deny network*)",
  ].join("\n")
}

export function buildWorkerSandboxPlan(input: {
  command: string[]
  cwd: string
  network: WorkerSandboxNetwork
  platform?: Platform
  which?: Which
}): WorkerSandboxPlan {
  const platform = input.platform ?? process.platform
  const which = input.which ?? Bun.which

  if (platform === "darwin") {
    const binary = which("sandbox-exec")
    if (!binary) {
      throw new Error("DAX governed workers require macOS sandbox-exec, but it is unavailable.")
    }
    return {
      provider: "seatbelt",
      command: [binary, "-p", macProfile(input.cwd, input.network), ...input.command],
      network: input.network,
      summary: `seatbelt; checkout-only writes; ${input.network === "full" ? "provider network" : "network denied"}`,
    }
  }

  if (platform === "linux") {
    const binary = which("bwrap")
    if (!binary) {
      throw new Error("DAX governed workers require bubblewrap (`bwrap`) on Linux.")
    }
    const networkArgs = input.network === "full" ? ["--share-net"] : []
    return {
      provider: "bwrap",
      command: [
        binary,
        "--unshare-all",
        ...networkArgs,
        "--new-session",
        "--die-with-parent",
        "--ro-bind",
        "/",
        "/",
        "--bind",
        input.cwd,
        input.cwd,
        "--tmpfs",
        "/tmp",
        "--chdir",
        input.cwd,
        "--",
        ...input.command,
      ],
      network: input.network,
      summary: `bubblewrap; checkout-only writes; ${input.network === "full" ? "provider network" : "network denied"}`,
    }
  }

  throw new Error(`DAX governed worker isolation is not available on ${platform}.`)
}

function probeSandbox(plan: WorkerSandboxPlan): { exitCode: number; stderr?: string } {
  const result = Bun.spawnSync(plan.command, { stdout: "ignore", stderr: "pipe" })
  return { exitCode: result.exitCode, stderr: result.stderr.toString() }
}

export function checkWorkerSandbox(
  input: { platform?: Platform; which?: Which; probe?: Probe } = {},
): WorkerSandboxCheck {
  try {
    const plan = buildWorkerSandboxPlan({
      command: process.platform === "win32" ? ["cmd", "/c", "exit", "0"] : ["/usr/bin/true"],
      cwd: process.cwd(),
      network: "none",
      platform: input.platform,
      which: input.which,
    })
    const result = (input.probe ?? probeSandbox)(plan)
    if (result.exitCode !== 0) {
      const diagnostic = result.stderr?.trim()
      throw new Error(
        `DAX found ${plan.provider}, but its isolation probe failed${diagnostic ? `: ${diagnostic}` : "."}`,
      )
    }
    return { available: true, provider: plan.provider, summary: plan.summary }
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export async function runSandboxedCommand(input: {
  command: string[]
  cwd: string
  env: Record<string, string | undefined>
  timeoutMs: number
  network: WorkerSandboxNetwork
}): Promise<{
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  sandboxProvider: WorkerSandboxProvider
}> {
  const plan = buildWorkerSandboxPlan(input)
  const proc = Bun.spawn(plan.command, {
    cwd: input.cwd,
    env: input.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = readBoundedOutput(proc.stdout, 20_000)
  const stderr = readBoundedOutput(proc.stderr, 20_000)
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, input.timeoutMs)
  const exitCode = await proc.exited
  clearTimeout(timeout)
  return {
    exitCode,
    stdout: await stdout,
    stderr: await stderr,
    timedOut,
    sandboxProvider: plan.provider,
  }
}

export async function readBoundedOutput(stream: ReadableStream<Uint8Array>, max: number): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    const remaining = max - output.length
    if (remaining > 0) output += chunk.slice(0, remaining)
    if (chunk.length > remaining) truncated = true
  }
  const tail = decoder.decode()
  const remaining = max - output.length
  if (remaining > 0) output += tail.slice(0, remaining)
  if (tail.length > remaining) truncated = true
  return truncated ? `${output}\n...[truncated]` : output
}

function verificationEnv(): Record<string, string | undefined> {
  const allowed = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TERM", "NO_COLOR"]
  return Object.fromEntries(allowed.map((name) => [name, process.env[name]]).filter(([, value]) => Boolean(value)))
}

export function sandboxedCheckStatus(result: { exitCode: number; timedOut: boolean }): CheckResult["status"] {
  if (result.timedOut) return "timed_out"
  return result.exitCode === 0 ? "passed" : "failed"
}

export async function runSandboxedWorkerCheck(check: CheckDefinition): Promise<CheckResult> {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  try {
    const result = await runSandboxedCommand({
      command: [check.command, ...check.args],
      cwd: check.cwd,
      env: { ...verificationEnv(), CI: "1" },
      timeoutMs: check.timeoutMs,
      network: "none",
    })
    return {
      id: check.id,
      kind: check.kind,
      label: `${check.label} (${result.sandboxProvider})`,
      command: [check.command, ...check.args].join(" "),
      cwd: check.cwd,
      required: check.required,
      risk: check.risk,
      exitCode: result.exitCode,
      status: sandboxedCheckStatus(result),
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      stdoutPreview: result.stdout,
      stderrPreview: result.stderr,
    }
  } catch (error) {
    return {
      id: check.id,
      kind: check.kind,
      label: check.label,
      command: [check.command, ...check.args].join(" "),
      cwd: check.cwd,
      required: check.required,
      risk: check.risk,
      exitCode: null,
      status: "error",
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      stdoutPreview: "",
      stderrPreview: error instanceof Error ? error.message : String(error),
    }
  }
}
