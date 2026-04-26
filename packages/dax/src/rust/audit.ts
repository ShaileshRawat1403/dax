import path from "path"

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")

export type DaxAuditCommand = "evaluate" | "version"

export type DaxAuditSeverity = "info" | "low" | "medium" | "high" | "critical"

export type DaxAuditFinding = {
  id: string
  severity: DaxAuditSeverity
  category: string
  title: string
  blocking: boolean
}

export type DaxAuditInput = {
  session_id: string
  events: unknown[]
  findings?: DaxAuditFinding[]
  policy_decision_count?: number
  override_count?: number
  audit_present?: boolean
}

export type DaxCheckId =
  | "approval_compliance"
  | "policy_compliance"
  | "artifact_presence"
  | "evidence_completeness"
  | "trace_continuity"
  | "overrides_justified"

export type DaxCheckStatus = "pass" | "fail" | "warn" | "incomplete"

export type DaxAuditCheck = {
  id: DaxCheckId
  label: string
  status: DaxCheckStatus
  summary: string
}

export type DaxTrustPosture = "verified" | "policy_clean" | "review_needed"

export type DaxVerificationResult = "passed" | "failed" | "incomplete" | "degraded"

export type DaxTrustReport = {
  schema_version: "dax.audit.v1"
  session_id: string
  posture: DaxTrustPosture
  verification_result: DaxVerificationResult
  checks: DaxAuditCheck[]
  blocking_factors: string[]
  missing_evidence: string[]
  degrading_factors: string[]
  passing_signals: string[]
}

export class DaxAuditError extends Error {
  readonly command: DaxAuditCommand
  readonly exitCode: number | null
  readonly stderr: string

  constructor(args: { command: DaxAuditCommand; exitCode: number | null; stderr: string }) {
    super(`dax-audit ${args.command} failed: ${args.stderr.trim() || "unknown error"}`)
    this.name = "DaxAuditError"
    this.command = args.command
    this.exitCode = args.exitCode
    this.stderr = args.stderr
  }
}

export type DaxAuditOptions = {
  /**
   * Override the binary argv. Defaults to `cargo run -q -p dax-audit-bin --`.
   * Production builds can point this to a compiled dax-audit binary path.
   */
  binary?: string[]
  cwd?: string
}

function defaultCmd(command: DaxAuditCommand): string[] {
  return ["cargo", "run", "-q", "-p", "dax-audit-bin", "--", command]
}

async function runDaxAuditJson<T>(
  command: DaxAuditCommand,
  input: unknown,
  options: DaxAuditOptions = {},
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
    throw new DaxAuditError({ command, exitCode, stderr })
  }

  return JSON.parse(stdout) as T
}

export async function evaluateAuditWithRust(
  input: DaxAuditInput,
  options?: DaxAuditOptions,
): Promise<DaxTrustReport> {
  return runDaxAuditJson<DaxTrustReport>("evaluate", input, options)
}
