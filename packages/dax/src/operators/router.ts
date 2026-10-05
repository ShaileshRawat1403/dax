import { customCapability } from "@/capability/custom-identity"
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
  private customBindings = new Map<string, { receiver: Operator; execute: Operator["execute"]; capability: CapabilityDescriptor }>()
  private bindings: Map<string, BuiltinOperatorBinding> = new Map()

  register(operator: Operator) {
    const type = operator.type
    if (typeof type !== "string" || !type || this.operators.has(type)) {
      throw new CapabilityIdentityError("ambiguous")
    }
    const binding = bindBuiltinOperator(operator, type)
    const custom = binding ? undefined : {
      receiver: operator, execute: operator.execute, capability: customCapability("operator", type),
    }
    if (custom && typeof custom.execute !== "function") throw new CapabilityIdentityError("malformed")
    this.operators.set(type, operator)
    if (binding) this.bindings.set(type, binding)
    else this.customBindings.set(type, Object.freeze(custom!))
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
      const custom = this.customBindings.get(task.operator_type)
      const check = () => {
        if (!custom || custom.receiver !== operator || operator.type !== task.operator_type || operator.execute !== custom.execute) {
          throw new CapabilityIdentityError("changed")
        }
      }
      check()
      return {
        capability: custom!.capability,
        execute: (context) => {
          check()
          return custom!.execute.call(custom!.receiver, task, context)
        },
      }
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
