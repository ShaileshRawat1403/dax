import path from "path"

export type WriteGovernanceStatus = "none" | "governed" | "blocked" | "ungated"
export type WriteRiskBucket =
  | "harmless_local"
  | "project_artifact"
  | "governed_project_write"
  | "sensitive_or_system_write"
export type WriteGovernanceExpectation = "optional" | "expected" | "required"

export type WriteGovernanceSignals = {
  workspace_write_artifact_count: number
  pending_approval_count: number
  override_count: number
  policy_evaluated: boolean
}

export type WriteGovernanceClassification = {
  bucket: WriteRiskBucket
  governance_expectation: WriteGovernanceExpectation
  references: string[]
}

export function deriveWriteGovernanceStatus(input: WriteGovernanceSignals): WriteGovernanceStatus {
  if (input.workspace_write_artifact_count <= 0) return "none"
  if (input.pending_approval_count > 0) return "blocked"
  if (input.policy_evaluated || input.override_count > 0) return "governed"
  return "ungated"
}

export function classifyWritePathRisk(input: {
  sessionDirectory: string
  reference: string
}): {
  path: string
  bucket: WriteRiskBucket
  governance_expectation: WriteGovernanceExpectation
} {
  const normalized = normalizeWriteReference(input.reference)
  const bucket = deriveWriteRiskBucket(normalized)
  return {
    path: normalized,
    bucket,
    governance_expectation: governanceExpectationForBucket(bucket),
  }
}

function normalizeWriteReference(reference: string) {
  const normalized = path.posix.normalize(reference.replaceAll("\\", "/"))
  return normalized.startsWith("./") ? normalized.slice(2) : normalized
}

function deriveWriteRiskBucket(reference: string): WriteRiskBucket {
  if (!reference || reference === "." || reference.startsWith("../") || path.isAbsolute(reference)) {
    return "sensitive_or_system_write"
  }

  const lower = reference.toLowerCase()
  const basename = path.posix.basename(lower)

  if (
    lower.startsWith(".git/") ||
    lower.startsWith(".dax/") ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "package.json" ||
    basename === "bun.lock" ||
    basename === "bun.lockb" ||
    basename === "package-lock.json" ||
    basename === "pnpm-lock.yaml" ||
    basename === "yarn.lock"
  ) {
    return "sensitive_or_system_write"
  }

  if (
    lower.startsWith("tmp/") ||
    lower.startsWith("temp/") ||
    lower.startsWith(".tmp/") ||
    lower.startsWith(".cache/") ||
    lower.startsWith("scratch/")
  ) {
    return "harmless_local"
  }

  if (
    lower.startsWith("artifacts/") ||
    lower.startsWith("reports/") ||
    lower.startsWith("generated/") ||
    lower.startsWith("output/") ||
    lower.startsWith("out/")
  ) {
    return "project_artifact"
  }

  return "governed_project_write"
}

export function governanceExpectationForBucket(bucket: WriteRiskBucket): WriteGovernanceExpectation {
  switch (bucket) {
    case "harmless_local":
      return "optional"
    case "project_artifact":
      return "expected"
    case "governed_project_write":
      return "expected"
    case "sensitive_or_system_write":
      return "required"
  }
}

export function deriveWriteGovernanceClassification(input: {
  sessionDirectory: string
  references: string[]
}): WriteGovernanceClassification | undefined {
  const classified = input.references
    .map((reference) => classifyWritePathRisk({ sessionDirectory: input.sessionDirectory, reference }))
    .filter((entry) => entry.path)

  if (classified.length === 0) return

  const highest = classified.reduce((current, entry) =>
    writeRiskBucketRank(entry.bucket) > writeRiskBucketRank(current.bucket) ? entry : current,
  )

  return {
    bucket: highest.bucket,
    governance_expectation: highest.governance_expectation,
    references: classified
      .filter((entry) => entry.bucket === highest.bucket)
      .map((entry) => entry.path),
  }
}

function writeRiskBucketRank(bucket: WriteRiskBucket) {
  switch (bucket) {
    case "harmless_local":
      return 0
    case "project_artifact":
      return 1
    case "governed_project_write":
      return 2
    case "sensitive_or_system_write":
      return 3
  }
}
