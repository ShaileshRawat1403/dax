import { ExecutionContractV2 } from "@/execution/execution-contract"
import {
  resolveCapabilityAuthority,
  selectGrant,
  type CapabilityResolution,
  type ResolveAuthorityInput,
} from "./authority"
import { checkBinding, subjectKey, type ReviewCatalogSnapshot } from "./grant-proposal"

/**
 * Stage 4b: enforcement for an activated reviewed run.
 *
 * The decision is the shared lookup's, against the published reviewed
 * contract, with two further conditions: the run's journal must hold an
 * activation for exactly that contract, and the binding of the grant that
 * matched must be unchanged now, by content. A grant is necessary, never
 * sufficient: an allowed action still passes every existing permission rule
 * and the runtime guard.
 *
 * `ask` grants are refused until the approval flow carries the grant (4c).
 */
export type EnforcedResolution = Omit<CapabilityResolution, "enforcement" | "reasonCode"> & {
  enforcement: "enforced"
  activation: { revision: number; contractDigest: string }
  grantSubject?: string
  reasonCode?: CapabilityResolution["reasonCode"] | EnforcementReason
}

export type EnforcementReason =
  | "activation_missing"
  | "binding_changed"
  | "binding_unavailable"
  | "grant_ask_unsupported"

export type Activation = {
  revision: number
  contractDigest: string
  bindings: readonly { subject: string; attestation: "exact" | "external"; digest: string }[]
}

/**
 * Pure. Decides one action for an activated reviewed run from the published
 * contract, the journal's activation, and a description of what would run now.
 */
export async function decideReviewedAction(input: {
  contract: ExecutionContractV2
  contractDigest: string
  activation: Activation | null
  resolve: Omit<ResolveAuthorityInput, "contract">
  current: ReviewCatalogSnapshot
}): Promise<EnforcedResolution> {
  const cited = input.activation
    ? { revision: input.activation.revision, contractDigest: input.activation.contractDigest }
    : { revision: 1, contractDigest: input.contractDigest }
  const resolution = resolveCapabilityAuthority({ ...input.resolve, contract: input.contract })
  const enforced: EnforcedResolution = { ...resolution, enforcement: "enforced", activation: cited }
  const deny = (reasonCode: EnforcedResolution["reasonCode"]): EnforcedResolution => ({
    ...enforced,
    decision: "deny",
    reasonCode,
    grantScope: undefined,
  })
  if (!input.activation || input.activation.contractDigest !== input.contractDigest) return deny("activation_missing")
  if (resolution.decision === "deny") return enforced

  const grant = resolution.capabilityId
    ? selectGrant(input.contract, resolution.capabilityId, input.resolve.source)
    : undefined
  if (!grant || grant === "source_unproven") return deny("grant_absent")
  const key = subjectKey(grant.subject)
  const bound = input.activation.bindings.find((item) => item.subject === key)
  if (!bound) return deny("binding_unavailable")
  const status = await checkBinding(
    { subject: key, attestation: bound.attestation, canonicalization: "sorted-json-v1", digest: bound.digest },
    grant.subject,
    input.current,
  )
  if (status === "unavailable") return deny("binding_unavailable")
  if (status === "changed") return deny("binding_changed")
  if (resolution.decision === "ask") return deny("grant_ask_unsupported")
  return { ...enforced, grantSubject: key }
}

/** Strips an unset optional field so the record stays within its closed schema. */
export function enforcedRecord(resolution: EnforcedResolution) {
  const { grantScope, reasonCode, grantSubject, ...rest } = resolution
  return {
    ...rest,
    ...(grantScope !== undefined ? { grantScope } : {}),
    ...(reasonCode !== undefined ? { reasonCode } : {}),
    ...(grantSubject !== undefined ? { grantSubject } : {}),
  }
}
