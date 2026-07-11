import type { RunEventEnvelope } from "./run-event-types"

export type RunState = {
  runId: string
  contractId: string
  status: RunStatus
  currentStepId: string | null
  steps: StepRecord[]
  pendingApprovalIds: string[]
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

function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function isLegalTransition(from: RunStatus, to: RunStatus): boolean {
  const transitions: Record<RunStatus, RunStatus[]> = {
    created: ["compiled", "cancelled"],
    compiled: ["queued", "cancelled"],
    queued: ["running", "cancelled"],
    running: ["waiting_approval", "completed", "failed", "cancelled"],
    waiting_approval: ["running", "cancelled", "failed"],
    completed: [],
    failed: [],
    cancelled: [],
  }
  return transitions[from]?.includes(to) ?? false
}

export function reduceRunState(events: RunEventEnvelope[]): RunState | null {
  if (events.length === 0) {
    return null
  }

  const firstEvent = events[0]
  if (firstEvent.type !== "contract_compiled") {
    throw new Error(`First event must be contract_compiled, got ${firstEvent.type}`)
  }

  const contractId = (firstEvent.payload as { contractId: string }).contractId

  const state: RunState = {
    runId: firstEvent.runId,
    contractId,
    status: "compiled",
    currentStepId: null,
    steps: [],
    pendingApprovalIds: [],
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
        required: false,
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
          const payload = event.payload as { approvalId: string }
          if (!state.pendingApprovalIds.includes(payload.approvalId)) {
            state.pendingApprovalIds.push(payload.approvalId)
            state.governance.budget.approvalsRequested += 1
          }
        }
        break
      }

      case "approval_resolved": {
        const payload = event.payload as { approvalId: string; decision: "approved" | "rejected" }
        state.pendingApprovalIds = state.pendingApprovalIds.filter((id) => id !== payload.approvalId)

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
    }
  }

  return state
}
