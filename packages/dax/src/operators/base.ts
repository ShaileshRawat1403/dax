import type { PlannedTask, TaskGraph } from "../planner/task-graph"
import type { ApprovalRequest } from "../governance/approval"
import type { ArtifactRecord } from "../governance/artifact"
import type { TrustDelta } from "../governance/trust"
import type { Finding, Hypothesis, OpenQuestion, Risk, NextAction } from "../session/state-types"
import type { ContextPack } from "../context/context-types"

export interface OperatorContext {
  sessionId: string
  cwd: string
  graph?: TaskGraph
  contextPack?: ContextPack
  reportMilestone?: (input: { taskID: string; label: string }) => Promise<void> | void
  reportArtifact?: (artifact: ArtifactRecord) => Promise<void> | void
  reportApprovalRequest?: (request: ApprovalRequest) => Promise<void> | void
}

export interface OperatorResult {
  success: boolean
  output: any
  error?: Error
  artifacts?: ArtifactRecord[]
  approvalRequest?: ApprovalRequest
  trustDelta?: TrustDelta
  findings?: Finding[]
  hypotheses?: Hypothesis[]
  openQuestions?: OpenQuestion[]
  risks?: Risk[]
  nextActions?: NextAction[]
  warnings?: string[]
}

export interface Operator {
  /**
   * The domain identifier for this operator (e.g., 'explore', 'git', 'verify')
   */
  readonly type: string

  /**
   * Executes the given task within the provided context.
   */
  execute(task: PlannedTask, context: OperatorContext): Promise<OperatorResult>
}
