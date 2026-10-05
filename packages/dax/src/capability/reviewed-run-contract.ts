import z from "zod"
import { CapabilityGrants } from "./grant"
import { ContractGrantApprovalSubjectSchema } from "@/state/events/contract-grant-approval"

const Name = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0)
const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/)

/** Operator choices only. Contracts and implementation bindings are always server-produced. */
export const GrantOperatorInputs = z
  .object({
    writeScope: z
      .object({ roots: z.array(Name), reviewed: z.boolean() })
      .strict()
      .optional(),
    acknowledgedExternal: z.array(Name).optional(),
    sourceSelections: z
      .array(z.object({ server: Name, family: z.enum(["tool", "resource", "prompt"]) }).strict())
      .optional(),
    askSubjects: z.array(Name).optional(),
    delegations: z.array(z.object({ capabilityId: Name, agents: z.array(Name) }).strict()).optional(),
  })
  .strict()
  .meta({ ref: "GrantOperatorInputs" })
export type GrantOperatorInputs = z.infer<typeof GrantOperatorInputs>

export const ReviewedGrantOptIn = GrantOperatorInputs.extend({
  mode: z.literal("reviewed_grants"),
  /** Display provenance only; creates no inherited authority or copied approvals. */
  successorOf: z
    .string()
    .regex(/^ses[a-zA-Z]*_[0-9a-zA-Z_-]+$/, "must be a bare session identifier")
    .optional(),
})
  .strict()
  .meta({ ref: "ReviewedGrantOptIn" })

/** Complete current subject pins, compared inside the mutation's review lock. */
export const GrantReviewPins = z
  .object({
    revision: z.number().int().positive(),
    approvalId: Name,
    proposalDigest: Digest,
    contractDigest: Digest,
    bindingManifestDigest: Digest,
  })
  .strict()
  .meta({ ref: "GrantReviewPins" })
export type GrantReviewPins = z.infer<typeof GrantReviewPins>

export const ReviseGrantReviewRequest = z
  .object({ expected: GrantReviewPins, inputs: GrantOperatorInputs })
  .strict()
  .meta({ ref: "ReviseGrantReviewRequest" })
export const StartGrantReviewRequest = z
  .object({ expected: GrantReviewPins })
  .strict()
  .meta({ ref: "StartGrantReviewRequest" })

export const RunGrantReview = z
  .object({
    runId: z.string(),
    contractId: z.string(),
    status: z.string(),
    revisionStatus: z.enum(["pending", "superseded", "published", "uncertain"]),
    approvalStatus: z.enum(["unrecorded", "pending", "approved", "denied", "expired", "cancelled"]),
    expected: GrantReviewPins,
    approvalSubject: ContractGrantApprovalSubjectSchema.optional(),
    grants: CapabilityGrants,
    bindings: ContractGrantApprovalSubjectSchema.shape.bindings.unwrap(),
    inputs: GrantOperatorInputs,
    excluded: z.array(z.object({ alias: z.string(), reason: z.literal("legacy_unenrolled") })),
    needsScope: z.array(z.object({ capabilityId: z.string(), alias: z.string().optional(), scopeSupport: z.string() })),
    needsTrust: z.array(z.object({ capabilityId: z.string(), alias: z.string().optional() })),
    unbindable: z.array(z.object({ capabilityId: z.string(), alias: z.string().optional() })),
    marked: z.array(
      z.object({
        capabilityId: z.string(),
        alias: z.string(),
        note: z.literal("non_native_executor_under_native_alias"),
      }),
    ),
    onDemandSources: z.array(z.object({ server: z.string(), family: z.enum(["resource", "prompt"]) })),
    publication: z.enum(["none", "intent", "complete"]),
    activated: z.boolean(),
  })
  .meta({ ref: "RunGrantReview" })
export type RunGrantReview = z.infer<typeof RunGrantReview>

export const GrantReviewSummary = GrantReviewPins.extend({ location: z.string() }).meta({ ref: "GrantReviewSummary" })
export const StartGrantReviewResponse = z
  .object({ runId: z.string(), status: z.literal("running"), claimed: z.literal(true) })
  .meta({ ref: "StartGrantReviewResponse" })
export const ReviewedRunRefusal = z
  .object({ code: z.string(), message: z.string(), runId: z.string().optional() })
  .meta({ ref: "ReviewedRunRefusal" })

/** Actual standard-validator JSON response; keep the legacy plural-errors schema separate. */
export const RunBadRequestError = z
  .object({
    data: z.unknown().optional(),
    error: z.array(z.record(z.string(), z.unknown())),
    success: z.literal(false),
  })
  .meta({ ref: "RunBadRequestError" })

/** Useful API refusal; authority errors never enter the legacy fallback catch. */
export class ReviewedRunError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 404 | 409 = 409,
    readonly runId?: string,
  ) {
    super(`Reviewed run refused: ${code}`)
    this.name = "ReviewedRunError"
  }
}
