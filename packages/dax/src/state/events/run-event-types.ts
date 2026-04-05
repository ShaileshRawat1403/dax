export type RunEventType =
  | "contract_compiled"
  | "execution_queued"
  | "workflow_started"
  | "approval_requested"
  | "approval_resolved"
  | "step_added"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "artifact_created"
  | "draft_created"
  | "trust_updated"
  | "run_failed"
  | "run_completed"
  | "provider_pressure_updated"

export type RunEventPayload =
  | { type: "contract_compiled"; payload: { contractId: string } }
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
  | {
      type: "provider_pressure_updated"
      payload: { lane?: string; throttles: number; inFlight: number; queueLength: number }
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
