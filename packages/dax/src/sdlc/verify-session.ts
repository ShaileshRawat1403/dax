import { randomUUID } from "node:crypto"
import { statSync } from "node:fs"
import { detectChecks } from "./check-catalog"
import { runCheck } from "./check-runner"
import { createEvidenceReceipt } from "./evidence-receipt"
import type { CheckResult, VerificationPosture, VerificationReport } from "./check-types"

export function deriveVerificationPosture(results: CheckResult[]): VerificationPosture {
  if (results.length === 0) return "guarded"
  const required = results.filter((result) => result.required)
  if (required.some((result) => result.status === "error")) return "failed"
  if (required.some((result) => ["failed", "timed_out"].includes(result.status))) return "blocked"
  if (results.some((result) => ["failed", "timed_out", "error"].includes(result.status))) return "guarded"
  return "verified"
}

function blockingReasons(results: CheckResult[]): string[] {
  return results
    .filter((result) => result.required && result.status !== "passed")
    .map((result) => `${result.label} ${result.status}`)
}

export async function verifySdlc(input: {
  repoRoot: string
  runId?: string
  native?: boolean
  security?: boolean
}): Promise<{ report: VerificationReport; receipts: ReturnType<typeof createEvidenceReceipt>[] }> {
  const stat = statSync(input.repoRoot, { throwIfNoEntry: false })
  if (!stat?.isDirectory()) {
    throw new Error(`Repository root does not exist or is not a directory: ${input.repoRoot}`)
  }

  const runId = input.runId ?? randomUUID()
  const checks = detectChecks(input.repoRoot, { native: input.native, security: input.security })
  const results: CheckResult[] = []

  for (const check of checks) {
    results.push(await runCheck(check))
  }

  const report: VerificationReport = {
    schemaVersion: "dax.sdlc.verification.v1",
    source: "dax",
    runId,
    repoRoot: input.repoRoot,
    checks: results,
    posture: deriveVerificationPosture(results),
    blockingReasons: blockingReasons(results),
    generatedAt: new Date().toISOString(),
  }

  return {
    report,
    receipts: results.map((result) => createEvidenceReceipt(runId, result)),
  }
}

export function formatSdlcVerification(report: VerificationReport): string {
  const lines = [
    `SDLC verification posture: ${report.posture}`,
    `Repository: ${report.repoRoot}`,
    `Run: ${report.runId}`,
    "",
    "Checks:",
  ]

  if (report.checks.length === 0) {
    lines.push("- No checks detected for this repository.")
  }

  for (const check of report.checks) {
    const required = check.required ? "required" : "optional"
    lines.push(`- ${check.label}: ${check.status} (${required}, ${check.command})`)
  }

  if (report.blockingReasons.length > 0) {
    lines.push("", "Blocking reasons:")
    for (const reason of report.blockingReasons) lines.push(`- ${reason}`)
  }

  return lines.join("\n")
}
