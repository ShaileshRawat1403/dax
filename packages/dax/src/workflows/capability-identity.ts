import { createCapabilityRegistry } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"
import type { ExecutionContract } from "@/execution/execution-contract"

const phases = {
  draft_and_approve: ["execute", "resume_after_approval"],
  repo_analyze: ["execute"],
  review_and_signoff: ["execute"],
  worker_run: ["execute", "resume_after_approval"],
} as const

export type FixedWorkflowClass = keyof typeof phases
export type WorkflowPhase = (typeof phases)[FixedWorkflowClass][number]

// A workflow orchestrates potentially opaque effects. These properties do not
// assert confinement, grant permission, or replace its existing approval path.
const registry = createCapabilityRegistry(
  Object.entries(phases).flatMap(([workflowClass, supported]) =>
    supported.map((phase) => ({
      id: `workflow.${workflowClass}.${phase}`,
      riskClass: "high",
      scopeSupport: "opaque",
      requiresVerification: true,
    })),
  ),
)

/** Called by the genuine workflow method before it starts any effects. */
export function requireFixedWorkflowCapability(input: {
  workflowClass: FixedWorkflowClass
  phase: WorkflowPhase
  contract: ExecutionContract
  runId: string
}): CapabilityDescriptor {
  if (!Object.hasOwn(phases, input.workflowClass)) throw new CapabilityIdentityError("malformed")
  if (
    !phases[input.workflowClass].includes(input.phase as never) ||
    input.contract?.workflowClass !== input.workflowClass ||
    input.contract.runId !== input.runId
  )
    throw new CapabilityIdentityError("changed")
  return registry.require(`workflow.${input.workflowClass}.${input.phase}`)
}

export function listFixedWorkflowCapabilities(): readonly CapabilityDescriptor[] {
  return registry.list()
}
