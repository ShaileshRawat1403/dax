import type { ExecutionContract } from "./execution-contract"
import type { RunState } from "@/state/run-state"

export type CompletionProofSummary = {
  ready: boolean
  missing: string[]
  verificationReceipts: number
  mutationReceipts: number
  artifactCount: number
  scopeSatisfied: boolean
  sensitiveChangesApproved: boolean
  checkedAt: string
}

function withinScope(contract: ExecutionContract, touchedFiles: string[]) {
  const targets = contract.runtimePolicy?.scope.targetFiles ?? []
  if (targets.length === 0) return true
  return touchedFiles.every((candidate) =>
    targets.some((target) => candidate === target || candidate.startsWith(`${target}/`) || target.startsWith(`${candidate}/`)),
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
  return contract.expectedOutputs.some((output) => output.type === "file" || output.type === "diff" || output.type === "report" || output.type === "patch")
}

export function deriveCompletionProof(input: {
  contract: ExecutionContract
  runState: RunState
  artifactCountOverride?: number
}): CompletionProofSummary {
  const { contract, runState } = input
  const verificationRequired =
    runState.governance.verification.required || contract.runtimePolicy?.postconditions.verificationRequired === true
  const verificationReceipts = runState.governance.verification.receiptIds.length
  const mutationReceipts = runState.governance.mutationReceiptIds.length
  const artifactCount = input.artifactCountOverride ?? runState.artifactIds.length
  const scopeSatisfied = withinScope(contract, runState.governance.touchedFiles)
  const sensitiveTouched = containsSensitivePath(runState.governance.touchedFiles)
  const sensitiveChangesApproved = !sensitiveTouched || runState.pendingApprovalIds.length === 0

  const missing: string[] = []
  if (verificationRequired && verificationReceipts === 0) {
    missing.push("verification receipts")
  }
  if (mutationReceipts > 0 && verificationReceipts === 0) {
    missing.push("verification linked to mutation receipts")
  }
  if (requiresArtifacts(contract) && artifactCount === 0) {
    missing.push("expected artifact evidence")
  }
  if (!scopeSatisfied) {
    missing.push("scope proof")
  }
  if (!sensitiveChangesApproved) {
    missing.push("sensitive path approval")
  }

  return {
    ready: missing.length === 0,
    missing,
    verificationReceipts,
    mutationReceipts,
    artifactCount,
    scopeSatisfied,
    sensitiveChangesApproved,
    checkedAt: new Date().toISOString(),
  }
}

