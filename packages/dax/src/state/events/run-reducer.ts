import type { RunEventEnvelope } from "./run-event-types"
/**
 * The state machine is defined once, in run-state.ts.
 *
 * This file used to carry its own copy of the transition table and its own
 * terminal-status check. Two independently maintained copies of the same rules
 * is a poor arrangement anywhere; here it is worse, because one governs the
 * live transition path and this one governs event replay. DAX's claim is that
 * replaying the log reproduces the run. Edit one table and not the other and
 * the two disagree, while the TypeScript-to-Rust parity tests keep passing,
 * since they compare this reducer against Rust rather than against the live
 * path.
 */
import { isLegalTransition, isTerminalStatus } from "@/state/run-state"

export type RunState = {
  runId: string
  contractId: string
  status: RunStatus
  currentStepId: string | null
  steps: StepRecord[]
  pendingApprovalIds: string[]
  /**
   * The approvals this run requested, as the operator saw them. Distinct from
   * pendingApprovalIds, which answers "is anything blocked" but not "what was
   * permitted, by whom, on what basis".
   */
  approvals: ApprovalRecord[]
  evidence: RunEvidence
  /**
   * What evidence stood at the moment the run was accepted.
   *
   * Distinct from governance.completionProof, which is a contract-aware judgement
   * computed outside the reducer (execution/completion-proof.ts). This is the
   * narrower question replay can answer on its own: a reviewer asking "why was
   * this accepted?" should be answered by the completion record rather than by
   * correlating it against other events by hand.
   */
  completion: {
    completedAt: string
    verificationReceiptIds: string[]
    mutationReceiptIds: string[]
  } | null
  artifactIds: string[]
  governance: {
    guardEnforcementMode: "warn" | "enforce"
    budget: {
      maxFilesTouched: number
      maxMutatingCommands: number
      maxApprovalRequests: number
      maxRepeatedFailures: number
      filesTouched: number
      mutatingCommands: number
      approvalsRequested: number
    }
    providerPressure: {
      lane?: string
      throttles: number
      inFlight: number
      queueLength: number
    }
    touchedFiles: string[]
    baselineCheckpoint: {
      baselineRef?: string
      snapshotId?: string
      createdAt: string
    } | null
    mutationReceiptIds: string[]
    verification: {
      required: boolean
      satisfied: boolean
      receiptIds: string[]
    }
    planQuality: {
      score: number
      decision: "proceed" | "pause"
      failedChecks: string[]
      guidance: string[]
      checkedAt: string
    } | null
    completionProof: {
      decision: "pass" | "fail"
      failedChecks: string[]
      verificationExecuted: boolean
      receiptIds: string[]
      artifactChecks: boolean
      expectedOutputChecks: boolean
      expectedOutputTypesSatisfied: string[]
      expectedOutputTypesMissing: string[]
      scopeChecks: boolean
      sensitivePathApprovalChecks: boolean
      checkedAt: string
    } | null
    failureCounts: Record<string, number>
  }
  draft: DraftRecord | null
  trust: TrustSummary | null
  error: RunError | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export type RunStatus =
  | "created"
  | "compiled"
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"

/**
 * What the run's governance actually did, as opposed to what it was configured to
 * do. Answers the three questions a reviewer asks about a governed worker: what
 * scope was granted, how was it isolated, and what did it try to reach.
 *
 * These events were recorded and projected nowhere, so after replay a run whose
 * worker attempted a blocked host was indistinguishable from one that did not —
 * exactly the record a reviewer needs.
 */
export type RunEvidence = {
  /** The refined contract the worker actually executed under. */
  contract: {
    writeScope: string[]
    forbiddenPaths: string[]
    verification: string[]
    provenance: Record<string, string> | null
  } | null
  /** The isolation DAX applied, as observed after the worker exited. */
  sandbox: {
    provider: string
    providerId: string | null
    filesystem: string
    network: string
    reapedDescendants: boolean
    egress: string | null
    egressEnforcement: string | null
    egressAllowHosts: string[]
  } | null
  /** Hosts a worker attempted to reach and was refused. Evidence in its own right. */
  egressDenials: Array<{ providerId: string | null; hosts: string[] }>
}

export type ApprovalRecord = {
  approvalId: string
  approvalType: string
  risk: string
  title: string | null
  reason: string | null
  expectedConsequence: string | null
  stepId: string | null
  status: "pending" | "approved" | "rejected"
  decidedBy: string | null
  decidedAt: string | null
}

export type StepRecord = {
  stepId: string
  title: string
  type: "proposed" | "executed" | "approved" | "rejected"
  status: "proposed" | "running" | "completed" | "failed" | "blocked"
  startedAt: string | null
  completedAt: string | null
  error: StepError | null
  outputs: string[]
}

export type DraftRecord = {
  draftId: string
  type: string
  content: string
  targetPath?: string
}

export type StepError = {
  code: string
  message: string
  retryable: boolean
}

export type TrustSummary = {
  posture: "low" | "guarded" | "moderate" | "strong"
  score: number | null
  blocked: boolean
  reasons: string[]
}

export type RunError = {
  code: string
  message: string
  retryable: boolean
}



/**
 * Refuse a log that cannot be replayed faithfully.
 *
 * `appendRunEvent` enforces `expectedSeq` on write, so a well-formed store never
 * produces a gap. Nothing enforced it on read, which meant a truncated, merged or
 * hand-edited events.json projected without complaint into a state that never
 * existed — and every guarantee built on replay silently became a guess.
 *
 * Contiguity from 0 is the property that makes replay equivalence meaningful:
 * seq is the log's identity, so `events[i].seq === i` is the whole contract.
 * Refusing is correct rather than harsh — a partial projection of an audit record
 * is worse than no projection, because it is indistinguishable from a complete one.
 */
function assertContiguous(events: RunEventEnvelope[]): void {
  for (let i = 0; i < events.length; i++) {
    const event = events[i]

    if (event.seq !== i) {
      throw new Error(
        `Run event log is not contiguous: expected seq ${i} at position ${i}, got ${event.seq}` +
          ` (type ${event.type}). Refusing to project a partial log.`,
      )
    }

    // A log that mixes runs is corrupt in the same way and for the same reason:
    // the resulting state belongs to no run that ever executed.
    if (event.runId !== events[0].runId) {
      throw new Error(
        `Run event log mixes runs: seq ${event.seq} belongs to ${event.runId},` +
          ` expected ${events[0].runId}. Refusing to project a merged log.`,
      )
    }
  }
}

export function reduceRunState(events: RunEventEnvelope[]): RunState | null {
  if (events.length === 0) {
    return null
  }

  const firstEvent = events[0]
  if (firstEvent.type !== "contract_compiled") {
    throw new Error(`First event must be contract_compiled, got ${firstEvent.type}`)
  }

  assertContiguous(events)

  const birth = firstEvent.payload as { contractId: string; verificationRequired?: boolean }
  const contractId = birth.contractId

  const state: RunState = {
    runId: firstEvent.runId,
    contractId,
    status: "compiled",
    currentStepId: null,
    steps: [],
    pendingApprovalIds: [],
    approvals: [],
    evidence: { contract: null, sandbox: null, egressDenials: [] },
    completion: null,
    artifactIds: [],
    governance: {
      guardEnforcementMode: "warn",
      budget: {
        maxFilesTouched: 8,
        maxMutatingCommands: 6,
        maxApprovalRequests: 4,
        maxRepeatedFailures: 3,
        filesTouched: 0,
        mutatingCommands: 0,
        approvalsRequested: 0,
      },
      providerPressure: {
        throttles: 0,
        inFlight: 0,
        queueLength: 0,
      },
      touchedFiles: [],
      baselineCheckpoint: null,
      mutationReceiptIds: [],
      verification: {
        // Established at birth from the contract, so a run that never verifies
        // is still held to the requirement. Deriving it from verification_recorded
        // instead would make the completion gate circular: it would constrain
        // only those runs that already verified.
        required: birth.verificationRequired === true,
        satisfied: false,
        receiptIds: [],
      },
      planQuality: null,
      completionProof: null,
      failureCounts: {},
    },
    draft: null,
    trust: null,
    error: null,
    createdAt: firstEvent.occurredAt,
    updatedAt: firstEvent.occurredAt,
    startedAt: null,
    completedAt: null,
  }

  for (let i = 1; i < events.length; i++) {
    const event = events[i]
    state.updatedAt = event.occurredAt

    switch (event.type) {
      case "execution_queued": {
        if (!isLegalTransition(state.status, "queued")) {
          throw new Error(`Illegal transition from ${state.status} to queued`)
        }
        state.status = "queued"
        break
      }

      case "workflow_started": {
        if (!isLegalTransition(state.status, "running")) {
          throw new Error(`Illegal transition from ${state.status} to running`)
        }
        state.status = "running"
        state.startedAt = event.occurredAt
        break
      }

      case "approval_requested": {
        if (!isTerminalStatus(state.status)) {
          if (state.status !== "waiting_approval" && !isLegalTransition(state.status, "waiting_approval")) {
            throw new Error(`Illegal transition from ${state.status} to waiting_approval`)
          }
          if (state.status !== "waiting_approval") {
            state.status = "waiting_approval"
          }
          const payload = event.payload as {
            approvalId: string
            approvalType?: string
            risk?: string
            title?: string
            reason?: string
            expectedConsequence?: string
            stepId?: string | null
          }
          if (!state.pendingApprovalIds.includes(payload.approvalId)) {
            state.pendingApprovalIds.push(payload.approvalId)
            state.governance.budget.approvalsRequested += 1
            state.approvals.push({
              approvalId: payload.approvalId,
              approvalType: payload.approvalType ?? "tool",
              risk: payload.risk ?? "medium",
              title: payload.title ?? null,
              reason: payload.reason ?? null,
              expectedConsequence: payload.expectedConsequence ?? null,
              stepId: payload.stepId ?? null,
              status: "pending",
              decidedBy: null,
              decidedAt: null,
            })
          }
        }
        break
      }

      case "approval_resolved": {
        const payload = event.payload as {
          approvalId: string
          decision: "approved" | "rejected"
          actor?: string | null
          resolvedAt?: string
        }
        state.pendingApprovalIds = state.pendingApprovalIds.filter((id) => id !== payload.approvalId)

        const record = state.approvals.find((approval) => approval.approvalId === payload.approvalId)
        if (record) {
          record.status = payload.decision
          record.decidedBy = payload.actor ?? null
          record.decidedAt = payload.resolvedAt ?? event.occurredAt
        }

        if (state.pendingApprovalIds.length === 0) {
          if (!isLegalTransition(state.status, "running")) {
            if (!isTerminalStatus(state.status)) {
              throw new Error(`Illegal transition from ${state.status} to running`)
            }
          } else {
            state.status = "running"
          }
        }
        break
      }

      case "step_added": {
        if (isTerminalStatus(state.status)) {
          break
        }
        if (state.status !== "running" && state.status !== "queued") {
          throw new Error(`Cannot add step in status: ${state.status}`)
        }
        const payload = event.payload as { stepId: string; title: string; stepType: string }
        state.currentStepId = payload.stepId
        state.steps.push({
          stepId: payload.stepId,
          title: payload.title,
          type: payload.stepType as StepRecord["type"],
          status: "proposed",
          startedAt: null,
          completedAt: null,
          error: null,
          outputs: [],
        })
        break
      }

      case "step_started": {
        const payload = event.payload as { stepId: string }
        const step = state.steps.find((s) => s.stepId === payload.stepId)
        if (!step) {
          throw new Error(`Step not found: ${payload.stepId}`)
        }
        if (step.status !== "proposed") {
          throw new Error(`Illegal step transition from ${step.status} to running`)
        }
        step.status = "running"
        step.startedAt = event.occurredAt
        state.currentStepId = payload.stepId
        break
      }

      case "step_completed": {
        const payload = event.payload as { stepId: string; outputs: string[] }
        const step = state.steps.find((s) => s.stepId === payload.stepId)
        if (!step) {
          throw new Error(`Step not found: ${payload.stepId}`)
        }
        if (step.status !== "running") {
          throw new Error(`Illegal step transition from ${step.status} to completed`)
        }
        step.status = "completed"
        step.completedAt = event.occurredAt
        step.outputs.push(...payload.outputs)
        state.currentStepId = null
        break
      }

      case "step_failed": {
        const payload = event.payload as { stepId: string; error: { code: string; message: string } }
        const step = state.steps.find((s) => s.stepId === payload.stepId)
        if (!step) {
          throw new Error(`Step not found: ${payload.stepId}`)
        }
        step.status = "failed"
        step.completedAt = event.occurredAt
        step.error = { ...payload.error, retryable: false }
        state.currentStepId = null
        break
      }

      case "artifact_created": {
        const payload = event.payload as { artifactId: string; artifactType?: string }
        if (!state.artifactIds.includes(payload.artifactId)) {
          state.artifactIds.push(payload.artifactId)
        }
        break
      }

      case "mutation_recorded": {
        const payload = event.payload as { receiptIds: string[]; changedPaths: string[] }

        for (const receiptId of payload.receiptIds) {
          if (!state.governance.mutationReceiptIds.includes(receiptId)) {
            state.governance.mutationReceiptIds.push(receiptId)
          }
        }
        for (const path of payload.changedPaths) {
          if (!state.governance.touchedFiles.includes(path)) {
            state.governance.touchedFiles.push(path)
          }
        }

        // Mutation implies evidence, whatever the contract asked for. A run that
        // changed the tree and proved nothing about it must not reach completed
        // just because its contract was compiled without a verification clause.
        // execution/runtime-guard.ts:715-726 already applies this rule on its own
        // state; this is the same rule where replay can see it.
        state.governance.verification.required = true
        break
      }

      case "verification_recorded": {
        const payload = event.payload as { status: "passed" | "failed"; receipts: Array<{ receiptId: string }> }
        state.governance.verification.required = true
        state.governance.verification.satisfied = payload.status === "passed"
        for (const receipt of payload.receipts) {
          if (!state.governance.verification.receiptIds.includes(receipt.receiptId)) {
            state.governance.verification.receiptIds.push(receipt.receiptId)
          }
        }
        break
      }

      case "draft_created": {
        const payload = event.payload as { draftId: string; type: string; content: string; targetPath?: string }
        state.draft = {
          draftId: payload.draftId,
          type: payload.type,
          content: payload.content,
          targetPath: payload.targetPath,
        }
        break
      }

      case "trust_updated": {
        const payload = event.payload as { trust: TrustSummary | null }
        state.trust = payload.trust
        break
      }

      case "approval_denied": {
        if (!isTerminalStatus(state.status)) {
          state.status = "failed"
          state.error = {
            code: "approval_rejected",
            message: "Approval was denied",
            retryable: false,
          }
          state.currentStepId = null
          state.completedAt = event.occurredAt
        }
        break
      }

      case "run_failed": {
        if (!isTerminalStatus(state.status)) {
          const payload = event.payload as { error: { code: string; message: string; retryable: boolean } }
          state.status = "failed"
          state.error = { ...payload.error, retryable: payload.error.retryable ?? false }
          state.currentStepId = null
          state.completedAt = event.occurredAt
        }
        break
      }

      case "workflow_completed":
      case "run_completed": {
        if (!isTerminalStatus(state.status)) {
          if (state.pendingApprovalIds.length > 0) {
            throw new Error(`Run cannot complete with pending approvals: ${state.pendingApprovalIds.join(", ")}`)
          }
          if (state.governance.verification.required && !state.governance.verification.satisfied) {
            throw new Error(`Run cannot complete without verification evidence`)
          }
          state.status = "completed"
          state.currentStepId = null
          state.completedAt = event.occurredAt
          // Bind the acceptance to the evidence that stood at that moment, rather
          // than leaving a reviewer to infer it from event order.
          state.completion = {
            completedAt: event.occurredAt,
            verificationReceiptIds: [...state.governance.verification.receiptIds],
            mutationReceiptIds: [...state.governance.mutationReceiptIds],
          }
        }
        break
      }

      case "contract_compiled": {
        break
      }

      case "provider_pressure_updated": {
        const payload = event.payload as { lane?: string; throttles: number; inFlight: number; queueLength: number }
        state.governance.providerPressure = {
          lane: payload.lane,
          throttles: payload.throttles,
          inFlight: payload.inFlight,
          queueLength: payload.queueLength,
        }
        break
      }

      // Legacy hybrid-transition status markers. The authoritative transitions
      // are approval_requested / approval_resolved, which already moved the
      // run status and the approval set; these only re-label the same moment.
      case "approval_required":
      case "approval_resumed": {
        break
      }

      // Evidence events. They carry the worker_run receipt fields but project
      // into RunState only when the governance projection is added; for now
      // the event log is their store, so reduction is a no-op.
      case "execution_started": {
        if (!isTerminalStatus(state.status) && state.status !== "running") {
          if (!isLegalTransition(state.status, "running")) {
            throw new Error(`Illegal transition from ${state.status} to running`)
          }
          state.status = "running"
          state.startedAt = state.startedAt ?? event.occurredAt
        }
        break
      }

      case "plan_quality_gate":
      case "signoff_requested": {
        // Both pause the run for a human: a plan that did not clear its quality
        // bar, and a review awaiting signoff. Same shape as approval_requested
        // without an approval object, since neither creates one.
        if (!isTerminalStatus(state.status) && state.status !== "waiting_approval") {
          if (!isLegalTransition(state.status, "waiting_approval")) {
            throw new Error(`Illegal transition from ${state.status} to waiting_approval`)
          }
          state.status = "waiting_approval"
        }
        break
      }

      case "signoff_received": {
        if (!isTerminalStatus(state.status) && state.status !== "running") {
          if (!isLegalTransition(state.status, "running")) {
            throw new Error(`Illegal transition from ${state.status} to running`)
          }
          state.status = "running"
        }
        break
      }

      case "workflow_signed_off": {
        // review_and_signoff's accepted terminal. Distinct from run_completed
        // because what satisfied it is a human decision, not verification
        // evidence — so it must not be routed through the completion gate.
        if (!isTerminalStatus(state.status)) {
          state.status = "completed"
          state.currentStepId = null
          state.completedAt = event.occurredAt
        }
        break
      }

      case "workflow_rejected":
      case "workflow_expired": {
        // Terminal without being a failure of the run: the work was produced and
        // a human declined it, or the window closed.
        if (!isTerminalStatus(state.status)) {
          state.status = "cancelled"
          state.currentStepId = null
          state.completedAt = event.occurredAt
        }
        break
      }

      case "workflow_failed": {
        const payload = event.payload as { error?: { code: string; message: string } }
        if (!isTerminalStatus(state.status)) {
          state.status = "failed"
          state.error = {
            code: payload.error?.code ?? "workflow_failed",
            message: payload.error?.message ?? "Workflow failed",
            retryable: false,
          }
          state.currentStepId = null
          state.completedAt = event.occurredAt
        }
        break
      }

      case "contract_refined": {
        const payload = event.payload as {
          writeScope?: string[]
          forbiddenPaths?: string[]
          verification?: string[]
          provenance?: Record<string, string>
        }
        state.evidence.contract = {
          writeScope: payload.writeScope ?? [],
          forbiddenPaths: payload.forbiddenPaths ?? [],
          verification: payload.verification ?? [],
          provenance: payload.provenance ?? null,
        }
        break
      }

      case "worker_sandbox_recorded": {
        const payload = event.payload as {
          provider: string
          providerId?: string
          filesystem: string
          network: string
          reapedDescendants?: boolean
          egress?: string
          egressEnforcement?: string
          egressAllowHosts?: string[]
        }
        state.evidence.sandbox = {
          provider: payload.provider,
          providerId: payload.providerId ?? null,
          filesystem: payload.filesystem,
          network: payload.network,
          reapedDescendants: payload.reapedDescendants === true,
          egress: payload.egress ?? null,
          egressEnforcement: payload.egressEnforcement ?? null,
          egressAllowHosts: payload.egressAllowHosts ?? [],
        }
        break
      }

      case "worker_egress_denied": {
        const payload = event.payload as { providerId?: string; hosts: string[] }
        state.evidence.egressDenials.push({
          providerId: payload.providerId ?? null,
          hosts: payload.hosts,
        })
        break
      }

      default: {
        throw new Error(`Unknown event type: ${event.type} (seq ${event.seq})`)
      }
    }
  }

  return state
}
