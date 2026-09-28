import type { PlannedTask } from "@/planner/task-graph"
import { createCapabilityRegistry } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import type { Operator } from "./base"
import { ExploreOperator } from "./explore"
import { GitOperator } from "./git"
import { VerifyOperator } from "./verify"
import { ReleaseOperator } from "./release"
import { ArtifactOperator } from "./artifact"

// These are intrinsic descriptions of the built-in graph executors, not grants.
// The graph's existing approval, verification and reporting behavior is unchanged.
// All operators can have opaque side effects; the descriptor does not promise
// filesystem confinement, even when an implementation usually writes a report.
const specifications = [
  { type: "explore", prototype: ExploreOperator.prototype, execute: ExploreOperator.prototype.execute, genuine: ExploreOperator.isGenuine, actions: ["run"] },
  { type: "git", prototype: GitOperator.prototype, execute: GitOperator.prototype.execute, genuine: GitOperator.isGenuine, actions: ["add", "commit", "push", "checkout", "status"] },
  { type: "verify", prototype: VerifyOperator.prototype, execute: VerifyOperator.prototype.execute, genuine: VerifyOperator.isGenuine, actions: ["report"] },
  { type: "release", prototype: ReleaseOperator.prototype, execute: ReleaseOperator.prototype.execute, genuine: ReleaseOperator.isGenuine, actions: ["report"] },
  { type: "artifact", prototype: ArtifactOperator.prototype, execute: ArtifactOperator.prototype.execute, genuine: ArtifactOperator.isGenuine, actions: ["report"] },
] as const

type Specification = (typeof specifications)[number]
const byType = new Map<string, Specification>(specifications.map((item) => [item.type, item]))
const registry = createCapabilityRegistry(
  specifications.flatMap((item) =>
    item.actions.map((action) => ({
      id: `operator.${item.type}.${action}`,
      riskClass: "high",
      scopeSupport: "opaque",
      requiresVerification: true,
    })),
  ),
)

export interface BuiltinOperatorBinding {
  readonly receiver: Operator
  readonly execute: Operator["execute"]
  readonly type: string
  readonly prototype: object
}

/** A custom operator stays compatible but explicitly unenrolled. */
export function bindBuiltinOperator(operator: Operator): BuiltinOperatorBinding | undefined {
  const specification = byType.get(operator.type)
  if (!specification) return undefined
  if (
    !specification.genuine(operator) ||
    Object.getPrototypeOf(operator) !== specification.prototype ||
    operator.execute !== specification.execute ||
    specification.prototype.execute !== specification.execute
  ) throw new CapabilityIdentityError("changed")
  return Object.freeze({
    receiver: operator,
    execute: specification.execute,
    type: specification.type,
    prototype: specification.prototype,
  })
}

export function requireBuiltinOperatorCapability(
  binding: BuiltinOperatorBinding,
  operator: Operator,
  task: PlannedTask,
): CapabilityDescriptor {
  if (
    binding.receiver !== operator ||
    binding.type !== operator.type ||
    binding.type !== task.operator_type ||
    !byType.get(binding.type)?.genuine(operator) ||
    Object.getPrototypeOf(operator) !== binding.prototype ||
    operator.execute !== binding.execute ||
    (binding.prototype as Operator).execute !== binding.execute
  ) throw new CapabilityIdentityError("changed")

  let action: string
  if (binding.type === "git") {
    const supplied = task.context?.action
    action = supplied === undefined || supplied === null || supplied === "" ? "commit" : supplied
    if (typeof action !== "string" || !["add", "commit", "push", "checkout", "status"].includes(action)) {
      throw new CapabilityIdentityError("malformed")
    }
  } else {
    action = binding.type === "explore" ? "run" : "report"
  }
  return registry.require(`operator.${binding.type}.${action}`)
}

export function listBuiltinOperatorCapabilities(): readonly CapabilityDescriptor[] {
  return registry.list()
}
