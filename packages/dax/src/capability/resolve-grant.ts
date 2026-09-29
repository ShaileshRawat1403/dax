import path from "node:path"
import { relativeGuardPath } from "@/execution/runtime-guard-path"
import { ExecutionContractV2 } from "@/execution/execution-contract"
import { CapabilityDescriptor } from "./capability-types"
import type { CapabilityGrant } from "./grant"

export type GrantResolution =
  | { decision: "allow" | "ask"; grant: CapabilityGrant }
  | {
      decision: "deny"
      reasonCode:
        | "contract_run_mismatch"
        | "contract_invalid"
        | "descriptor_invalid"
        | "grant_absent"
        | "scope_unsupported"
        | "scope_unproven"
        | "scope_outside"
    }

type GrantTarget = { paths: readonly string[] } | { agent: string }

/**
 * A v2 grant only narrows an independently resolved executor identity. This
 * function never skips legacy approvals, runtime guards or verification.
 */
export function resolveCapabilityGrant(input: {
  contract: ExecutionContractV2
  authorityRunId: string
  descriptor: unknown
  directory: string
  worktree: string
  target?: GrantTarget
}): GrantResolution {
  const contract = ExecutionContractV2.safeParse(input.contract)
  if (!contract.success) return { decision: "deny", reasonCode: "contract_invalid" }
  if (contract.data.runId !== input.authorityRunId) return { decision: "deny", reasonCode: "contract_run_mismatch" }
  const parsed = CapabilityDescriptor.safeParse(input.descriptor)
  if (!parsed.success) return { decision: "deny", reasonCode: "descriptor_invalid" }
  const descriptor = parsed.data
  const grant = contract.data.capabilityGrants.find((item) => item.capabilityId === descriptor.id)
  if (!grant) return { decision: "deny", reasonCode: "grant_absent" }

  if (grant.scope.kind === "run") return { decision: grant.decision, grant }
  if (grant.scope.kind === "delegation") {
    if (descriptor.scopeSupport !== "delegation") return { decision: "deny", reasonCode: "scope_unsupported" }
    if (!input.target || !("agent" in input.target) || !input.target.agent) {
      return { decision: "deny", reasonCode: "scope_unproven" }
    }
    return grant.scope.agents.includes(input.target.agent)
      ? { decision: grant.decision, grant }
      : { decision: "deny", reasonCode: "scope_outside" }
  }

  if (descriptor.scopeSupport !== "filesystem") return { decision: "deny", reasonCode: "scope_unsupported" }
  if (!input.target || !("paths" in input.target) || input.target.paths.length === 0) {
    return { decision: "deny", reasonCode: "scope_unproven" }
  }
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
    if (roots.includes(null) || targets.includes(null)) return { decision: "deny", reasonCode: "scope_outside" }
    if (
      targets.every((candidate) =>
        roots.some((root) => candidate === root || candidate?.startsWith(`${root}/`) || root === ""),
      )
    ) {
      return { decision: grant.decision, grant }
    }
    return { decision: "deny", reasonCode: "scope_outside" }
  } catch {
    // A failed canonicalization is not evidence that a path is in scope.
    return { decision: "deny", reasonCode: "scope_unproven" }
  }
}
