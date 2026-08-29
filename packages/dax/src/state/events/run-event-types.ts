import { z } from "zod"
import { CheckResult } from "@/sdlc/check-types"
import { EvidenceReceipt } from "@/sdlc/evidence-receipt"
import { MutationReceiptSchema } from "@/sdlc/mutation-receipt"
import { ApprovalContextSchema, ApprovalSourceSchema } from "@/approval/approval-types"

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

// The first mutation producer persisted only references and paths. Keep that
// legitimate historical shape readable. Native execution persists the full
// diff-committed receipt and the invocation window in which DAX observed it.
const MutationRecordedPayloadSchema = z.union([
  closed({ receiptIds: z.array(z.string()), changedPaths: z.array(z.string()) }),
  closed({
    basis: z.literal("native_snapshot_diff_v1"),
    receipt: MutationReceiptSchema,
    observationWindowInvocationIds: z.array(z.string().min(1)).min(1),
  }).superRefine((payload, ctx) => {
    if (payload.receipt.changedPaths.length === 0) {
      ctx.addIssue({ code: "custom", path: ["receipt", "changedPaths"], message: "must record an observed change" })
    }
    if (new Set(payload.observationWindowInvocationIds).size !== payload.observationWindowInvocationIds.length) {
      ctx.addIssue({
        code: "custom",
        path: ["observationWindowInvocationIds"],
        message: "must not contain duplicates",
      })
    }
  }),
])

const Sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)

const CanonicalCommitmentSchema = {
  canonicalization: z.literal("sorted-json-v1"),
  digest: Sha256DigestSchema,
  redactedPreview: z.string().min(1).max(8_192),
  truncated: z.boolean(),
}

/**
 * A commitment to validated tool input without making the append-only run log
 * a raw-input store. `sorted-json-v1` recursively sorts object keys, omits
 * undefined object members, preserves array order, and hashes the UTF-8 JSON.
 * The digest is computed from the unredacted validated input; only the bounded
 * preview is redacted, and `truncated` describes that preview.
 */
export const CanonicalInvocationInputSchema = closed({
  basis: z.literal("validated_tool_input"),
  ...CanonicalCommitmentSchema,
})

/**
 * A commitment to the validated DAX transport result before model-facing
 * truncation. Tool-domain validation necessarily precedes this boundary.
 */
export const CanonicalToolResultSchema = closed({
  basis: z.literal("validated_dax_result_pre_truncation"),
  ...CanonicalCommitmentSchema,
})

export const NativeExecutorSchema = closed({
  kind: z.enum(["builtin", "plugin", "mcp"]),
  id: z.string().min(1),
})

const ToolInvocationRecordedPayloadSchema = closed({
  invocationId: z.string().min(1),
  toolId: z.string().min(1),
  input: CanonicalInvocationInputSchema,
  contractId: z.string().min(1),
  executor: NativeExecutorSchema,
  originTurnId: z.string().min(1).optional(),
  workflowStepId: z.string().min(1).optional(),
  parentInvocationId: z.string().min(1).optional(),
  ordinal: z.number().int().nonnegative().optional(),
  retryOfInvocationId: z.string().min(1).optional(),
})

const PolicyDispositionSchema = z.enum(["allowed", "denied", "approval_required", "not_evaluated"])

const AuthorizationRecordedPayloadSchema = closed({
  invocationId: z.string().min(1),
  finalDisposition: z.enum(["allowed", "denied"]),
  contractDisposition: z.enum(["allowed", "denied"]),
  runtimeGuardDisposition: PolicyDispositionSchema,
  permissionDisposition: PolicyDispositionSchema,
  approvalIds: z.array(z.string().min(1)),
  reasonCodes: z.array(z.string().min(1)),
}).superRefine((authorization, ctx) => {
  const policyDispositions = [authorization.runtimeGuardDisposition, authorization.permissionDisposition]
  const approvalRequired = policyDispositions.includes("approval_required")
  const directDenial = authorization.contractDisposition === "denied" || policyDispositions.includes("denied")

  if (new Set(authorization.approvalIds).size !== authorization.approvalIds.length) {
    ctx.addIssue({ code: "custom", path: ["approvalIds"], message: "must not contain duplicates" })
  }
  if (new Set(authorization.reasonCodes).size !== authorization.reasonCodes.length) {
    ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "must not contain duplicates" })
  }
  if (approvalRequired !== authorization.approvalIds.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["approvalIds"],
      message: "must identify resolved approvals exactly when a policy disposition required approval",
    })
  }

  if (authorization.finalDisposition === "allowed") {
    if (
      authorization.contractDisposition !== "allowed" ||
      policyDispositions.some((disposition) => disposition === "denied" || disposition === "not_evaluated")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["finalDisposition"],
        message: "allowed requires every policy component to have allowed or resolved approval-required disposition",
      })
    }
    return
  }

  if (!directDenial && !approvalRequired) {
    ctx.addIssue({
      code: "custom",
      path: ["finalDisposition"],
      message: "denied requires a denied policy component or a rejected required approval",
    })
  }
  if (authorization.reasonCodes.length === 0) {
    ctx.addIssue({ code: "custom", path: ["reasonCodes"], message: "denied authorization requires a stable reason" })
  }
})

const ExecutionFailureSchema = closed({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
})

const ExecutionCancellationSchema = closed({
  code: z.string().min(1),
  message: z.string(),
})

const ToolResultRecordedPayloadSchema = z.discriminatedUnion("status", [
  closed({
    invocationId: z.string().min(1),
    status: z.literal("completed"),
    result: CanonicalToolResultSchema,
  }),
  closed({
    invocationId: z.string().min(1),
    status: z.literal("failed"),
    failure: ExecutionFailureSchema,
  }),
  closed({
    invocationId: z.string().min(1),
    status: z.literal("cancelled"),
    cancellation: ExecutionCancellationSchema,
  }),
])

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
  z.object({ type: z.literal("tool_invocation_recorded"), payload: ToolInvocationRecordedPayloadSchema }),
  z.object({ type: z.literal("authorization_recorded"), payload: AuthorizationRecordedPayloadSchema }),
  z.object({ type: z.literal("tool_result_recorded"), payload: ToolResultRecordedPayloadSchema }),
  z.object({
    type: z.literal("approval_requested"),
    payload: closed({
      approvalId: z.string().min(1),
      approvalType: z.string().min(1),
      risk: z.string().min(1),
      title: z.string().optional(),
      reason: z.string().optional(),
      expectedConsequence: z.string().optional(),
      stepId: z.string().nullable().optional(),
      context: ApprovalContextSchema.strict().optional(),
      source: ApprovalSourceSchema.optional(),
    }),
  }),
  z.object({
    type: z.literal("approval_resolved"),
    payload: closed({
      approvalId: z.string().min(1),
      decision: z.enum(["approved", "rejected", "expired", "cancelled"]),
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
    payload: MutationRecordedPayloadSchema,
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
  .superRefine((event, ctx) => {
    if (event.type === "authorization_recorded" || event.type === "tool_result_recorded") {
      if (event.correlationId !== event.payload.invocationId) {
        ctx.addIssue({
          code: "custom",
          path: ["correlationId"],
          message: `must equal payload.invocationId for ${event.type}`,
        })
      }
    }
    if (event.type === "tool_result_recorded" && !event.causationId) {
      ctx.addIssue({
        code: "custom",
        path: ["causationId"],
        message: "must reference the allowed authorization event",
      })
    }
  })

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
