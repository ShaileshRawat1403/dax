import z from "zod"

/**
 * What an operator approves when reviewing a run's capability grants: one
 * revision of one proposal, committed by digest. The run log carries this
 * commitment, never the proposal itself.
 */
export const ContractGrantApprovalSubjectSchema = z
  .object({
    kind: z.literal("contract_grant_set"),
    runId: z.string().min(1),
    contractId: z.string().min(1),
    revision: z.number().int().positive(),
    canonicalization: z.literal("sorted-json-v1"),
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  })
  .strict()

export type ContractGrantApprovalSubject = z.infer<typeof ContractGrantApprovalSubjectSchema>
