import type { Operator } from "./base"
import type { PlannedTask } from "../planner/task-graph"
import { ExploreOperator } from "./explore"
import { GitOperator } from "./git"
import { VerifyOperator } from "./verify"
import { ReleaseOperator } from "./release"
import { ArtifactOperator } from "./artifact"
import {
  bindBuiltinOperator,
  requireBuiltinOperatorCapability,
  type BuiltinOperatorBinding,
} from "./capability-identity"
import type { OperatorContext, OperatorResult } from "./base"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"

export class OperatorRouter {
  private operators: Map<string, Operator> = new Map()
  private bindings: Map<string, BuiltinOperatorBinding> = new Map()

  register(operator: Operator) {
    if (!operator.type || this.operators.has(operator.type)) throw new CapabilityIdentityError("ambiguous")
    const binding = bindBuiltinOperator(operator)
    this.operators.set(operator.type, operator)
    if (binding) this.bindings.set(operator.type, binding)
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

  /** Resolve the actual registered executor before graph effects. No authority is granted. */
  execution(task: PlannedTask, operator: Operator): {
    capability?: CapabilityDescriptor
    execute: (context: OperatorContext) => Promise<OperatorResult>
  } {
    if (this.operators.get(task.operator_type) !== operator) throw new CapabilityIdentityError("stale")
    const binding = this.bindings.get(task.operator_type)
    if (!binding) {
      // Existing caller-supplied graph operators are a separate, unenrolled API.
      if (operator.type !== task.operator_type) throw new CapabilityIdentityError("changed")
      return { execute: (context) => operator.execute(task, context) }
    }
    const capability = requireBuiltinOperatorCapability(binding, operator, task)
    return {
      capability,
      execute: (context) => {
        if (requireBuiltinOperatorCapability(binding, operator, task).id !== capability.id) {
          throw new CapabilityIdentityError("changed")
        }
        return binding.execute.call(binding.receiver, task, context)
      },
    }
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
