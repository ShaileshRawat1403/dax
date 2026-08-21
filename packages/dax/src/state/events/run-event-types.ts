import { z } from "zod"
import { CheckResult } from "@/sdlc/check-types"
import { EvidenceReceipt } from "@/sdlc/evidence-receipt"

const closed = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).strict()

const CompletionProofSchema = closed({
  decision: z.enum(["pass", "fail"]),
  failedChecks: z.array(z.string()),
  verificationExecuted: z.boolean(),
  receiptIds: z.array(z.string()),
  artifactChecks: z.boolean(),
  expectedOutputChecks: z.boolean(),
  expectedOutputTypesSatisfied: z.array(z.string()),
  expectedOutputTypesMissing: z.array(z.string()),
  scopeChecks: z.boolean(),
  sensitivePathApprovalChecks: z.boolean(),
  checkedAt: z.string(),
})

// Early verification events persisted only the receipt identity. Current
// producers persist the complete v1 attestation. Both are closed historical
// contracts; partial or augmented receipts are corruption, not compatibility.
const VerificationReceiptSchema = z.union([EvidenceReceipt, closed({ receiptId: z.string() })])

/**
 * The closed canonical event vocabulary and each event's durable payload are
 * one runtime contract. This is deliberately the source of truth for both
 * storage reads and the TypeScript payload union: adding a type requires
 * declaring what its persisted evidence actually contains.
 */
const RunEventVariants = [
  z.object({
    type: z.literal("contract_compiled"),
    payload: closed({
      contractId: z.string(),
      verificationRequired: z.boolean().optional(),
      guardEnforcementMode: z.enum(["warn", "enforce"]).optional(),
    }),
  }),
  z.object({ type: z.literal("execution_queued"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("workflow_started"), payload: z.object({}).strict() }),
  z.object({
    type: z.literal("approval_requested"),
    payload: closed({
      approvalId: z.string(),
      approvalType: z.string(),
      risk: z.string(),
      title: z.string().optional(),
      reason: z.string().optional(),
      expectedConsequence: z.string().optional(),
      stepId: z.string().nullable().optional(),
    }),
  }),
  z.object({
    type: z.literal("approval_resolved"),
    payload: closed({
      approvalId: z.string(),
      decision: z.enum(["approved", "rejected"]),
      actor: z.string().nullable().optional(),
      comment: z.string().optional(),
      resolvedAt: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("step_added"),
    payload: closed({
      stepId: z.string(),
      title: z.string(),
      stepType: z.enum(["proposed", "executed", "approved", "rejected"]),
    }),
  }),
  z.object({ type: z.literal("step_started"), payload: closed({ stepId: z.string() }) }),
  z.object({
    type: z.literal("step_completed"),
    payload: closed({ stepId: z.string(), outputs: z.array(z.string()) }),
  }),
  z.object({
    type: z.literal("step_failed"),
    payload: closed({ stepId: z.string(), error: closed({ code: z.string(), message: z.string() }) }),
  }),
  z.object({
    type: z.literal("artifact_created"),
    payload: closed({ artifactId: z.string(), artifactType: z.string() }),
  }),
  z.object({
    type: z.literal("draft_created"),
    payload: closed({ draftId: z.string(), type: z.string(), content: z.string(), targetPath: z.string().optional() }),
  }),
  z.object({
    type: z.literal("trust_updated"),
    payload: closed({
      trust: z
        .strictObject({
          posture: z.enum(["low", "guarded", "moderate", "strong"]),
          score: z.number().nullable(),
          blocked: z.boolean(),
          reasons: z.array(z.string()),
        })
        .nullable(),
    }),
  }),
  z.object({
    type: z.literal("run_failed"),
    payload: closed({ error: closed({ code: z.string(), message: z.string(), retryable: z.boolean() }) }),
  }),
  z.object({
    type: z.literal("run_completed"),
    payload: closed({ completionProof: CompletionProofSchema.optional() }),
  }),
  z.object({
    type: z.literal("workflow_completed"),
    payload: closed({ completionProof: CompletionProofSchema.optional() }),
  }),
  z.object({ type: z.literal("approval_denied"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("approval_required"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("approval_resumed"), payload: z.object({}).strict() }),
  z.object({
    type: z.literal("provider_pressure_updated"),
    payload: closed({
      lane: z.string().optional(),
      throttles: z.number(),
      inFlight: z.number(),
      queueLength: z.number(),
    }),
  }),
  z.object({
    type: z.literal("contract_refined"),
    payload: closed({
      writeScope: z.array(z.string()),
      forbiddenPaths: z.array(z.string()),
      verification: z.array(z.string()),
      provenance: z.record(z.string(), z.string()),
    }),
  }),
  z.object({
    type: z.literal("worker_sandbox_recorded"),
    payload: closed({
      provider: z.string(),
      providerId: z.string().optional(),
      filesystem: z.literal("checkout-write-only"),
      network: z.enum(["full", "localhost-only", "none"]),
      reapedDescendants: z.boolean().optional(),
      egress: z.enum(["filtered", "unconfined"]).optional(),
      egressEnforcement: z.enum(["cooperative-proxy", "none"]).optional(),
      egressAllowHosts: z.array(z.string()).optional(),
    }),
  }),
  z.object({
    type: z.literal("worker_egress_denied"),
    payload: closed({ providerId: z.string(), hosts: z.array(z.string()) }),
  }),
  z.object({
    type: z.literal("mutation_recorded"),
    payload: closed({ receiptIds: z.array(z.string()), changedPaths: z.array(z.string()) }),
  }),
  z.object({ type: z.literal("execution_started"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("plan_quality_gate"), payload: closed({ reason: z.string().optional() }) }),
  z.object({ type: z.literal("signoff_requested"), payload: z.object({}).strict() }),
  z.object({ type: z.literal("signoff_received"), payload: closed({ decision: z.string().optional() }) }),
  z.object({
    type: z.literal("workflow_signed_off"),
    payload: closed({ completionProof: CompletionProofSchema.optional() }),
  }),
  z.object({
    type: z.literal("workflow_rejected"),
    payload: closed({ completionProof: CompletionProofSchema.optional() }),
  }),
  z.object({
    type: z.literal("workflow_expired"),
    payload: closed({ completionProof: CompletionProofSchema.optional() }),
  }),
  z.object({
    type: z.literal("workflow_failed"),
    payload: closed({ error: closed({ code: z.string(), message: z.string() }).optional() }),
  }),
  z.object({
    type: z.literal("verification_recorded"),
    payload: closed({
      status: z.enum(["passed", "failed"]),
      receipts: z.array(VerificationReceiptSchema),
      checks: z.array(CheckResult.strict()),
    }),
  }),
] as const

export const RunEventPayloadSchema = z.discriminatedUnion("type", RunEventVariants)
export type RunEventPayload = z.infer<typeof RunEventPayloadSchema>
export type RunEventType = RunEventPayload["type"]
export const RUN_EVENT_TYPES = RunEventVariants.map((variant) => variant.shape.type.value) as RunEventType[]

export function isRunEventType(type: string): type is RunEventType {
  return RUN_EVENT_TYPES.includes(type as RunEventType)
}

export type RunEventEnvelope = {
  eventId: string
  runId: string
  seq: number
  type: RunEventType
  payload: unknown
  occurredAt: string
  schemaVersion: "v1"
  causationId?: string
  correlationId?: string
  commandId?: string
}

/**
 * At the storage boundary the envelope and the event payload are parsed as a
 * single discriminated object. A known event with the wrong payload therefore
 * fails just as closedly as an unknown event type.
 */
export const RunEventEnvelopeSchema = z
  .object({
    eventId: z.string().min(1),
    runId: z.string().min(1),
    seq: z.number().int().nonnegative(),
    occurredAt: z.string().min(1),
    schemaVersion: z.literal("v1"),
    causationId: z.string().optional(),
    correlationId: z.string().optional(),
    commandId: z.string().optional(),
    type: z.string(),
    payload: z.unknown(),
  })
  .strict()
  .and(RunEventPayloadSchema)

let eventCounter = 0

export function createEvent(runId: string, seq: number, type: RunEventType, payload: unknown): RunEventEnvelope {
  return {
    eventId: `evt_${Date.now()}_${(eventCounter++).toString(36).slice(2, 11)}`,
    runId,
    seq,
    type,
    payload,
    occurredAt: new Date().toISOString(),
    schemaVersion: "v1",
  }
}

/**
 * Validate a log read from storage, naming the position that failed so the raw
 * artifact can be found. Refuses rather than repairs: a partially readable
 * audit record is worse than an unreadable one, because it looks complete.
 */
export function parseRunEventLog(runId: string, events: unknown[]): RunEventEnvelope[] {
  return events.map((event, index) => {
    const result = RunEventEnvelopeSchema.safeParse(event)
    if (!result.success) {
      throw new Error(
        `Run ${runId} has a malformed event at position ${index}: ${result.error.issues
          .map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`)
          .join("; ")}. Refusing to project an unreadable log.`,
      )
    }
    return result.data as RunEventEnvelope
  })
}
