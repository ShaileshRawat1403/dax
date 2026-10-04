import { ExecutionContractV2 } from "@/execution/execution-contract"
import {
  resolveCapabilityAuthority,
  selectGrant,
  type CapabilityResolution,
  type ResolveAuthorityInput,
} from "./authority"
import { checkBinding, subjectKey, type ReviewCatalogSnapshot } from "./grant-proposal"
import type { GrantAskSubject } from "@/state/events/contract-grant-approval"
import { parseMcpReadV2 } from "@/mcp/resource-identity"

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
 * An `ask` grant returns `ask` with the exact subject the operator approves;
 * the caller obtains that approval, or finds it remembered, before any effect.
 */
export type EnforcedResolution = Omit<CapabilityResolution, "enforcement" | "reasonCode"> & {
  enforcement: "enforced"
  activation: { revision: number; contractDigest: string }
  grantSubject?: string
  /** The proven source, recorded when an MCP tool was matched by a source grant. */
  source?: { server: string; name: string }
  /** For a delegation grant, the agent it allowed. */
  delegatedAgent?: string
  /** What satisfied an `ask`, once something has. */
  askSatisfiedBy?: { approvalId: string; remembered: boolean }
  /** For an `ask`: exactly what the operator is asked to approve. Never recorded on the resolution itself. */
  askSubject?: GrantAskSubject
  reasonCode?: CapabilityResolution["reasonCode"] | EnforcementReason
}

export type EnforcementReason =
  | "activation_missing"
  | "binding_changed"
  | "binding_unavailable"
  | "grant_ask_denied"
  | "grant_ask_expired"

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
  // An ask names exactly what the operator approves: this grant, for this
  // capability, under this contract and binding. Nothing broader.
  const ask: Pick<EnforcedResolution, "askSubject"> =
    resolution.decision === "ask" && resolution.capabilityId
      ? {
          askSubject: {
            kind: "capability_grant_ask",
            grantSubject: key,
            capabilityId: resolution.capabilityId,
            contractDigest: input.activation.contractDigest,
            bindingDigest: bound.digest,
          },
        }
      : {}
  if (grant.subject.kind === "mcp_source" && grant.subject.family !== "tool") {
    // A resource or prompt is covered only by a v2 identity, whose server
    // commitment replay checks against the grant; the item name is not recorded.
    if (!resolution.capabilityId || !parseMcpReadV2(resolution.capabilityId)) return deny("source_unproven")
    return { ...enforced, ...ask, grantSubject: key }
  }
  if (grant.subject.kind === "mcp_source") {
    // Replay re-mints the identity from this to prove the grant's server covers it.
    if (!input.resolve.source) return deny("source_unproven")
    return {
      ...enforced,
      ...ask,
      grantSubject: key,
      source: { server: input.resolve.source.server, name: input.resolve.source.name },
    }
  }
  const delegated =
    grant.scope.kind === "delegation" && input.resolve.target && "agent" in input.resolve.target
      ? { delegatedAgent: input.resolve.target.agent }
      : {}
  return { ...enforced, ...ask, ...delegated, grantSubject: key }
}

/** The same resolution, denied: a denial names no grant and carries nothing of the ask. */
export function denied(
  resolution: EnforcedResolution,
  reasonCode: NonNullable<EnforcedResolution["reasonCode"]>,
): EnforcedResolution {
  const {
    grantSubject: _grant,
    source: _source,
    askSubject: _ask,
    askSatisfiedBy: _satisfied,
    delegatedAgent: _agent,
    ...rest
  } = resolution
  return { ...rest, decision: "deny", reasonCode, grantScope: undefined }
}

/**
 * Settles an `ask` before anything runs: a remembered approval for exactly
 * this tuple satisfies it; otherwise, when `askNow` is given, the operator is
 * asked and the answer settles it. Without `askNow` an unremembered ask is
 * returned unsatisfied, for a caller that asks after recording it.
 */
/**
 * After waiting for the operator, decides again from what holds now. The
 * approval covers only the exact ask it answered: if the authority or the
 * binding changed while waiting, the action is denied with the current reason.
 */
export async function recheckAfterWait(
  asked: EnforcedResolution,
  decideNow: () => Promise<EnforcedResolution | undefined>,
): Promise<EnforcementReason | CapabilityResolution["reasonCode"] | undefined> {
  const now = await decideNow().catch(() => undefined)
  if (!now) return "activation_missing"
  if (now.decision === "deny") return now.reasonCode ?? "binding_changed"
  const a = asked.askSubject
  const b = now.askSubject
  if (
    now.decision !== "ask" ||
    !a ||
    !b ||
    a.grantSubject !== b.grantSubject ||
    a.capabilityId !== b.capabilityId ||
    a.contractDigest !== b.contractDigest ||
    a.bindingDigest !== b.bindingDigest
  ) {
    return "binding_changed"
  }
  return undefined
}

export async function settleAsk(
  runId: string,
  resolution: EnforcedResolution,
  options?: { askNow?: string; decideNow?: () => Promise<EnforcedResolution | undefined> },
): Promise<{ resolution: EnforcedResolution; satisfied: boolean; expired?: string }> {
  const askNow = options?.askNow
  if (resolution.decision !== "ask" || !resolution.askSubject)
    return { resolution, satisfied: resolution.decision === "allow" }
  const { rememberedAsk, askOperator } = await import("./grant-ask")
  const remembered = await rememberedAsk(runId, resolution.askSubject)
  if (remembered) {
    return {
      resolution: { ...resolution, askSatisfiedBy: { approvalId: remembered, remembered: true } },
      satisfied: true,
    }
  }
  if (askNow === undefined) return { resolution, satisfied: false }
  const answer = await askOperator(runId, askNow, resolution.askSubject)
  if (answer.decision === "approved") {
    const stale = options?.decideNow ? await recheckAfterWait(resolution, options.decideNow) : undefined
    if (stale) return { resolution: denied(resolution, stale), satisfied: false }
    return {
      resolution: { ...resolution, askSatisfiedBy: { approvalId: answer.approvalId, remembered: false } },
      satisfied: true,
    }
  }
  return {
    resolution: denied(resolution, answer.decision === "expired" ? "grant_ask_expired" : "grant_ask_denied"),
    satisfied: false,
    ...(answer.decision === "expired" ? { expired: answer.approvalId } : {}),
  }
}

/** Strips an unset optional field so the record stays within its closed schema. */
export function enforcedRecord(resolution: EnforcedResolution) {
  const { grantScope, reasonCode, grantSubject, source, askSatisfiedBy, askSubject: _askSubject, ...rest } = resolution
  return {
    ...rest,
    ...(grantScope !== undefined ? { grantScope } : {}),
    ...(reasonCode !== undefined ? { reasonCode } : {}),
    ...(grantSubject !== undefined ? { grantSubject } : {}),
    ...(source !== undefined ? { source } : {}),
    ...(askSatisfiedBy !== undefined ? { askSatisfiedBy } : {}),
  }
}
