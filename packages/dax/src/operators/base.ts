import type { PlannedTask, TaskGraph } from '../planner/task-graph';

export interface OperatorContext {
  sessionId: string;
  cwd: string;
  graph?: TaskGraph;
  reportMilestone?: (input: { taskID: string; label: string }) => Promise<void> | void;
  // Can add references to tools, session state, governance, etc.
}

export interface OperatorResult {
  success: boolean;
  output: any;
  error?: Error;
  artifacts?: string[];
  requiresApproval?: boolean;
}

export interface Operator {
  /**
   * The domain identifier for this operator (e.g., 'explore', 'git', 'verify')
   */
  readonly type: string;

  /**
   * Executes the given task within the provided context.
   */
  execute(task: PlannedTask, context: OperatorContext): Promise<OperatorResult>;
}
