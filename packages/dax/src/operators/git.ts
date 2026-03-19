import type { Operator, OperatorContext, OperatorResult } from "./base"
import type { PlannedTask } from "../planner/task-graph"

export class GitOperator implements Operator {
  type = "git"

  async execute(task: PlannedTask, ctx: OperatorContext): Promise<OperatorResult> {
    const markdownOutput = `## Git Operator\n\nGit-based workflow execution is not implemented for task \`${task.id}\` yet.`
    return {
      success: false,
      output: {
        status: "not_implemented",
        operator: this.type,
        task: task.id,
        sessionId: ctx.sessionId,
      },
      error: new Error(`GitOperator is not implemented for release workflows yet (task: ${task.id})`),
      warnings: ["git operator is not implemented"],
      markdownOutput,
    }
  }
}
