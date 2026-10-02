import path from "node:path"
import { relativeGuardPath } from "@/execution/runtime-guard-path"
import {
  decideContractTool,
  ExecutionContractV2,
  isToolAllowedByContract,
  type ExecutionContract,
} from "@/execution/execution-contract"
import { mcpReadDescriptor, MCP_PROMPT_NAMESPACE, MCP_RESOURCE_NAMESPACE } from "@/mcp/resource-identity"
import { CapabilityDescriptor } from "./capability-types"
import { mcpCapability, MCP_TOOL_NAMESPACE } from "./dynamic-identity"
import type { CapabilityGrant } from "./grant"
import type { AuthorityPath } from "./authority-paths"

/**
 * One resolution of authority for one action, for every execution path.
 *
 * It is computed from the governing contract, the descriptor of the executor
 * that was actually selected, and the target evidence the path can prove. It is
 * never computed from an alias.
 *
 * In this stage the result is RECORD ONLY. It is what the shared lookup
 * concludes, written down beside the action. It authorizes nothing and denies
 * nothing: the decision that is enforced is still made by the existing contract
 * filter, permission rules, runtime guard and sandbox, and is recorded separately
 * as the authorization. `enforcement` says which of the two a record is, so a
 * reader can never take a shadow decision for an enforced one.
 */
export type CapabilityResolution = {
  enforcement: "record_only"
  /** Which execution path asked. */
  path: AuthorityPath
  /** Who initiated the action: a model turn, the operator directly, or DAX itself. */
  initiator: "model" | "operator" | "system"
  /** The selected executor's source-qualified identity. Absent for an executor with no descriptor. */
  capabilityId?: string
  /** True when the executor has a validated descriptor. A legacy custom tool or operator has none. */
  enrolled: boolean
  /** What kind of authority governed this action. */
  basis: "v2_grant" | "v1_contract" | "no_contract"
  contractId?: string
  decision: "allow" | "ask" | "deny"
  /** Why, when the decision is not a plain allow. */
  reasonCode?: CapabilityResolutionReason
  /** The scope of the grant that matched, for a v2 decision. */
  grantScope?: CapabilityGrant["scope"]["kind"]
}

export { ACTION_PATHS, AUTHORITY_PATHS, INVOCATION_PATHS, type AuthorityPath } from "./authority-paths"

export type CapabilityResolutionReason =
  // v1 and no-contract bases: the existing rules, restated.
  | "no_governing_contract"
  | "contract_tool_denied"
  | "contract_alias_executor_mismatch"
  | "v1_contract_has_no_selector"
  // v2 basis.
  | "contract_invalid"
  | "contract_run_mismatch"
  | "capability_unenrolled"
  | "descriptor_invalid"
  | "source_unproven"
  | "grant_absent"
  | "scope_unsupported"
  | "scope_unproven"
  | "scope_outside"
  | "scope_unconfined_unacknowledged"

export type AuthorityTarget = { paths: readonly string[] } | { agent: string }

/** The configured server and item name an MCP identity was minted from. */
export type McpSource = { server: string; name: string }

export type ResolveAuthorityInput = {
  path: AuthorityPath
  initiator: CapabilityResolution["initiator"]
  /** The governing contract, or null when the action has none. */
  contract: ExecutionContract | ExecutionContractV2 | null
  /** The run whose contract this is. Required to match for a v2 decision. */
  authorityRunId?: string
  /**
   * The selected executor. `descriptor` is absent for an executor that was never
   * enrolled. `alias` is the tool name a v1 contract can list it under; a path a
   * v1 contract has no name for, such as a workflow or a worker, has none.
   */
  executor: { kind: "builtin" | "plugin" | "mcp"; alias?: string; descriptor?: unknown }
  /** Where an MCP identity came from. Needed for a grant that selects by source. */
  source?: McpSource
  target?: AuthorityTarget
  directory: string
  worktree: string
}

function mcpFamily(id: string): "tool" | "resource" | "prompt" | undefined {
  if (id.startsWith(MCP_TOOL_NAMESPACE)) return "tool"
  if (id.startsWith(MCP_RESOURCE_NAMESPACE)) return "resource"
  if (id.startsWith(MCP_PROMPT_NAMESPACE)) return "prompt"
  return undefined
}

/** Re-mint the identity from the claimed source. A source is proven only if it yields this exact ID. */
function sourceProves(id: string, family: "tool" | "resource" | "prompt", source: McpSource): boolean {
  try {
    const minted =
      family === "tool"
        ? mcpCapability(["mcp", source.server, source.name]).descriptor.id
        : mcpReadDescriptor(family, source.server, source.name).id
    return minted === id
  } catch {
    return false
  }
}

/**
 * The grant a v2 contract holds for one identity. An exact grant for the
 * identity wins. Otherwise an MCP identity may be selected by its source, but
 * only a source that re-mints this exact ID. Pure; the same selection the
 * lookup below makes, exposed so enforcement checks the binding of the grant
 * that actually matched.
 */
export function selectGrant(
  contract: ExecutionContractV2,
  capabilityId: string,
  source?: McpSource,
): CapabilityGrant | "source_unproven" | undefined {
  const exact = contract.capabilityGrants.find(
    (item) => item.subject.kind === "capability" && item.subject.capabilityId === capabilityId,
  )
  if (exact) return exact
  const family = mcpFamily(capabilityId)
  if (!family) return undefined
  const selectors = contract.capabilityGrants.filter(
    (item) => item.subject.kind === "mcp_source" && item.subject.family === family,
  )
  if (selectors.length === 0) return undefined
  if (!source || !sourceProves(capabilityId, family, source)) return "source_unproven"
  return selectors.find((item) => item.subject.kind === "mcp_source" && item.subject.server === source.server)
}

/**
 * Resolve authority for one action. Pure: it reads nothing and records nothing.
 *
 * - No contract: the action is ungoverned, as it is today. Recorded as such.
 * - v1 contract: the existing executor-bound tool rule, restated.
 * - v2 contract: a grant is required. A missing grant is a denial, never a
 *   prompt; asking takes an explicit `ask` grant. An executor with no descriptor
 *   cannot be named by a grant and is denied.
 */
export function resolveCapabilityAuthority(input: ResolveAuthorityInput): CapabilityResolution {
  const parsed = input.executor.descriptor === undefined ? undefined : CapabilityDescriptor.safeParse(input.executor.descriptor)
  const descriptor = parsed?.success ? parsed.data : undefined
  const base = {
    enforcement: "record_only" as const,
    path: input.path,
    initiator: input.initiator,
    enrolled: descriptor !== undefined,
    ...(descriptor ? { capabilityId: descriptor.id } : {}),
  }

  if (!input.contract) {
    return { ...base, basis: "no_contract", decision: "allow", reasonCode: "no_governing_contract" }
  }

  if (input.contract.schemaVersion !== "v2") {
    // A v1 contract lists tools by alias and nothing else. A path it has no
    // name for was never consulted by it, and the lookup says exactly that
    // rather than inventing an allow or a deny from the tool list.
    if (input.executor.alias === undefined) {
      return {
        ...base,
        basis: "v1_contract",
        contractId: input.contract.contractId,
        decision: "allow",
        reasonCode: "v1_contract_has_no_selector",
      }
    }
    const decision = decideContractTool(input.contract, input.executor.alias, { kind: input.executor.kind })
    return {
      ...base,
      basis: "v1_contract",
      contractId: input.contract.contractId,
      ...(decision.allowed
        ? { decision: "allow" as const }
        : { decision: "deny" as const, reasonCode: decision.reasonCode }),
    }
  }

  const contract = ExecutionContractV2.safeParse(input.contract)
  const v2 = { ...base, basis: "v2_grant" as const, contractId: input.contract.contractId }
  const deny = (reasonCode: CapabilityResolutionReason): CapabilityResolution => ({ ...v2, decision: "deny", reasonCode })
  if (!contract.success) return deny("contract_invalid")
  if (contract.data.runId !== input.authorityRunId) return deny("contract_run_mismatch")
  // The contract's own tool lists still bind: a selector or family grant can
  // never revive a tool the contract blocks, nor reach one it does not allow.
  if (input.executor.alias !== undefined && !isToolAllowedByContract(contract.data, input.executor.alias)) {
    return deny("contract_tool_denied")
  }
  if (input.executor.descriptor === undefined) return deny("capability_unenrolled")
  if (!descriptor) return deny("descriptor_invalid")

  const selected = selectGrant(contract.data, descriptor.id, input.source)
  if (selected === "source_unproven") return deny("source_unproven")
  const grant = selected
  if (!grant) return deny("grant_absent")

  const matched = (): CapabilityResolution => ({ ...v2, decision: grant.decision, grantScope: grant.scope.kind })
  if (grant.scope.kind === "run") {
    // Run scope confines nothing to a path. For a capability that can be
    // confined, it holds only when the operator said so explicitly.
    if (descriptor.scopeSupport === "filesystem" && grant.scope.acknowledgesNoFilesystemConfinement !== true) {
      return deny("scope_unconfined_unacknowledged")
    }
    return matched()
  }

  if (grant.scope.kind === "delegation") {
    if (descriptor.scopeSupport !== "delegation") return deny("scope_unsupported")
    if (!input.target || !("agent" in input.target) || !input.target.agent) return deny("scope_unproven")
    return grant.scope.agents.includes(input.target.agent) ? matched() : deny("scope_outside")
  }

  if (descriptor.scopeSupport !== "filesystem") return deny("scope_unsupported")
  if (!input.target || !("paths" in input.target) || input.target.paths.length === 0) return deny("scope_unproven")
  try {
    const normalize = (value: string) => {
      const result = relativeGuardPath({
        filePath: value,
        directory: input.directory,
        worktree: input.worktree,
      }).replaceAll("\\", "/")
      if (path.posix.isAbsolute(result) || result === ".." || result.startsWith("../")) return null
      return result.replace(/\/+$/, "")
    }
    const roots = grant.scope.roots.map(normalize)
    const targets = input.target.paths.map(normalize)
    if (roots.includes(null) || targets.includes(null)) return deny("scope_outside")
    const inside = targets.every((candidate) =>
      roots.some((root) => root === "" || candidate === root || candidate?.startsWith(`${root}/`)),
    )
    return inside ? matched() : deny("scope_outside")
  } catch {
    // A failed canonicalization is not evidence that a path is in scope.
    return deny("scope_unproven")
  }
}
