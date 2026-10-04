import { isDeepStrictEqual } from "node:util"
import { ExecutionContractV2 } from "@/execution/execution-contract"
import { grantReviewPath } from "@/execution/grant-review-barrier"
import { Instance } from "@/project/instance"
import {
  appendEventOnly,
  recordGrantReviewActivated,
  recordGrantReviewPublished,
  resolveApprovalEvent,
} from "@/state/events/event-transitions"
import { computeCanonicalCommitment } from "@/execution/canonical-commitment"
import {
  CONTRACT_GRANT_APPROVAL_TYPE,
  ContractGrantApprovalSubjectSchema,
  type ContractGrantApprovalSubject,
} from "@/state/events/contract-grant-approval"
import { getRunAuthority, projectRunStateFromEvents, readRunEvents } from "@/state/events/run-event-store"
import { Storage } from "@/storage/storage"
import { acquireRunLock } from "@/util/fs-lock"
import { checkBinding, proposalDigest, subjectKey, type GrantProposal } from "./grant-proposal"
import { captureReviewSnapshot } from "./grant-review-snapshot"

/**
 * Stage 3 review of a run's capability grants.
 *
 * The review is stored apart from executable contracts. Its presence is the
 * strict v1 writer barrier (`execution/grant-review-barrier.ts`). Reviewed
 * execution separately requires completed publication, canonical activation,
 * and the read-only compiled-image/proof gate; approval alone cannot execute.
 *
 * Every mutation holds one lock per run, so a revision and a publication
 * never interleave. The approval requests themselves live in the run log.
 */

export type GrantReviewRevision = {
  revision: number
  approvalId: string
  digest: string
  proposal: GrantProposal
  /**
   * Pending until superseded or published. An interrupted publication leaves it
   * uncertain, and only a new revision, reviewed afresh, replaces it.
   */
  status: "pending" | "superseded" | "published" | "uncertain"
}

export type GrantReviewRecord = {
  schemaVersion: 1
  runId: string
  contractId: string
  revisions: GrantReviewRevision[]
  /** Written as an intent before the artifact and completed after it. */
  publication?: { revision: number; digest: string; state: "intent" | "complete" }
  /** Interrupted publications, kept as found when a new revision replaced them. */
  abandoned?: { revision: number; digest: string; approvalId: string }[]
}

export type PublishedGrantReview = {
  runId: string
  revision: number
  approvalId: string
  digest: string
  /** The canonical commitment to `contract`, as the journal's publication proof records it. */
  contractDigest: string
  contract: ExecutionContractV2
}

export type GrantReviewRefusal =
  | "review_missing"
  | "review_exists"
  | "review_published"
  | "publication_uncertain"
  | "subject_invalid"
  | "subject_mismatch"
  | "revision_not_current"
  | "approval_not_current"
  | "approval_request_missing"
  | "approval_not_approved"
  | "approval_actor_missing"
  | "digest_mismatch"
  | "candidate_invalid"
  | "binding_changed"
  | "not_published"
  | "already_activated"
  | "activation_unsupported"
  | "run_not_canonical"

export class GrantReviewError extends Error {
  constructor(
    readonly code: GrantReviewRefusal,
    readonly runId: string,
  ) {
    super(`Capability grant review for run ${runId} refused: ${code}`)
    this.name = "GrantReviewError"
  }
}

function publishedPath(runId: string): string[] {
  return ["grant_review_published", Instance.project.id, runId]
}

async function readOptional<T>(key: string[]): Promise<T | undefined> {
  try {
    return await Storage.read<T>(key)
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) return undefined
    throw error
  }
}

async function withReviewLock<T>(runId: string, body: () => Promise<T>): Promise<T> {
  // Distinct from the run's event lock, which the approval appends take inside.
  const lock = await acquireRunLock(`grant-review-${runId}`)
  try {
    return await body()
  } finally {
    await lock.dispose()
  }
}

function approvalIdFor(runId: string, revision: number) {
  return `apr_grant_${runId}_r${revision}`
}

/** Every binding with the decision of the grant it belongs to, in the contract's grant order. */
function proofBindings(proposal: GrantProposal) {
  return proposal.bindings.map(({ subject, attestation, digest }, index) => {
    const grant = proposal.candidate.capabilityGrants[index]!
    return {
      subject,
      attestation,
      digest,
      decision: grant.decision,
      // A delegation grant's agents, so replay can check which agent a child was started as.
      ...(grant.scope.kind === "delegation" ? { agents: [...grant.scope.agents].sort() } : {}),
    }
  })
}

/** What the journal's publication proof must restate: the contract digest and every binding, in order. */
async function commitments(revision: GrantReviewRevision) {
  return {
    contractDigest: (await computeCanonicalCommitment(ExecutionContractV2.parse(revision.proposal.candidate))).digest,
    bindings: proofBindings(revision.proposal),
  }
}

async function requestApproval(record: GrantReviewRecord, revision: GrantReviewRevision) {
  const subject: ContractGrantApprovalSubject = {
    kind: "contract_grant_set",
    runId: record.runId,
    contractId: record.contractId,
    revision: revision.revision,
    canonicalization: "sorted-json-v1",
    digest: revision.digest,
    ...(await commitments(revision)),
  }
  await appendEventOnly(
    record.runId,
    "approval_requested",
    {
      approvalId: revision.approvalId,
      approvalType: CONTRACT_GRANT_APPROVAL_TYPE,
      risk: "high",
      title: `Review capability grants, revision ${revision.revision}`,
      reason: "This run executes only under the exact capability grants an operator approves.",
      expectedConsequence:
        "Approval publishes this exact grant set as the run's reviewed contract. It stays non-executable until grant enforcement exists.",
      source: "system",
      contractGrantSubject: subject,
    },
    `cmd_grant_review_request_${revision.approvalId}`,
    undefined,
    { rejectDuplicateCommand: true },
  )
}

async function newRevision(record: GrantReviewRecord, proposal: GrantProposal): Promise<GrantReviewRevision> {
  if (proposal.runId !== record.runId || proposal.candidate.runId !== record.runId) {
    throw new GrantReviewError("subject_mismatch", record.runId)
  }
  if (proposal.candidate.contractId !== record.contractId) throw new GrantReviewError("subject_mismatch", record.runId)
  const revision = (record.revisions.at(-1)?.revision ?? 0) + 1
  const { digest } = await proposalDigest(proposal)
  return { revision, approvalId: approvalIdFor(record.runId, revision), digest, proposal, status: "pending" }
}

/**
 * Places a run under review before anything could execute in it. The stored
 * review is the barrier; it exists from here on, with no revision yet.
 */
async function reserve(runId: string, contractId: string): Promise<void> {
  return withReviewLock(runId, async () => {
    if (await readOptional(grantReviewPath(runId))) throw new GrantReviewError("review_exists", runId)
    const record: GrantReviewRecord = { schemaVersion: 1, runId, contractId, revisions: [] }
    await Storage.write(grantReviewPath(runId), record)
  })
}

/** Records the first revision of a reserved review and requests its approval. */
async function begin(runId: string, proposal: GrantProposal): Promise<GrantReviewRevision> {
  return withReviewLock(runId, async () => {
    const record = await readOptional<GrantReviewRecord>(grantReviewPath(runId))
    if (!record) throw new GrantReviewError("review_missing", runId)
    if (record.revisions.length > 0) throw new GrantReviewError("review_exists", runId)
    if ((await getRunAuthority(runId)) !== "event-log") throw new GrantReviewError("run_not_canonical", runId)
    const revision = await newRevision(record, proposal)
    record.revisions.push(revision)
    await Storage.write(grantReviewPath(runId), record)
    await requestApproval(record, revision)
    return revision
  })
}

/**
 * Replaces the pending revision with a new one. The new request is appended
 * before the old one is closed as expired, so the run never appears to have
 * nothing awaiting review. A published review is final.
 *
 * This is also the only recovery from an interrupted publication. The failed
 * intent is kept in `abandoned`, its revision stays uncertain and can never be
 * published, any artifact it may have written is removed so it can never
 * become visible, and the new revision needs its own approval.
 */
async function revise(runId: string, proposal: GrantProposal): Promise<GrantReviewRevision> {
  return withReviewLock(runId, async () => {
    const record = await readOptional<GrantReviewRecord>(grantReviewPath(runId))
    if (!record) throw new GrantReviewError("review_missing", runId)
    if (record.publication?.state === "intent" && (await rollForward(runId, record))) {
      throw new GrantReviewError("review_published", runId)
    }
    if (record.publication?.state === "complete") throw new GrantReviewError("review_published", runId)
    if (record.publication) {
      const failed = record.publication
      const interrupted = record.revisions.find((item) => item.revision === failed.revision)
      if (interrupted) interrupted.status = "uncertain"
      record.abandoned = [
        ...(record.abandoned ?? []),
        { revision: failed.revision, digest: failed.digest, approvalId: interrupted?.approvalId ?? "" },
      ]
      // Removed before the intent is cleared: an interruption here leaves the
      // intent in place, so this recovery simply runs again.
      await Storage.remove(publishedPath(runId))
      delete record.publication
      await Storage.write(grantReviewPath(runId), record)
    }
    const previous = record.revisions.filter((revision) => revision.status === "pending")
    const revision = await newRevision(record, proposal)
    for (const item of previous) item.status = "superseded"
    record.revisions.push(revision)
    await Storage.write(grantReviewPath(runId), record)
    await requestApproval(record, revision)
    const state = await projectRunStateFromEvents(runId)
    for (const item of previous) {
      const approval = state?.approvals.find((candidate) => candidate.approvalId === item.approvalId)
      if (approval?.status === "pending") await resolveApprovalEvent(runId, item.approvalId, "expired", null)
    }
    return revision
  })
}

/**
 * Publishes the current revision after an operator approved it. The operator's
 * approval names the subject they reviewed; it must be the current revision's
 * subject exactly, the run log must hold that request with that subject, and
 * the request must be approved. Anything else publishes nothing.
 *
 * Every grant's implementation binding is checked against this instance as
 * it is now. A changed or unavailable binding means the approval no longer
 * covers what would run, and only a new revision can proceed.
 *
 * An intent is written before the artifact and completed after it. An intent
 * found without completion was interrupted: it is never treated as published,
 * the revision becomes uncertain, and only a new revision can proceed.
 */
async function publish(
  runId: string,
  approval: { approvalId: string; subject: unknown },
  /** Test-only interruption points. Publication always captures its own snapshot. */
  options?: {
    afterIntent?: () => Promise<void>
    afterArtifact?: () => Promise<void>
    afterProof?: () => Promise<void>
  },
): Promise<{ status: "published" | "already_published"; published: PublishedGrantReview }> {
  return withReviewLock(runId, async () => {
    const record = await readOptional<GrantReviewRecord>(grantReviewPath(runId))
    if (!record) throw new GrantReviewError("review_missing", runId)
    const parsed = ContractGrantApprovalSubjectSchema.safeParse(approval.subject)
    if (!parsed.success) throw new GrantReviewError("subject_invalid", runId)
    const subject = parsed.data

    if (record.publication?.state === "intent") await rollForward(runId, record)
    if (record.publication) {
      if (record.publication.state === "intent") {
        const interrupted = record.revisions.find((item) => item.revision === record.publication!.revision)
        if (interrupted && interrupted.status !== "uncertain") {
          interrupted.status = "uncertain"
          await Storage.write(grantReviewPath(runId), record)
        }
        throw new GrantReviewError("publication_uncertain", runId)
      }
      const published = await readOptional<PublishedGrantReview>(publishedPath(runId))
      if (
        published &&
        record.publication.revision === subject.revision &&
        record.publication.digest === subject.digest &&
        published.approvalId === approval.approvalId
      ) {
        return { status: "already_published" as const, published }
      }
      throw new GrantReviewError("review_published", runId)
    }

    if (subject.runId !== runId || subject.contractId !== record.contractId) {
      throw new GrantReviewError("subject_mismatch", runId)
    }
    const current = record.revisions.at(-1)
    if (!current || current.revision !== subject.revision || current.status !== "pending") {
      throw new GrantReviewError("revision_not_current", runId)
    }
    if (current.approvalId !== approval.approvalId) throw new GrantReviewError("approval_not_current", runId)
    const recomputed = await proposalDigest(current.proposal)
    if (recomputed.digest !== current.digest || current.digest !== subject.digest) {
      throw new GrantReviewError("digest_mismatch", runId)
    }

    // The run log is the authority for what was requested and what was decided,
    // read as the project-fact boundary reads it: the exact request, then an
    // approved resolution of it that names who approved.
    const events = await readRunEvents(runId)
    const requested = events.find(
      (event) =>
        event.type === "approval_requested" &&
        (event.payload as { approvalId?: unknown }).approvalId === current.approvalId,
    )
    const request = requested?.payload as { approvalType?: unknown; contractGrantSubject?: unknown } | undefined
    const logged = ContractGrantApprovalSubjectSchema.safeParse(request?.contractGrantSubject)
    if (!requested || request?.approvalType !== CONTRACT_GRANT_APPROVAL_TYPE || !logged.success) {
      throw new GrantReviewError("approval_request_missing", runId)
    }
    if (!isDeepStrictEqual(logged.data, subject)) throw new GrantReviewError("subject_mismatch", runId)
    const resolution = events.find(
      (event) =>
        event.type === "approval_resolved" &&
        (event.payload as { approvalId?: unknown }).approvalId === current.approvalId,
    )
    const decided = resolution?.payload as { decision?: unknown; actor?: unknown } | undefined
    if (!resolution || resolution.seq <= requested.seq || decided?.decision !== "approved") {
      throw new GrantReviewError("approval_not_approved", runId)
    }
    // A recorded name, not authentication: it keeps the existing approval
    // boundary, which refuses an approval nobody put their name to.
    if (typeof decided.actor !== "string" || !decided.actor.trim()) {
      throw new GrantReviewError("approval_actor_missing", runId)
    }

    const candidate = ExecutionContractV2.safeParse(current.proposal.candidate)
    if (!candidate.success || candidate.data.runId !== runId || candidate.data.contractId !== record.contractId) {
      throw new GrantReviewError("candidate_invalid", runId)
    }

    const now = await captureReviewSnapshot(candidate.data)
    const grants = current.proposal.candidate.capabilityGrants
    if (grants.length !== current.proposal.bindings.length) throw new GrantReviewError("binding_changed", runId)
    for (const [index, grant] of grants.entries()) {
      if ((await checkBinding(current.proposal.bindings[index]!, grant.subject, now)) !== "unchanged") {
        throw new GrantReviewError("binding_changed", runId)
      }
    }

    record.publication = { revision: current.revision, digest: current.digest, state: "intent" }
    await Storage.write(grantReviewPath(runId), record)
    await options?.afterIntent?.()
    const published: PublishedGrantReview = {
      runId,
      revision: current.revision,
      approvalId: current.approvalId,
      digest: current.digest,
      contractDigest: (await computeCanonicalCommitment(candidate.data)).digest,
      contract: candidate.data,
    }
    await Storage.write(publishedPath(runId), published)
    await options?.afterArtifact?.()
    // The journal's proof, appended last: until it exists the publication is
    // only an intent, and once it exists the publication is settled whatever
    // happens to the completion below.
    await recordGrantReviewPublished(runId, {
      revision: current.revision,
      approvalId: current.approvalId,
      approvedBy: decided.actor,
      proposalDigest: current.digest,
      contractId: record.contractId,
      contractDigest: published.contractDigest,
      bindings: proofBindings(current.proposal),
    })
    await options?.afterProof?.()
    current.status = "published"
    record.publication = { ...record.publication, state: "complete" }
    await Storage.write(grantReviewPath(runId), record)
    return { status: "published" as const, published }
  })
}

async function get(runId: string): Promise<GrantReviewRecord | undefined> {
  return readOptional<GrantReviewRecord>(grantReviewPath(runId))
}

/**
 * The published reviewed contract, for inspection only. Nothing may treat it
 * as authority before stage 4; the guardian never reads it.
 */
async function readPublished(runId: string): Promise<PublishedGrantReview | undefined> {
  const record = await get(runId)
  if (record?.publication?.state !== "complete") return undefined
  const published = await readOptional<PublishedGrantReview>(publishedPath(runId))
  // Only the artifact the completed publication names, and only as the
  // journal's proof records it.
  if (published?.revision !== record.publication.revision || published.digest !== record.publication.digest) {
    return undefined
  }
  const proof = (await projectRunStateFromEvents(runId))?.grantReview.published
  if (!proof || !(await artifactMatchesProof(published, proof))) return undefined
  return published
}

type PublicationProof = NonNullable<
  NonNullable<Awaited<ReturnType<typeof projectRunStateFromEvents>>>["grantReview"]["published"]
>

async function artifactMatchesProof(published: PublishedGrantReview, proof: PublicationProof) {
  return (
    proof.revision === published.revision &&
    proof.approvalId === published.approvalId &&
    proof.proposalDigest === published.digest &&
    proof.contractDigest === published.contractDigest &&
    (await computeCanonicalCommitment(published.contract)).digest === published.contractDigest
  )
}

/**
 * Settles an intent the journal already proves: the publication happened, and
 * only its completion marker was lost. Rewrites the artifact from the stored
 * revision when it is missing, and only if it reproduces the proven digests.
 * Returns false, changing nothing, when the journal holds no proof for it.
 */
async function rollForward(runId: string, record: GrantReviewRecord): Promise<boolean> {
  const intent = record.publication
  if (intent?.state !== "intent") return false
  const proof = (await projectRunStateFromEvents(runId))?.grantReview.published
  if (!proof || proof.revision !== intent.revision || proof.proposalDigest !== intent.digest) return false
  const revision = record.revisions.find((item) => item.revision === intent.revision)
  if (!revision) return false
  let published = await readOptional<PublishedGrantReview>(publishedPath(runId))
  if (!published || !(await artifactMatchesProof(published, proof))) {
    const candidate = ExecutionContractV2.parse(revision.proposal.candidate)
    published = {
      runId,
      revision: revision.revision,
      approvalId: revision.approvalId,
      digest: revision.digest,
      contractDigest: (await computeCanonicalCommitment(candidate)).digest,
      contract: candidate,
    }
    if (!(await artifactMatchesProof(published, proof))) return false
    await Storage.write(publishedPath(runId), published)
  }
  revision.status = "published"
  record.publication = { ...intent, state: "complete" }
  await Storage.write(grantReviewPath(runId), record)
  return true
}

/**
 * What a reviewed run needs that no grant can provide today. Refused before
 * activation so a run never starts work it cannot complete.
 */
function unsupportedRequirement(contract: ExecutionContractV2): string | undefined {
  if (contract.workflowClass === "worker_run") return "worker"
  if (contract.runtimePolicy?.postconditions?.verificationRequired === true) return "verification"
  return undefined
}

/**
 * Verifies a published revision for execution and records that in the journal.
 *
 * Refused before any effect when the run needs a path no grant can cover
 * (a worker, or required verification), when the journal holds no matching
 * publication proof, or when any binding is changed or unavailable in a fresh
 * capture. The bindings recorded are the published ones, each found unchanged.
 * Activation lifts nothing: the stage 3 barrier still holds the run until the
 * guardian is changed to honour activation, which is stage 4d.
 */
async function activate(runId: string): Promise<{ revision: number; contractDigest: string }> {
  return withReviewLock(runId, async () => {
    const record = await readOptional<GrantReviewRecord>(grantReviewPath(runId))
    if (!record) throw new GrantReviewError("review_missing", runId)
    if (record.publication?.state === "intent") await rollForward(runId, record)
    const published = await readPublished(runId)
    if (!published) throw new GrantReviewError("not_published", runId)
    const state = await projectRunStateFromEvents(runId)
    if (state?.grantReview.activated) throw new GrantReviewError("already_activated", runId)
    const proof = state?.grantReview.published
    if (!proof) throw new GrantReviewError("not_published", runId)
    if (unsupportedRequirement(published.contract)) throw new GrantReviewError("activation_unsupported", runId)

    const revision = record.revisions.find((item) => item.revision === published.revision)
    if (!revision) throw new GrantReviewError("not_published", runId)
    // What is verified is the journal's published bindings, nothing private:
    // every grant of the published contract has exactly one, in order, and the
    // stored revision must agree with them before it is trusted for anything.
    const grants = published.contract.capabilityGrants
    if (
      grants.length !== proof.bindings.length ||
      grants.some(
        (grant, index) =>
          subjectKey(grant.subject) !== proof.bindings[index]!.subject ||
          grant.decision !== proof.bindings[index]!.decision ||
          JSON.stringify(grant.scope.kind === "delegation" ? [...grant.scope.agents].sort() : undefined) !==
            JSON.stringify(proof.bindings[index]!.agents),
      )
    ) {
      throw new GrantReviewError("binding_changed", runId)
    }
    const stored = revision.proposal.bindings
    if (
      stored.length !== proof.bindings.length ||
      stored.some(
        (item, index) =>
          item.subject !== proof.bindings[index]!.subject ||
          item.attestation !== proof.bindings[index]!.attestation ||
          item.digest !== proof.bindings[index]!.digest,
      )
    ) {
      throw new GrantReviewError("binding_changed", runId)
    }
    const now = await captureReviewSnapshot(published.contract)
    for (const [index, grant] of grants.entries()) {
      const proven = proof.bindings[index]!
      const binding = {
        subject: proven.subject,
        attestation: proven.attestation,
        canonicalization: "sorted-json-v1" as const,
        digest: proven.digest,
      }
      if ((await checkBinding(binding, grant.subject, now)) !== "unchanged") {
        throw new GrantReviewError("binding_changed", runId)
      }
    }
    await recordGrantReviewActivated(runId, {
      revision: proof.revision,
      contractDigest: proof.contractDigest,
      bindings: proof.bindings,
    })
    return { revision: proof.revision, contractDigest: proof.contractDigest }
  })
}

/**
 * The authority an activated reviewed run dispatches under: its published
 * contract and the journal's activation of exactly that contract. Undefined
 * only for positively absent review; unreadable or non-executable review throws.
 */
async function dispatchAuthority(runId: string) {
  const { loadReviewedAuthority } = await import("./reviewed-authority")
  return loadReviewedAuthority(runId, { dispatch: true })
}

export const GrantReview = { reserve, begin, revise, publish, get, readPublished, activate, dispatchAuthority }
