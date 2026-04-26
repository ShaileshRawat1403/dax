import path from "path"

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")

export type DaxCoreCommand = "replay" | "proof" | "version"

export type DaxCoreRunStatus =
  | "created"
  | "compiled"
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"

export type DaxCoreStepStatus = "proposed" | "running" | "completed" | "failed" | "blocked"

export type DaxCoreRunState = {
  runId: string
  contractId: string
  status: DaxCoreRunStatus
  currentStepId: string | null
  steps: Array<{
    stepId: string
    title: string
    type: string
    status: DaxCoreStepStatus
    startedAt: string | null
    completedAt: string | null
    error: null | { code: string; message: string; retryable: boolean }
    outputs: string[]
  }>
  pendingApprovalIds: string[]
  artifactIds: string[]
  trust: null | {
    posture: string
    score: number | null
    blocked: boolean
    reasons: string[]
  }
  error: null | { code: string; message: string; retryable: boolean }
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export type DaxCoreProofReport = {
  schemaVersion: "dax.core.proof.v1"
  result: "pass" | "fail"
  eventCount: number
  finalStatus?: DaxCoreRunStatus
  stateHash?: string
  eventSequenceHash: string
  error?: string
}

export class DaxCoreError extends Error {
  readonly command: DaxCoreCommand
  readonly exitCode: number | null
  readonly stderr: string

  constructor(args: { command: DaxCoreCommand; exitCode: number | null; stderr: string }) {
    super(`dax-core ${args.command} failed: ${args.stderr.trim() || "unknown error"}`)
    this.name = "DaxCoreError"
    this.command = args.command
    this.exitCode = args.exitCode
    this.stderr = args.stderr
  }
}

export type DaxCoreOptions = {
  /**
   * Override the binary argv. Defaults to `cargo run -q -p dax-core-bin --`.
   * Production builds can point this to a compiled dax-core binary path.
   */
  binary?: string[]
  cwd?: string
}

function defaultCmd(command: DaxCoreCommand): string[] {
  return ["cargo", "run", "-q", "-p", "dax-core-bin", "--", command]
}

async function runDaxCoreJson<T>(command: DaxCoreCommand, input: unknown, options: DaxCoreOptions = {}): Promise<T> {
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
    throw new DaxCoreError({ command, exitCode, stderr })
  }

  return JSON.parse(stdout) as T
}

export async function replayRunStateWithRust(events: unknown[], options?: DaxCoreOptions): Promise<DaxCoreRunState> {
  return runDaxCoreJson<DaxCoreRunState>("replay", events, options)
}

export async function createRustProofReport(
  events: unknown[],
  options?: DaxCoreOptions,
): Promise<DaxCoreProofReport> {
  return runDaxCoreJson<DaxCoreProofReport>("proof", events, options)
}
