import type { ExecutionContract } from "./execution-contract"
import type { RunState } from "@/state/run-state"
import type { SessionV2 } from "@/session/model"

export type CompletionProofSummary = SessionV2.CompletionProofState

function withinScope(contract: ExecutionContract, touchedFiles: string[]) {
  const targets = contract.runtimePolicy?.scope?.targetFiles ?? []
  if (targets.length === 0) return true
  return touchedFiles.every((candidate) =>
    targets.some(
      (target) => candidate === target || candidate.startsWith(`${target}/`) || target.startsWith(`${candidate}/`),
    ),
  )
}

function containsSensitivePath(paths: string[]) {
  return paths.some((value) => {
    const lower = value.toLowerCase()
    return (
      /^\.env($|\.)/.test(lower) ||
      lower.includes("secret") ||
      lower.includes("credential") ||
      lower.includes("token") ||
      lower.includes("auth") ||
      lower.startsWith(".github/workflows/")
    )
  })
}

function requiresArtifacts(contract: ExecutionContract) {
  return (contract.runtimePolicy?.scope?.targetFiles?.length ?? 0) > 0
}

/**
 * Pure evaluator for completion proof.
 * Same input (contract + runState) => same output.
 * NOTE: This function is intentionally pure. The timestamp is NOT included to maintain
 * referential transparency - same inputs always produce same outputs.
 */
export function evaluateCompletionProof(input: {
  contract: ExecutionContract
  runState: RunState
  artifactCountOverride?: number
}): Omit<CompletionProofSummary, "checkedAt"> {
  const { contract, runState } = input
  const verificationRequired =
    runState.governance.verification.required ||
    (contract.runtimePolicy?.postconditions?.validationCommands?.length ?? 0) > 0

  const verificationExecuted = runState.governance.verification.satisfied === true
  const receiptIds = [
    ...new Set([...runState.governance.mutationReceiptIds, ...runState.governance.verification.receiptIds]),
  ]

  const artifactCount = input.artifactCountOverride ?? runState.artifactIds.length
  const artifactChecks = !requiresArtifacts(contract) || artifactCount > 0

  const scopeChecks = withinScope(contract, runState.governance.touchedFiles)
  const sensitiveTouched = containsSensitivePath(runState.governance.touchedFiles)

  // Sensitive changes must be approved (no pending approvals on them)
  const sensitivePathApprovalChecks = !sensitiveTouched || runState.pendingApprovalIds.length === 0

  const failedChecks: string[] = []
  if (verificationRequired && !verificationExecuted) {
    failedChecks.push("missing_verification")
  }
  if (runState.governance.mutationReceiptIds.length > 0 && !verificationExecuted) {
    failedChecks.push("unverified_mutation")
  }
  if (!artifactChecks) {
    failedChecks.push("missing_artifacts")
  }
  if (!scopeChecks) {
    failedChecks.push("scope_violation")
  }
  if (!sensitivePathApprovalChecks) {
    failedChecks.push("unapproved_sensitive_change")
  }

  return {
    decision: failedChecks.length === 0 ? "pass" : "fail",
    failedChecks,
    verificationExecuted,
    receiptIds,
    artifactChecks,
    scopeChecks,
    sensitivePathApprovalChecks,
  }
}

/**
 * Creates a completion proof with timestamp.
 * Use this when you need the proof with metadata (e.g., for storing).
 * For pure evaluation, use evaluateCompletionProof directly.
 */
export function deriveCompletionProof(input: {
  contract: ExecutionContract
  runState: RunState
  artifactCountOverride?: number
}): CompletionProofSummary {
  const proof = evaluateCompletionProof(input)
  return {
    ...proof,
    checkedAt: new Date().toISOString(),
  }
}
