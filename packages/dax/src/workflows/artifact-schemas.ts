export const ARTIFACT_SCHEMA_VERSION = "1.0.0"

export interface BaseArtifact {
  schema_version: string
  artifact_type: string
  workflow_id?: string
  operator: string
  created_at: string
  summary: string
}

export interface ExploreReportPayload {
  repo_type?: string
  entry_points: string[]
  boundaries: string[]
  architecture_patterns: string[]
  ambiguous_areas: string[]
  next_steps: string[]
}

export interface ExploreReport extends BaseArtifact {
  artifact_type: "explore_report"
  payload: ExploreReportPayload
}

export interface VerificationReportPayload {
  checks_passed: number
  checks_failed: number
  trust_score: number
  blockers: string[]
  warnings: string[]
  evidence: string[]
  verification_summary: string
}

export interface VerificationReport extends BaseArtifact {
  artifact_type: "verification_report"
  payload: VerificationReportPayload
}

export interface ArtifactInventoryPayload {
  total_count: number
  by_type: Record<string, number>
  by_operator: Record<string, number>
  artifacts: {
    id: string
    type: string
    name: string
    path: string
    produced_by: string
    timestamp: string
  }[]
}

export interface ArtifactInventory extends BaseArtifact {
  artifact_type: "artifact_inventory"
  payload: ArtifactInventoryPayload
}

export interface ReleaseReadinessPayload {
  status: "ready" | "needs-work" | "blocked"
  blockers: string[]
  warnings: string[]
  missing_evidence: string[]
  release_summary: string
  recommended_next_steps: string[]
}

export interface ReleaseReadiness extends BaseArtifact {
  artifact_type: "release_report"
  payload: ReleaseReadinessPayload
}
