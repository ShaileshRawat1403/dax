import type {
  Finding,
  Hypothesis,
  OpenQuestion,
  Risk,
  NextAction,
  EmittedArtifact,
  TrustState,
  ApprovalState,
} from "../session/state-types"

export interface ContextPack {
  sessionId: string
  workflowId?: string
  taskId: string
  operator: string
  goal?: string
  repoTarget?: string

  validatedFindings: Finding[]
  activeHypotheses: Hypothesis[]
  openQuestions: OpenQuestion[]
  risks: Risk[]
  importantFiles: string[]
  artifacts: EmittedArtifact[]

  trustState?: TrustState
  approvalState?: ApprovalState
  nextActions: NextAction[]

  summary?: string
}
