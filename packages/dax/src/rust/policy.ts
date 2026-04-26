import path from "path"

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")

export type DaxPolicyCommand = "evaluate" | "version"

export type DaxPolicyProfile = "strict" | "standard" | "permissive"

export type DaxPolicyDecision = "allow" | "ask" | "deny"

export type DaxPolicyRisk = "low" | "medium" | "high" | "critical"

export type DaxPolicyBudget = {
  total_allowed: number
  mutating_allowed: number
  external_allowed: number
  total_used: number
  mutating_used: number
  external_used: number
}

export type DaxPolicyAction = {
  type: string
  command?: string
  path?: string
  tool?: string
  cwd?: string
}

export type DaxPolicyContext = {
  profile?: DaxPolicyProfile
  allowlist?: string[]
  blocklist?: string[]
  avoid_areas?: string[]
  /** Custom path substrings that elevate zone to Sensitive (high risk / ask). */
  sensitive_paths?: string[]
  budget?: Partial<DaxPolicyBudget>
}

export type DaxPolicyRequest = {
  session_id: string
  action: DaxPolicyAction
  context?: DaxPolicyContext
}

export type DaxPolicyResult = {
  decision: DaxPolicyDecision
  risk: DaxPolicyRisk
  reason: string
  gate?: string
}

export class DaxPolicyError extends Error {
  readonly command: DaxPolicyCommand
  readonly exitCode: number | null
  readonly stderr: string

  constructor(args: { command: DaxPolicyCommand; exitCode: number | null; stderr: string }) {
    super(`dax-policy ${args.command} failed: ${args.stderr.trim() || "unknown error"}`)
    this.name = "DaxPolicyError"
    this.command = args.command
    this.exitCode = args.exitCode
    this.stderr = args.stderr
  }
}

export type DaxPolicyOptions = {
  /**
   * Override the binary argv. Defaults to `cargo run -q -p dax-policy-bin --`.
   * Production builds can point this to a compiled dax-policy binary path.
   */
  binary?: string[]
  cwd?: string
}

function defaultCmd(command: DaxPolicyCommand): string[] {
  return ["cargo", "run", "-q", "-p", "dax-policy-bin", "--", command]
}

async function runDaxPolicyJson<T>(
  command: DaxPolicyCommand,
  input: unknown,
  options: DaxPolicyOptions = {},
): Promise<T> {
  const argv = options.binary ? [...options.binary, command] : defaultCmd(command)
  const cwd = options.cwd ?? REPO_ROOT

  const proc = Bun.spawn(argv, {
    cwd,
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new DaxPolicyError({ command, exitCode, stderr })
  }

  return JSON.parse(stdout) as T
}

export async function evaluatePolicyWithRust(
  request: DaxPolicyRequest,
  options?: DaxPolicyOptions,
): Promise<DaxPolicyResult> {
  return runDaxPolicyJson<DaxPolicyResult>("evaluate", request, options)
}
