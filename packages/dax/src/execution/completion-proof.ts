import type { ExecutionContract } from "./execution-contract"
import type { RunState } from "@/state/run-state"
import type { SessionV2 } from "@/session/model"

export type CompletionProofSummary = SessionV2.CompletionProofState
type ArtifactObservation = Pick<SessionV2.ArtifactRecord, "kind">

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

function normalizeOutputType(value: string | undefined): "file" | "patch" | "report" | "summary" | "message" | null {
  const lower = value?.trim().toLowerCase()
  if (!lower) return null
  if (lower === "diff") return "patch"
  if (lower === "file" || lower === "patch" || lower === "report" || lower === "summary" || lower === "message") {
    return lower
  }
  return null
}

function deriveObservedOutputTypes(input: {
  contract: ExecutionContract
  runState: RunState
  observedArtifacts?: ArtifactObservation[]
}): Set<"file" | "patch" | "report" | "summary" | "message"> {
  const observed = new Set<"file" | "patch" | "report" | "summary" | "message">()

  for (const artifact of input.observedArtifacts ?? []) {
    const normalized = normalizeOutputType(artifact.kind)
    if (normalized) observed.add(normalized)
  }

  if (observed.size > 0) return observed

  const hasArtifacts = input.runState.artifactIds.length > 0
  const hasTouchedFiles = input.runState.governance.touchedFiles.length > 0
  const completedOutputs = input.runState.steps
    .filter((step) => step.status === "completed")
    .flatMap((step) => step.outputs)
    .map((output) => output.toLowerCase())

  if (hasArtifacts && hasTouchedFiles) {
    observed.add("file")
    if (input.contract.expectedOutputs.some((output) => output.type === "patch" || output.type === "diff")) {
      observed.add("patch")
    }
  }
  if (hasArtifacts && completedOutputs.some((output) => output.includes("summary") || output.includes("context:"))) {
    observed.add("summary")
  }
  if (hasArtifacts && completedOutputs.some((output) => output.includes("report") || output.includes("finding"))) {
    observed.add("report")
  }
  if (hasArtifacts && completedOutputs.some((output) => output.includes("message") || output.includes("outcome:"))) {
    observed.add("message")
  }

  return observed
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
  observedArtifacts?: ArtifactObservation[]
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
  const observedOutputTypes = deriveObservedOutputTypes({ contract, runState, observedArtifacts: input.observedArtifacts })
  const expectedOutputTypes = Array.from(
    new Set(contract.expectedOutputs.map((output) => normalizeOutputType(output.type)).filter(Boolean)),
  ) as Array<"file" | "patch" | "report" | "summary" | "message">
  const expectedOutputTypesSatisfied = expectedOutputTypes.filter((outputType) => observedOutputTypes.has(outputType))
  const expectedOutputTypesMissing = expectedOutputTypes.filter((outputType) => !observedOutputTypes.has(outputType))
  const expectedOutputChecks = expectedOutputTypesMissing.length === 0

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
  if (!expectedOutputChecks) {
    failedChecks.push("missing_expected_outputs")
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
    expectedOutputChecks,
    expectedOutputTypesSatisfied,
    expectedOutputTypesMissing,
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
  observedArtifacts?: ArtifactObservation[]
}): CompletionProofSummary {
  const proof = evaluateCompletionProof(input)
  return {
    ...proof,
    checkedAt: new Date().toISOString(),
  }
}
