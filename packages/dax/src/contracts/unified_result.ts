import type { ApprovalDecision } from "../governance/approval"
import type { ArtifactRecord } from "../governance/artifact"
import type { PolicyEvaluation } from "../governance/policy"

export interface UnifiedResult {
  sessionId: string

  evidenceCompleteness: number // A score from 0 to 1

  approvals: {
    coverage: number // A score from 0 to 1
    decisions: ApprovalDecision[]
  }

  artifacts: {
    count: number
    records: ArtifactRecord[]
  }

  policy: {
    violations: number
    evaluations: PolicyEvaluation[]
  }

  release: {
    isReady: boolean
    blockers: string[]
  }

  trust: {
    score: number // A score from 0 to 1
    posture: "trusted" | "neutral" | "untrusted"
  }
}
