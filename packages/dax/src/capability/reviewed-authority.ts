import { ExecutionContractV2 } from "@/execution/execution-contract"
import { assertNoGrantReview, GrantReviewBarrierError } from "@/execution/grant-review-barrier"
import { computeCanonicalCommitment } from "@/execution/canonical-commitment"
import { getRunAuthority, projectRunStateFromEvents } from "@/state/events/run-event-store"
import { GrantReview } from "./grant-review"
import { daxExecutable, nativeBinding } from "./implementation-binding"
import { proposalDigest, subjectKey } from "./grant-proposal"
import { nativeCapabilities } from "./registry"
import { listOperatorShellCapabilities } from "@/session/operator-shell-identity"
import { listCommandShellCapabilities } from "@/session/command-shell-identity"
import { listContextAttachmentCapabilities } from "@/session/context-attachment-identity"
import { listTemplateContextCapabilities } from "@/session/template-context-identity"
import { listFixedWorkflowCapabilities } from "@/workflows/capability-identity"

/**
 * Read-only reviewed authority. Presence never downgrades to no-contract and
 * no read repairs publication, mutates storage or takes an event lock.
 * Source/unknown images cannot enforce even an all-remote reviewed contract.
 * An exact native binding must still describe this image; external-only
 * publications carry no native image binding to inherit across builds.
 */
export async function loadReviewedAuthority(runId: string, options?: { dispatch?: boolean }) {
  try {
    return await readReviewedAuthority(runId, options)
  } catch (error) {
    if (error instanceof GrantReviewBarrierError) throw error
    throw new GrantReviewBarrierError(runId, "authority_unreadable")
  }
}

/** The enforcing runtime prerequisite, usable before a creation/start effect. */
export function assertReviewedImage(runId: string) {
  const image = daxExecutable()
  if (
    image.form !== "compiled" ||
    !image.commit.trim() ||
    !image.runtime.trim() ||
    !/^sha256:[a-f0-9]{64}$/.test(image.bundle)
  ) {
    throw new GrantReviewBarrierError(runId)
  }
  return image
}

async function readReviewedAuthority(runId: string, options?: { dispatch?: boolean }) {
  try {
    await assertNoGrantReview(runId)
    return undefined
  } catch (error) {
    if (!(error instanceof GrantReviewBarrierError)) throw error
  }
  const refuse = (reason?: "binding_changed" | "binding_unavailable"): never => {
    throw new GrantReviewBarrierError(runId, reason)
  }
  const image = assertReviewedImage(runId)
  if ((await getRunAuthority(runId)) !== "event-log") return refuse()
  const state = await projectRunStateFromEvents(runId)
  const proof = state?.grantReview.published
  const activation = state?.grantReview.activated
  if (!state || !proof || !activation) return refuse()
  const published = await GrantReview.readPublished(runId)
  if (
    !published ||
    published.runId !== runId ||
    published.contract.runId !== runId ||
    published.contract.contractId !== state.contractId ||
    published.revision !== activation.revision ||
    published.contractDigest !== activation.contractDigest ||
    JSON.stringify(proof.bindings) !== JSON.stringify(activation.bindings)
  )
    return refuse()
  const record = await GrantReview.get(runId)
  const revision = record?.revisions.find((item) => item.revision === published.revision)
  if (
    !record ||
    record.schemaVersion !== 1 ||
    record.runId !== runId ||
    record.contractId !== state.contractId ||
    !revision ||
    revision.status !== "published" ||
    revision.approvalId !== published.approvalId ||
    revision.digest !== proof.proposalDigest ||
    (await proposalDigest(revision.proposal)).digest !== proof.proposalDigest ||
    (await computeCanonicalCommitment(revision.proposal.candidate)).digest !== proof.contractDigest ||
    revision.proposal.bindings.length !== proof.bindings.length ||
    revision.proposal.bindings.some(
      (binding, index) =>
        binding.subject !== proof.bindings[index]!.subject ||
        binding.attestation !== proof.bindings[index]!.attestation ||
        binding.digest !== proof.bindings[index]!.digest,
    )
  )
    return refuse()
  const contract = ExecutionContractV2.parse(published.contract)
  if (contract.capabilityGrants.length !== proof.bindings.length) return refuse()
  const natives = new Set(
    [
      ...nativeCapabilities.list(),
      ...listOperatorShellCapabilities(),
      ...listCommandShellCapabilities(),
      ...listContextAttachmentCapabilities(),
      ...listTemplateContextCapabilities(),
      ...listFixedWorkflowCapabilities().filter((item) => item.id.startsWith(`workflow.${contract.workflowClass}.`)),
    ].map((item) => item.id),
  )
  for (const [index, grant] of contract.capabilityGrants.entries()) {
    const binding = proof.bindings[index]!
    if (
      binding.subject !== subjectKey(grant.subject) ||
      binding.decision !== grant.decision ||
      JSON.stringify(binding.agents) !==
        JSON.stringify(grant.scope.kind === "delegation" ? [...grant.scope.agents].sort() : undefined)
    )
      return refuse()
    if (binding.attestation === "exact") {
      if (grant.subject.kind !== "capability" || !natives.has(grant.subject.capabilityId)) return refuse()
      const native = nativeBinding(grant.subject.capabilityId, image)
      if (!native) return refuse("binding_unavailable")
      if ((await computeCanonicalCommitment(native.facts)).digest !== binding.digest) return refuse("binding_changed")
    }
  }
  // Contract inspection survives terminal settlement; effects do not.
  if (options?.dispatch && (!state.startedAt || (state.status !== "running" && state.status !== "waiting_approval")))
    return refuse()
  return { published: { ...published, contract }, activation, state }
}

/** Reviewed initial dispatch is claimed only by the explicit reviewed start operation. */
export async function assertReviewedSessionExecutable(runId: string) {
  const reviewed = await loadReviewedAuthority(runId)
  if (reviewed && (!reviewed.state.startedAt || !["running", "waiting_approval"].includes(reviewed.state.status))) {
    throw new GrantReviewBarrierError(runId)
  }
}
