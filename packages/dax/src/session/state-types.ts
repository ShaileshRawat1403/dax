export type FindingType =
  | "code_smell"
  | "dependency_issue"
  | "architectural_boundary"
  | "test_gap"
  | "security_risk"
  | "docs_gap"

export type Severity = "critical" | "major" | "minor" | "info"

export interface Finding {
  id: string
  type: FindingType
  severity: Severity
  title: string
  description: string
  evidence: string[] // Paths to files or specific code snippets
  confirmed: boolean
  timestamp: string
}

export type HypothesisStatus = "testing" | "validated" | "rejected" | "pending"

export interface Hypothesis {
  id: string
  statement: string
  status: HypothesisStatus
  relatedFindings?: string[] // IDs of findings
  timestamp: string
}

export type QuestionPriority = "high" | "medium" | "low"
export type QuestionStatus = "unanswered" | "answered" | "dismissed"

export interface OpenQuestion {
  id: string
  question: string
  context: string // Why this question is important
  priority: QuestionPriority
  status: QuestionStatus
  answer?: string
  timestamp: string
}

export type RiskLikelihood = "high" | "medium" | "low"
export type RiskImpact = "high" | "medium" | "low"
export type RiskStatus = "identified" | "mitigated" | "accepted"

export interface Risk {
  id: string
  description: string
  likelihood: RiskLikelihood
  impact: RiskImpact
  mitigation?: string
  status: RiskStatus
  timestamp: string
}

export type ActionStatus = "pending" | "in_progress" | "completed" | "skipped"

export interface NextAction {
  id: string
  description: string
  rationale: string // Why this is the next best action
  dependencies: string[] // Artifacts or findings required
  status: ActionStatus
  timestamp: string
}

export interface EmittedArtifact {
  id: string
  type: string // e.g., 'report', 'map', 'graph'
  name: string
  path: string
  description: string
  producedBy: string // Operator or Skill ID
  timestamp: string
}

export type TrustPosture = "trusted" | "neutral" | "untrusted"

export interface TrustSignal {
  source: string // e.g., 'operator_id', 'policy_check'
  delta: number
  reason: string
}

export interface TrustState {
  score: number // 0.0 to 1.0
  posture: TrustPosture
  signals: TrustSignal[]
  lastUpdated: string
}

export interface ApprovalRequest {
  requestId: string
  reason: string
  requestedAt: string
}

export interface ApprovalGranted {
  requestId: string
  grantedBy: string
  grantedAt: string
}

export interface ApprovalDenied {
  requestId: string
  deniedBy: string
  deniedAt: string
  reason: string
}

export interface ApprovalState {
  pending: ApprovalRequest[]
  granted: ApprovalGranted[]
  denied: ApprovalDenied[]
}

export type SessionStatus = "active" | "paused" | "completed" | "abandoned"

export interface Workspace {
  cwd: string
  repo?: string
}

export interface SessionState {
  id: string
  status: SessionStatus

  // Context
  currentGoal?: string
  workflowId?: string // If running a workflow
  workspace: Workspace

  // Intelligence
  findings: Finding[]
  hypotheses: Hypothesis[]
  openQuestions: OpenQuestion[]
  risks: Risk[]
  nextActions: NextAction[]
  completedSteps: string[]

  // Governance & Evidence
  emittedArtifacts: EmittedArtifact[]
  trustState: TrustState
  approvalState: ApprovalState

  // Metadata
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface SessionSummary {
  sessionId: string
  status: SessionStatus

  // One-paragraph summary of current status
  narrative: string

  // Key metrics
  findingsCount: number
  artifactsCount: number
  trustScore: number

  // Top priorities
  topRisks: Risk[]
  nextBestActions: NextAction[]
  openQuestions: OpenQuestion[]
}
