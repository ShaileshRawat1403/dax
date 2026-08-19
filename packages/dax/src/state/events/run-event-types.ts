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
      }
    }
  | { type: "execution_queued"; payload: Record<string, never> }
  | { type: "workflow_started"; payload: Record<string, never> }
  | {
      type: "approval_requested"
      payload: { approvalId: string; approvalType: string; risk: string }
    }
  | { type: "approval_resolved"; payload: { approvalId: string; decision: "approved" | "rejected" } }
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
  | { type: "run_completed"; payload: Record<string, never> }
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
        checks: unknown[]
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
    eventId: `evt_${Date.now()}_${(eventCounter++).toString(36).slice(2, 11)}`,
    runId,
    seq,
    type,
    payload,
    occurredAt: new Date().toISOString(),
    schemaVersion: "v1",
  }
}
