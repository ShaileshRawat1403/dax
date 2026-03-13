import type { PlannedTask, TaskGraph } from "../planner/task-graph"
import type { ApprovalRequest } from "../governance/approval"
import type { ArtifactRecord } from "../governance/artifact"
import type { TrustDelta } from "../governance/trust"

export interface OperatorContext {
  sessionId: string
  cwd: string
  graph?: TaskGraph
  reportMilestone?: (input: { taskID: string; label: string }) => Promise<void> | void
  reportArtifact?: (artifact: ArtifactRecord) => Promise<void> | void
  reportApprovalRequest?: (request: ApprovalRequest) => Promise<void> | void
  // Can add references to tools, session state, governance, etc.
}

export interface OperatorResult {
  success: boolean
  output: any
  error?: Error
  artifacts?: ArtifactRecord[]
  approvalRequest?: ApprovalRequest
  trustDelta?: TrustDelta
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
