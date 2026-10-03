import z from "zod"

const Sha256Digest = z.string().regex(/^sha256:[0-9a-f]{64}$/)

/**
 * What an operator approves when reviewing a run's capability grants: one
 * revision of one proposal, committed by digest. The run log carries this
 * commitment, never the proposal itself.
 *
 * `contractDigest` and `bindings` commit, in the log itself, to the contract
 * and the implementation bindings the approval covers, so replay can check a
 * publication against them without the proposal. A request without them was
 * made before that commitment existed; it parses, and it can never publish.
 */
export const ContractGrantApprovalSubjectSchema = z
  .object({
    kind: z.literal("contract_grant_set"),
    runId: z.string().min(1),
    contractId: z.string().min(1),
    revision: z.number().int().positive(),
    canonicalization: z.literal("sorted-json-v1"),
    digest: Sha256Digest,
    contractDigest: Sha256Digest.optional(),
    bindings: z
      .array(
        z
          .object({
            subject: z.string().min(1),
            attestation: z.enum(["exact", "external"]),
            digest: Sha256Digest,
            // Absent only on a request made before decisions were committed; such a request cannot publish.
            decision: z.enum(["allow", "ask"]).optional(),
            agents: z.array(z.string().min(1)).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()

/**
 * What an operator approves when an activated reviewed run reaches an `ask`
 * grant: this grant, for this capability, under this contract and binding.
 * Remembering it ("always") covers exactly this tuple and nothing else.
 */
export const GrantAskSubjectSchema = z
  .object({
    kind: z.literal("capability_grant_ask"),
    grantSubject: z.string().min(1),
    capabilityId: z.string().min(1),
    contractDigest: Sha256Digest,
    bindingDigest: Sha256Digest,
  })
  .strict()

export type GrantAskSubject = z.infer<typeof GrantAskSubjectSchema>

/** The approval type a grant ask carries, and only it. */
export const CONTRACT_GRANT_ASK_TYPE = "capability_grant_ask"

/** The approval type a grant review request carries, and only it. */
export const CONTRACT_GRANT_APPROVAL_TYPE = "capability_grant_review"

export type ContractGrantApprovalSubject = z.infer<typeof ContractGrantApprovalSubjectSchema>
