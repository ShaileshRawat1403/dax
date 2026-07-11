import { createEvidenceReceipt, type EvidenceReceipt } from "@/sdlc/evidence-receipt"
import { runCheck } from "@/sdlc/check-runner"
import type { CheckDefinition, CheckResult } from "@/sdlc/check-types"
import { isWhitelistedVerificationCommand, parseCommandExecutable } from "@/tool/shell-whitelist"

export type WorkerVerificationResult = {
  checks: CheckResult[]
  receipts: EvidenceReceipt[]
  passed: boolean
  failureSummary?: string
}

type RunCheck = (check: CheckDefinition) => Promise<CheckResult>

function rejectedCommandResult(command: string, cwd: string, reason: string): CheckResult {
  const now = new Date().toISOString()
  return {
    id: `worker-verification-rejected-${crypto.randomUUID()}`,
    kind: "test",
    label: "DAX worker verification command",
    command,
    cwd,
    required: true,
    risk: "medium",
    exitCode: null,
    status: "error",
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    stdoutPreview: "",
    stderrPreview: reason,
  }
}

function executionErrorResult(check: CheckDefinition, error: unknown): CheckResult {
  const now = new Date().toISOString()
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
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    stdoutPreview: "",
    stderrPreview: error instanceof Error ? error.message : String(error),
  }
}

/**
 * Turn operator-visible commands into DAX-owned checks. Commands are parsed
 * without a shell and rejected unless they pass DAX's verification allowlist.
 */
export function buildWorkerVerificationChecks(commands: string[], cwd: string): {
  checks: CheckDefinition[]
  rejected: CheckResult[]
} {
  if (commands.length === 0) {
    return {
      checks: [],
      rejected: [
        rejectedCommandResult(
          "",
          cwd,
          "No executable verification command was supplied or detected. Provide --verify with a DAX-approved command.",
        ),
      ],
    }
  }

  const checks: CheckDefinition[] = []
  const rejected: CheckResult[] = []

  for (const [index, command] of commands.entries()) {
    const parsed = parseCommandExecutable(command)
    if (!parsed || !isWhitelistedVerificationCommand(command)) {
      rejected.push(
        rejectedCommandResult(command, cwd, `Verification command is not on DAX's allowlist: ${command || "<empty>"}`),
      )
      continue
    }

    checks.push({
      id: `worker-verification-${index + 1}`,
      kind: "test",
      label: `DAX verification: ${command}`,
      command: parsed.executable,
      args: parsed.args,
      cwd,
      required: true,
      timeoutMs: 300_000,
      risk: "medium",
    })
  }

  return { checks, rejected }
}

export async function verifyWorkerPatch(input: {
  runId: string
  cwd: string
  commands: string[]
  run?: RunCheck
}): Promise<WorkerVerificationResult> {
  const plan = buildWorkerVerificationChecks(input.commands, input.cwd)
  const execute = input.run ?? runCheck
  const checks = [...plan.rejected]

  for (const check of plan.checks) {
    try {
      checks.push(await execute(check))
    } catch (error) {
      // A runner crash is still verification evidence, and it must block review.
      checks.push(executionErrorResult(check, error))
    }
  }

  const passed = checks.length > 0 && checks.every((check) => check.status === "passed")
  const failures = checks.filter((check) => check.status !== "passed")

  return {
    checks,
    receipts: checks.map((check) => createEvidenceReceipt(input.runId, check)),
    passed,
    failureSummary:
      failures.length > 0 ? failures.map((check) => `${check.command}: ${check.status}`).join(", ") : undefined,
  }
}
