import { z } from "zod"
import type { CheckResult } from "@/sdlc/check-types"

/**
 * The closed run event vocabulary, in one place. RunEventType is derived from
 * this array so the type and the runtime guard cannot drift.
 */
export const RUN_EVENT_TYPES = [
  "contract_compiled",
  "execution_queued",
  "workflow_started",
  "approval_requested",
  "approval_resolved",
  "step_added",
  "step_started",
  "step_completed",
  "step_failed",
  "artifact_created",
  "draft_created",
  "trust_updated",
  "run_failed",
  "run_completed",
  "workflow_completed",
  "approval_denied",
  "approval_required",
  "approval_resumed",
  "provider_pressure_updated",
  "contract_refined",
  "worker_sandbox_recorded",
  "worker_egress_denied",
  "mutation_recorded",
  "execution_started",
  "plan_quality_gate",
  "signoff_requested",
  "signoff_received",
  "workflow_signed_off",
  "workflow_rejected",
  "workflow_expired",
  "workflow_failed",
  "verification_recorded",
] as const

export type RunEventType = (typeof RUN_EVENT_TYPES)[number]

export function isRunEventType(type: string): type is RunEventType {
  return (RUN_EVENT_TYPES as readonly string[]).includes(type)
}

export type RunEventPayload =
  | {
      type: "contract_compiled"
      payload: {
        contractId: string
        /**
         * Whether this run owes verification evidence before it may complete,
         * derived from the contract at compile time
         * (execution/compiler.ts, runtimePolicy.postconditions.verificationRequired).
         *
         * The requirement belongs here, at the run's birth, because it is a
         * property of the authority granted — not of the evidence that later
         * arrives. Optional so runs recorded before this field existed still
         * replay; absent is read as "not required", which is the pre-existing
         * behavior.
         */
        verificationRequired?: boolean
        /**
         * Whether guards enforce or only warn. Previously persisted on the legacy
         * run row, which meant that after the legacy path was retired it was
         * stored nowhere and enforcement silently degraded to "warn". It belongs
         * with the run's birth record for the same reason the verification
         * requirement does: it is a property of the authority granted.
         */
        guardEnforcementMode?: "warn" | "enforce"
      }
    }
  | { type: "execution_queued"; payload: Record<string, never> }
  | { type: "workflow_started"; payload: Record<string, never> }
  | {
      type: "approval_requested"
      payload: {
        approvalId: string
        approvalType: string
        risk: string
        /**
         * What the operator was actually shown before deciding.
         *
         * Without these the log proves an approval happened but not what was
         * permitted, so replay cannot answer the only question that matters when
         * an approval is audited. They were held solely in ApprovalStore, which
         * made the store authoritative and the log decorative. Optional so
         * approvals recorded before this field existed still replay.
         */
        title?: string
        reason?: string
        expectedConsequence?: string
        stepId?: string | null
      }
    }
  | {
      type: "approval_resolved"
      payload: {
        approvalId: string
        decision: "approved" | "rejected"
        /** Who decided, and when. An unattributed decision is not an audit record. */
        actor?: string | null
        comment?: string
        resolvedAt?: string
      }
    }
  | {
      type: "step_added"
      payload: { stepId: string; title: string; stepType: "proposed" | "executed" | "approved" | "rejected" }
    }
  | { type: "step_started"; payload: { stepId: string } }
  | { type: "step_completed"; payload: { stepId: string; outputs: string[] } }
  | { type: "step_failed"; payload: { stepId: string; error: { code: string; message: string } } }
  | { type: "artifact_created"; payload: { artifactId: string; artifactType: string } }
  | {
      type: "draft_created"
      payload: { draftId: string; type: string; content: string; targetPath?: string }
    }
  | {
      type: "trust_updated"
      payload: {
        trust: {
          posture: "low" | "guarded" | "moderate" | "strong"
          score: number | null
          blocked: boolean
          reasons: string[]
        } | null
      }
    }
  | { type: "run_failed"; payload: { error: { code: string; message: string; retryable: boolean } } }
  | {
      type: "run_completed"
      payload: {
        /**
         * The contract-aware judgement that permitted completion. Durable because
         * it is the answer to "why was this accepted" — recomputing it later reads
         * the tree as it is now, not as it was when the run was accepted.
         */
        completionProof?: unknown
      }
    }
  | { type: "workflow_completed"; payload: Record<string, never> }
  | { type: "approval_denied"; payload: Record<string, never> }
  | { type: "approval_required"; payload: Record<string, never> }
  | { type: "approval_resumed"; payload: Record<string, never> }
  | {
      type: "provider_pressure_updated"
      payload: { lane?: string; throttles: number; inFlight: number; queueLength: number }
    }
  | {
      type: "worker_sandbox_recorded"
      payload: {
        /** Isolation mechanism DAX applied (seatbelt, bwrap). */
        provider: string
        /**
         * Which worker provider actually did the work. Answers "who produced
         * this patch" in the receipt, which the sandbox provider does not.
         * Optional so events written before the registry still replay.
         */
        providerId?: string
        filesystem: "checkout-write-only"
        network: "full" | "localhost-only" | "none"
        /**
         * Whether DAX had to kill descendants the worker left behind. Optional
         * so events written before process ownership was enforced still replay.
         */
        reapedDescendants?: boolean
        /**
         * Egress confinement that actually held for this invocation: "filtered"
         * means the forward proxy narrowed egress to the allowlist, "unconfined"
         * is the operator escape hatch. Optional so events written before egress
         * filtering was recorded still replay.
         */
        egress?: "filtered" | "unconfined"
        /**
         * How the recorded egress posture was enforced. "cooperative-proxy"
         * binds a worker that honors the proxy env; "none" means no binding.
         * Optional so events written before enforcement was recorded still replay.
         */
        egressEnforcement?: "cooperative-proxy" | "none"
        /**
         * Hosts the run's forward proxy allowed when egress was filtered.
         * Optional so events written before the allowlist was recorded still replay.
         */
        egressAllowHosts?: string[]
      }
    }
  | {
      type: "contract_refined"
      payload: {
        writeScope: string[]
        forbiddenPaths: string[]
        verification: string[]
        provenance: { writeScope: string; forbiddenPaths: string; verification: string }
      }
    }
  | {
      type: "worker_egress_denied"
      payload: { providerId: string; hosts: string[] }
    }
  | { type: "execution_started"; payload: Record<string, never> }
  | { type: "plan_quality_gate"; payload: { reason?: string } }
  | { type: "signoff_requested"; payload: Record<string, never> }
  | { type: "signoff_received"; payload: { decision?: string } }
  | { type: "workflow_signed_off"; payload: Record<string, never> }
  | { type: "workflow_rejected"; payload: Record<string, never> }
  | { type: "workflow_expired"; payload: Record<string, never> }
  | { type: "workflow_failed"; payload: { error?: { code: string; message: string } } }
  | {
      type: "mutation_recorded"
      payload: {
        /** Receipts attesting the change, digested over the diff itself. */
        receiptIds: string[]
        /** Paths the kernel observed as changed. */
        changedPaths: string[]
      }
    }
  | {
      type: "verification_recorded"
      payload: {
        status: "passed" | "failed"
        receipts: Array<{ receiptId: string }>
        /**
         * Redacted check results. Typed because these decide whether a run may
         * complete — the evidence gating completion should not be the least
         * described thing in the vocabulary.
         */
        checks: CheckResult[]
      }
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

let eventCounter = 0

export function createEvent(runId: string, seq: number, type: RunEventType, payload: unknown): RunEventEnvelope {
  return {
    // slice(2, 11) on a base36 counter returned "" until the counter reached
    // 1296, so every event minted in the same millisecond shared an id.
    eventId: `evt_${Date.now()}_${(eventCounter++).toString(36).padStart(6, "0")}`,
    runId,
    seq,
    type,
    payload,
    occurredAt: new Date().toISOString(),
    schemaVersion: "v1",
  }
}

/**
 * Runtime validation for the envelope, applied where a log crosses back into the
 * process from disk.
 *
 * The type annotation on `Storage.read<RunEventEnvelope[]>` is a claim about the
 * file, not a check of it: a truncated write, a hand edit or a log from a newer
 * build all satisfy TypeScript and none of them satisfy the contract. Structure
 * is validated here; `reduceRunState` separately enforces contiguity, and the
 * reducer's closed switch rejects any type outside the vocabulary.
 *
 * Payloads are deliberately passed through rather than parsed per type. A payload
 * schema per event type is the stronger check and is worth having, but declaring
 * it half-heartedly — a few types validated, the rest waved through — would
 * report a guarantee the system does not provide.
 */
export const RunEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  runId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  type: z.enum(RUN_EVENT_TYPES),
  payload: z.unknown(),
  occurredAt: z.string().min(1),
  schemaVersion: z.literal("v1"),
  causationId: z.string().optional(),
  correlationId: z.string().optional(),
  commandId: z.string().optional(),
})

/**
 * Validate a log read from storage, naming the position that failed so the raw
 * artifact can be found. Refuses rather than repairs: a partially readable audit
 * record is worse than an unreadable one, because it looks complete.
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
