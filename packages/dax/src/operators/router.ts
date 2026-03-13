import type { Operator } from "./base"
import type { PlannedTask } from "../planner/task-graph"
import { ExploreOperator } from "./explore"
import { GitOperator } from "./git"
import { VerifyOperator } from "./verify"
import { ReleaseOperator } from "./release"
import { ArtifactOperator } from "./artifact"

export class OperatorRouter {
  private operators: Map<string, Operator> = new Map()

  register(operator: Operator) {
    this.operators.set(operator.type, operator)
  }

  getOperator(type: string): Operator | undefined {
    return this.operators.get(type)
  }

  async route(task: PlannedTask): Promise<Operator> {
    const operator = this.operators.get(task.operator_type)
    if (!operator) {
      throw new Error(`No operator found for type: ${task.operator_type}`)
    }
    return operator
  }
}

export function createInitializedRouter(): OperatorRouter {
  const router = new OperatorRouter()
  router.register(new ExploreOperator())
  router.register(new GitOperator())
  router.register(new VerifyOperator())
  router.register(new ReleaseOperator())
  router.register(new ArtifactOperator())
  return router
}

// Singleton router instance
export const defaultRouter = createInitializedRouter()
