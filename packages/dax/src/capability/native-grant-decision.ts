import { CapabilityDescriptor } from "./capability-types"
import { resolveCapabilityGrant } from "./resolve-grant"
import { ExecutionContractV2, isToolAllowedByContract, type ExecutionContract } from "@/execution/execution-contract"

export type NativeGrantDecision =
  | { decision: "allow"; capabilityId: string | null }
  | { decision: "ask"; capabilityId: string }
  | { decision: "deny"; reasonCode: string }

type Executor = { kind: "builtin" | "plugin" | "mcp"; id: string }

/**
 * Contract authority is the intersection of the historical tool filter and a
 * grant for the selected executor. A descriptor is never itself a grant.
 * Unproven targets do not receive a filesystem/delegation scope by inference.
 */
export function decideNativeGrant(input: {
  contract: ExecutionContract | ExecutionContractV2
  authorityRunId: string
  toolId: string
  executor: Executor
  capability?: CapabilityDescriptor
  args: unknown
  directory: string
  worktree: string
}): NativeGrantDecision {
  if (input.contract.schemaVersion === "v2" && !ExecutionContractV2.safeParse(input.contract).success) {
    return { decision: "deny", reasonCode: "contract_invalid" }
  }
  if (!isToolAllowedByContract(input.contract, input.toolId)) {
    return { decision: "deny", reasonCode: "contract_tool_denied" }
  }
  if (input.contract.schemaVersion === "v1") return { decision: "allow", capabilityId: null }

  if (!input.capability) return { decision: "deny", reasonCode: "capability_unenrolled" }
  const parsed = CapabilityDescriptor.safeParse(input.capability)
  if (!parsed.success) return { decision: "deny", reasonCode: "descriptor_invalid" }
  const descriptor = parsed.data
  if (input.executor.kind === "builtin") {
    if (input.executor.id !== input.toolId || descriptor.id !== `native.tool.${input.executor.id}`) {
      return { decision: "deny", reasonCode: "capability_identity_mismatch" }
    }
  } else if (
    input.executor.id !== input.toolId ||
    !descriptor.id.startsWith(`${input.executor.kind}.tool.v1.`)
  ) {
    return { decision: "deny", reasonCode: "capability_identity_mismatch" }
  }

  // Only these native file tools have a validated single filePath that is the
  // entire target population. Other apparent paths are not scope evidence.
  const paths =
    input.executor.kind === "builtin" && ["read", "write", "edit"].includes(input.toolId) &&
    typeof input.args === "object" && input.args !== null &&
    "filePath" in input.args && typeof input.args.filePath === "string"
      ? [input.args.filePath]
      : undefined

  const resolution = resolveCapabilityGrant({
    contract: input.contract,
    authorityRunId: input.authorityRunId,
    descriptor,
    directory: input.directory,
    worktree: input.worktree,
    ...(paths ? { target: { paths } } : {}),
  })
  if (resolution.decision === "deny") return resolution
  return { decision: resolution.decision, capabilityId: descriptor.id }
}
