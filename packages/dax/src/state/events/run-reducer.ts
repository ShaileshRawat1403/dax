import type { RunEventEnvelope, RunEventPayload } from "./run-event-types"
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
import { recomputeProviderInputPartitionDigest } from "@/execution/provider-input-partition"
import { commitCompactionPrefix } from "@/execution/compaction-prefix"

export type RunState = {
  runId: string
  contractId: string
  status: RunStatus
  currentStepId: string | null
  steps: StepRecord[]
  /**
   * Canonical native execution attempts, keyed independently of workflow
   * steps. Event replay always initializes this map; it is optional in the
   * shared return type only because the Gateway can still synthesize a legacy
   * compatibility state that has no canonical invocation projection.
   */
  invocations?: Record<string, NativeInvocationRecord>
  /**
   * Run-owned provenance for subagent dispatch. `coverage` describes only
   * whether delegation records can be reconstructed; it makes no claim about
   * prompt, context, assistant-message, or compaction history.
   */
  delegationHistory: DelegationHistory
  /** Durable, commitment-only provenance for SessionProcessor assistant output. */
  assistantHistory: AssistantHistory
  /** Durable commitments for DAX-generated instructions at the provider-adapter boundary. */
  promptHistory: PromptHistory
  /** Durable commitments for non-instruction SessionProcessor input at the same adapter boundary. */
  contextHistory: ContextHistory
  /** Bound summary attempts and applied history-replacement boundaries. */
  compactionHistory: CompactionHistory
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

/** Event replay always has the canonical invocation projection. */
export type CanonicalRunState = RunState & {
  invocations: Record<string, NativeInvocationRecord>
}

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
  context: {
    stepId?: string
    filePath?: string
    command?: string
    toolName?: string
    diffPreview?: string
    notes?: string[]
    originalPermissionId?: string
  } | null
  source: "workflow" | "permission" | "system" | "manual" | null
  /** Canonical invocation correlation, absent for workflow/legacy approvals. */
  correlationId: string | null
  requestedAt: string
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled"
  decidedBy: string | null
  decidedAt: string | null
  comment: string | null
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

type ToolInvocationPayload = Extract<RunEventPayload, { type: "tool_invocation_recorded" }>["payload"]

export type NativeInvocationRecord = Pick<
  ToolInvocationPayload,
  | "invocationId"
  | "toolId"
  | "executor"
  | "originTurnId"
  | "workflowStepId"
  | "parentInvocationId"
  | "ordinal"
  | "retryOfInvocationId"
> & {
  status: "awaiting_authorization" | "authorized" | "denied" | "completed" | "failed" | "cancelled"
  authorizationEventId: string | null
  resultEventId: string | null
  approvalIds: string[]
}

export type DelegationRecord = {
  invocationId: string
  parentSessionId: string
  childSessionId: string
  agent: string
  mode: "created" | "resumed"
  authorizationEventId: string
  eventId: string
  recordedAt: string
}

export type DelegationHistory = {
  /**
   * `complete` means every delegation transition visible to this run's
   * canonical task invocations is recorded. `partial` and `unavailable` are
   * conservative compatibility results, never inferred child lineage.
   */
  coverage: "complete" | "partial" | "unavailable"
  records: DelegationRecord[]
  missingInvocationIds: string[]
  uncapturedCreationSessionIds: string[]
}

export type AssistantTextPartCommitment = {
  partId: string
  ordinal: number
  attempt: number
  finalization: "finalized_post_plugin" | "interrupted_before_text_end" | "text_end_unfinalized"
  utf8Bytes: number
  digest: string
}

export type AssistantMessageRecord = {
  messageId: string
  sessionId: string
  parentMessageId: string
  providerId: string
  modelId: string
  agent: string
  summary: boolean
  source:
    | { kind: "root" }
    | { kind: "derived"; parentSessionId?: string }
    | {
        kind: "task_delegated"
        invocationId: string
        delegationEventId: string
        authorizationEventId: string
        parentSessionId: string
        agent: string
        mode: "created" | "resumed"
      }
  openedEventId: string
  openedSeq: number
  openedAt: string
  settlement: {
    status: "completed" | "failed" | "cancelled"
    finishReason?: string
    errorCode?: string
    attemptCount: number
    usage: {
      basis: "reported_finish_steps_only"
      finishStepCount: number
      input: number
      output: number
      reasoning: number
      cacheRead: number
      cacheWrite: number
      cost: number
    }
    text: {
      canonicalization: "assistant-visible-parts-v1"
      digest: string
      partCount: number
      finalizedPartCount: number
      interruptedPartCount: number
      utf8Bytes: number
      parts: AssistantTextPartCommitment[]
    }
    reasoningPartCount: number
    reasoningUtf8Bytes: number
    promptDispatch?: {
      count: number
      finalEventId: string | null
    }
    contextDispatch?: {
      count: number
      finalEventId: string | null
    }
    eventId: string
    settledAt: string
  } | null
}

export type AssistantSessionCoverage = {
  sessionId: string
  coverage: "complete" | "partial" | "unavailable"
  markerEventId: string | null
  priorScopeHistory: "none" | "unavailable" | null
  copiedHistory: "none" | "excluded" | null
  sourceSessionId?: string
  cutoverMessageId?: string
}

export type AssistantHistory = {
  scope: "session_processor_v1"
  /** Aggregate over the journal-known producer population, never all model history. */
  coverage: "complete" | "partial" | "unavailable"
  sessions: AssistantSessionCoverage[]
  messages: AssistantMessageRecord[]
  unsettledMessageIds: string[]
}

type PromptContributionPayload = Extract<RunEventPayload, { type: "prompt_contribution_recorded" }>["payload"]

export type PromptDispatchRecord = Omit<PromptContributionPayload, "commitment"> & {
  commitment: PromptContributionPayload["commitment"]
  eventId: string
  recordedAt: string
}

export type PromptSessionCoverage = {
  sessionId: string
  coverage: "complete" | "partial" | "unavailable"
  markerEventId: string | null
  markerSeq: number | null
  priorScopeHistory: "none" | "unavailable" | null
  copiedHistory: "none" | "excluded" | null
  sourceSessionId?: string
  cutoverMessageId?: string
}

export type PromptHistory = {
  scope: "session_processor_instructions_v1"
  /** Aggregate over the declared SessionProcessor instruction producer only. */
  coverage: "complete" | "partial" | "unavailable"
  sessions: PromptSessionCoverage[]
  dispatches: PromptDispatchRecord[]
  missingMessageIds: string[]
}

type ContextContributionPayload = Extract<RunEventPayload, { type: "context_contribution_recorded" }>["payload"]

export type ContextDispatchRecord = ContextContributionPayload & {
  eventId: string
  recordedAt: string
}

export type ContextSessionCoverage = {
  sessionId: string
  coverage: "complete" | "partial" | "unavailable"
  markerEventId: string | null
  markerSeq: number | null
  priorScopeHistory: "none" | "unavailable" | null
  copiedHistory: "none" | "excluded" | null
  sourceSessionId?: string
  cutoverMessageId?: string
}

export type ContextHistory = {
  scope: "session_processor_context_v1"
  /** Aggregate over the declared SessionProcessor context producer only. */
  coverage: "complete" | "partial" | "unavailable"
  sessions: ContextSessionCoverage[]
  dispatches: ContextDispatchRecord[]
  missingMessageIds: string[]
}

export type CompactionAttempt = {
  sessionId: string
  markerMessageId: string
  summaryMessageId: string
  previousReplacementEventId: string | null
  prefix: { canonicalization: "ordered-message-ids-v1"; digest: string; messageIds: string[] }
  eventId: string
  status: "open" | "not_adopted" | "adopted"
  outcomeEventId: string | null
  reason?: "failed" | "cancelled" | "finish_not_stop" | "empty_summary"
}

export type CompactionHistory = {
  scope: "session_compaction_replacement_v1"
  coverage: "complete" | "partial" | "unavailable"
  sessions: Array<{
    sessionId: string
    coverage: "complete" | "partial" | "unavailable"
    markerEventId: string | null
    cutoverMarkerId?: string
    priorScopeHistory: "none" | "unavailable" | null
    copiedHistory: "none" | "excluded" | null
    sourceSessionId?: string
    replacementEventId: string | null
  }>
  attempts: CompactionAttempt[]
  openAttemptEventIds: string[]
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

export function reduceRunState(events: RunEventEnvelope[]): CanonicalRunState | null {
  if (events.length === 0) {
    return null
  }

  const firstEvent = events[0]
  if (firstEvent.type !== "contract_compiled") {
    throw new Error(`First event must be contract_compiled, got ${firstEvent.type}`)
  }

  assertContiguous(events)

  const birth = firstEvent.payload as {
    contractId: string
    verificationRequired?: boolean
    guardEnforcementMode?: "warn" | "enforce"
  }
  const contractId = birth.contractId

  const state: CanonicalRunState = {
    runId: firstEvent.runId,
    contractId,
    status: "compiled",
    currentStepId: null,
    steps: [],
    invocations: {},
    delegationHistory: {
      coverage: "complete",
      records: [],
      missingInvocationIds: [],
      uncapturedCreationSessionIds: [],
    },
    assistantHistory: {
      scope: "session_processor_v1",
      coverage: "unavailable",
      sessions: [],
      messages: [],
      unsettledMessageIds: [],
    },
    promptHistory: {
      scope: "session_processor_instructions_v1",
      coverage: "unavailable",
      sessions: [],
      dispatches: [],
      missingMessageIds: [],
    },
    contextHistory: {
      scope: "session_processor_context_v1",
      coverage: "unavailable",
      sessions: [],
      dispatches: [],
      missingMessageIds: [],
    },
    compactionHistory: {
      scope: "session_compaction_replacement_v1",
      coverage: "unavailable",
      sessions: [],
      attempts: [],
      openAttemptEventIds: [],
    },
    pendingApprovalIds: [],
    approvals: [],
    evidence: { contract: null, sandbox: null, egressDenials: [] },
    completion: null,
    artifactIds: [],
    governance: {
      guardEnforcementMode: birth.guardEnforcementMode ?? "warn",
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

      case "tool_invocation_recorded": {
        const payload = event.payload as ToolInvocationPayload
        const invocations = state.invocations
        if (invocations[payload.invocationId]) {
          throw new Error(`Invocation already exists: ${payload.invocationId}`)
        }
        if (payload.contractId !== state.contractId) {
          throw new Error(
            `Invocation ${payload.invocationId} contract ${payload.contractId} does not match run contract ${state.contractId}`,
          )
        }
        if (payload.parentInvocationId) {
          const parent = invocations[payload.parentInvocationId]
          if (!parent) {
            throw new Error(`Parent invocation not found for ${payload.invocationId}: ${payload.parentInvocationId}`)
          }
        }
        if (payload.retryOfInvocationId) {
          const retrySource = invocations[payload.retryOfInvocationId]
          if (!retrySource) {
            throw new Error(
              `Retry source invocation not found for ${payload.invocationId}: ${payload.retryOfInvocationId}`,
            )
          }
          if (retrySource.toolId !== payload.toolId) {
            throw new Error(
              `Retry source tool does not match invocation ${payload.invocationId}: ${retrySource.toolId} != ${payload.toolId}`,
            )
          }
        }
        invocations[payload.invocationId] = {
          invocationId: payload.invocationId,
          toolId: payload.toolId,
          executor: payload.executor,
          originTurnId: payload.originTurnId,
          workflowStepId: payload.workflowStepId,
          parentInvocationId: payload.parentInvocationId,
          ordinal: payload.ordinal,
          retryOfInvocationId: payload.retryOfInvocationId,
          status: "awaiting_authorization",
          authorizationEventId: null,
          resultEventId: null,
          approvalIds: [],
        }
        break
      }

      case "authorization_recorded": {
        const payload = event.payload as Extract<RunEventPayload, { type: "authorization_recorded" }>["payload"]
        const invocation = state.invocations[payload.invocationId]
        if (!invocation) {
          throw new Error(`Authorization references unknown invocation: ${payload.invocationId}`)
        }
        if (event.correlationId !== payload.invocationId) {
          throw new Error(`Authorization correlation does not match invocation: ${payload.invocationId}`)
        }
        if (invocation.authorizationEventId) {
          throw new Error(`Invocation already has authorization: ${payload.invocationId}`)
        }
        if (invocation.status !== "awaiting_authorization") {
          throw new Error(`Cannot authorize invocation ${payload.invocationId} from status ${invocation.status}`)
        }
        const approvalRecords = payload.approvalIds.map((approvalId) => {
          const approval = state.approvals.find((record) => record.approvalId === approvalId)
          if (!approval) {
            throw new Error(`Authorization references unknown approval ${approvalId}: ${payload.invocationId}`)
          }
          if (approval.status === "pending") {
            throw new Error(`Authorization references unresolved approval ${approvalId}: ${payload.invocationId}`)
          }
          if (approval.correlationId !== payload.invocationId) {
            throw new Error(`Authorization references approval for another authority subject: ${payload.invocationId}`)
          }
          return approval
        })
        if (
          payload.finalDisposition === "allowed" &&
          approvalRecords.some((approval) => approval.status !== "approved")
        ) {
          throw new Error(`Allowed authorization references rejected approval: ${payload.invocationId}`)
        }
        const hasDirectDenial =
          payload.contractDisposition === "denied" ||
          payload.runtimeGuardDisposition === "denied" ||
          payload.permissionDisposition === "denied"
        if (
          payload.finalDisposition === "denied" &&
          !hasDirectDenial &&
          !approvalRecords.some((approval) => approval.status !== "approved")
        ) {
          throw new Error(`Denied authorization has no rejected authority source: ${payload.invocationId}`)
        }
        invocation.authorizationEventId = event.eventId
        invocation.approvalIds = [...payload.approvalIds]
        invocation.status = payload.finalDisposition === "allowed" ? "authorized" : "denied"
        break
      }

      case "delegation_recorded": {
        const payload = event.payload as Extract<RunEventPayload, { type: "delegation_recorded" }>["payload"]
        const invocation = state.invocations[payload.invocationId]
        if (!invocation) {
          throw new Error(`Delegation references unknown invocation: ${payload.invocationId}`)
        }
        if (invocation.toolId !== "task") {
          throw new Error(`Delegation references non-task invocation: ${payload.invocationId}`)
        }
        if (event.correlationId !== payload.invocationId) {
          throw new Error(`Delegation correlation does not match invocation: ${payload.invocationId}`)
        }
        if (!invocation.authorizationEventId) {
          throw new Error(`Delegation has no authorization: ${payload.invocationId}`)
        }
        if (event.causationId !== invocation.authorizationEventId) {
          throw new Error(`Delegation authorization causation does not match invocation: ${payload.invocationId}`)
        }
        if (invocation.status !== "authorized") {
          throw new Error(
            `Cannot record delegation for invocation ${payload.invocationId} from status ${invocation.status}`,
          )
        }
        if (state.delegationHistory.records.some((record) => record.invocationId === payload.invocationId)) {
          throw new Error(`Invocation already has a delegation: ${payload.invocationId}`)
        }
        if (
          payload.mode === "created" &&
          state.delegationHistory.records.some((record) => record.childSessionId === payload.childSessionId)
        ) {
          throw new Error(`Delegation cannot invent creation lineage for existing child: ${payload.childSessionId}`)
        }
        state.delegationHistory.records.push({
          invocationId: payload.invocationId,
          parentSessionId: payload.parentSessionId,
          childSessionId: payload.childSessionId,
          agent: payload.agent,
          mode: payload.mode,
          authorizationEventId: invocation.authorizationEventId,
          eventId: event.eventId,
          recordedAt: event.occurredAt,
        })
        break
      }

      case "assistant_recording_started": {
        const payload = event.payload as Extract<RunEventPayload, { type: "assistant_recording_started" }>["payload"]
        if (isTerminalStatus(state.status)) {
          throw new Error(`Cannot start assistant recording for ${payload.sessionId} after run settlement`)
        }
        if (event.correlationId !== payload.sessionId) {
          throw new Error(`Assistant coverage marker correlation does not match session: ${payload.sessionId}`)
        }
        if (state.assistantHistory.sessions.some((candidate) => candidate.sessionId === payload.sessionId)) {
          throw new Error(`Assistant coverage marker already exists for session: ${payload.sessionId}`)
        }
        state.assistantHistory.sessions.push({
          sessionId: payload.sessionId,
          coverage: payload.priorScopeHistory === "none" ? "complete" : "partial",
          markerEventId: event.eventId,
          priorScopeHistory: payload.priorScopeHistory,
          copiedHistory: payload.copiedHistory,
          ...(payload.sourceSessionId ? { sourceSessionId: payload.sourceSessionId } : {}),
          ...(payload.cutoverMessageId ? { cutoverMessageId: payload.cutoverMessageId } : {}),
        })
        break
      }

      case "assistant_message_recorded": {
        const payload = event.payload as Extract<RunEventPayload, { type: "assistant_message_recorded" }>["payload"]
        if (event.correlationId !== payload.messageId) {
          throw new Error(`Assistant message correlation does not match message: ${payload.messageId}`)
        }
        const marker = state.assistantHistory.sessions.find((candidate) => candidate.sessionId === payload.sessionId)
        if (!marker?.markerEventId) {
          throw new Error(`Assistant message has no producer coverage marker for session: ${payload.sessionId}`)
        }

        if (payload.phase === "opened") {
          if (isTerminalStatus(state.status)) {
            throw new Error(`Cannot open assistant message ${payload.messageId} after run settlement`)
          }
          if (state.assistantHistory.messages.some((candidate) => candidate.messageId === payload.messageId)) {
            throw new Error(`Assistant message already opened: ${payload.messageId}`)
          }
          if (
            payload.summary &&
            state.compactionHistory.sessions.some((candidate) => candidate.sessionId === payload.sessionId && candidate.markerEventId) &&
            !state.compactionHistory.attempts.some(
              (attempt) => attempt.sessionId === payload.sessionId && attempt.summaryMessageId === payload.messageId && attempt.status === "open",
            )
          ) {
            throw new Error(`Compaction summary has no bound attempt: ${payload.messageId}`)
          }
          const firstSessionMessage = !state.assistantHistory.messages.some(
            (candidate) => candidate.sessionId === payload.sessionId,
          )
          if (firstSessionMessage && marker.cutoverMessageId && marker.cutoverMessageId !== payload.messageId) {
            throw new Error(`Assistant message does not match its session cutover: ${payload.messageId}`)
          }
          if (payload.source.kind === "root") {
            if (payload.sessionId !== state.runId) {
              throw new Error(`Root assistant source must use the governing run session: ${payload.messageId}`)
            }
            if (marker.sourceSessionId) {
              throw new Error(`Root assistant source cannot claim copied session history: ${payload.messageId}`)
            }
            if (event.causationId !== marker.markerEventId) {
              throw new Error(`Root assistant source must be caused by its session marker: ${payload.messageId}`)
            }
          } else if (payload.source.kind === "derived") {
            if (payload.sessionId === state.runId) {
              throw new Error(`Derived assistant source cannot use the root session: ${payload.messageId}`)
            }
            if (marker.sourceSessionId && payload.source.parentSessionId !== marker.sourceSessionId) {
              throw new Error(`Derived assistant source does not match its session lineage: ${payload.messageId}`)
            }
            if (event.causationId !== marker.markerEventId) {
              throw new Error(`Derived assistant source must be caused by its session marker: ${payload.messageId}`)
            }
          } else {
            const source = payload.source
            const delegation = state.delegationHistory.records.find(
              (candidate) => candidate.eventId === source.delegationEventId,
            )
            if (!delegation) {
              throw new Error(`Assistant message references unknown delegation: ${payload.messageId}`)
            }
            if (
              delegation.invocationId !== source.invocationId ||
              delegation.authorizationEventId !== source.authorizationEventId ||
              delegation.parentSessionId !== source.parentSessionId ||
              delegation.childSessionId !== payload.sessionId ||
              delegation.agent !== source.agent ||
              delegation.mode !== source.mode
            ) {
              throw new Error(
                `Assistant message delegation identity does not match durable provenance: ${payload.messageId}`,
              )
            }
            if (
              source.mode === "created" &&
              marker.sourceSessionId &&
              marker.sourceSessionId !== source.parentSessionId
            ) {
              throw new Error(`Created delegation does not match the child session lineage: ${payload.messageId}`)
            }
            if (event.causationId !== delegation.eventId) {
              throw new Error(`Delegated assistant source must be caused by the exact delegation: ${payload.messageId}`)
            }
          }
          state.assistantHistory.messages.push({
            messageId: payload.messageId,
            sessionId: payload.sessionId,
            parentMessageId: payload.parentMessageId,
            providerId: payload.providerId,
            modelId: payload.modelId,
            agent: payload.agent,
            summary: payload.summary,
            source: payload.source,
            openedEventId: event.eventId,
            openedSeq: event.seq,
            openedAt: event.occurredAt,
            settlement: null,
          })
          break
        }

        const message = state.assistantHistory.messages.find((candidate) => candidate.messageId === payload.messageId)
        if (!message) throw new Error(`Assistant settlement references unopened message: ${payload.messageId}`)
        if (message.sessionId !== payload.sessionId) {
          throw new Error(`Assistant settlement session does not match opened message: ${payload.messageId}`)
        }
        if (message.settlement) throw new Error(`Assistant message already settled: ${payload.messageId}`)
        if (event.causationId !== message.openedEventId) {
          throw new Error(`Assistant settlement must be caused by its open event: ${payload.messageId}`)
        }
        const promptMarker = state.promptHistory.sessions.find(
          (candidate) => candidate.sessionId === payload.sessionId && candidate.markerEventId,
        )
        const promptEnrolled = Boolean(
          promptMarker &&
            (promptMarker.cutoverMessageId === payload.messageId ||
              (promptMarker.markerSeq !== null && message.openedSeq > promptMarker.markerSeq)),
        )
        const promptDispatches = state.promptHistory.dispatches.filter(
          (dispatch) => dispatch.messageId === payload.messageId,
        )
        if (promptEnrolled) {
          if (!payload.promptDispatch) {
            throw new Error(`Assistant settlement is missing prompt dispatch binding: ${payload.messageId}`)
          }
          if (payload.promptDispatch.count !== promptDispatches.length) {
            throw new Error(`Assistant settlement prompt dispatch count does not match: ${payload.messageId}`)
          }
          const finalDispatch = promptDispatches.at(-1)?.eventId ?? null
          if (payload.promptDispatch.finalEventId !== finalDispatch) {
            throw new Error(`Assistant settlement final prompt dispatch does not match: ${payload.messageId}`)
          }
          if (payload.status === "completed" && promptDispatches.length === 0) {
            throw new Error(`Completed assistant message has no prompt dispatch: ${payload.messageId}`)
          }
        } else if (payload.promptDispatch) {
          throw new Error(`Assistant settlement cannot claim unenrolled prompt dispatches: ${payload.messageId}`)
        }
        const contextMarker = state.contextHistory.sessions.find(
          (candidate) => candidate.sessionId === payload.sessionId && candidate.markerEventId,
        )
        const contextEnrolled = Boolean(
          contextMarker &&
            (contextMarker.cutoverMessageId === payload.messageId ||
              (contextMarker.markerSeq !== null && message.openedSeq > contextMarker.markerSeq)),
        )
        const contextDispatches = state.contextHistory.dispatches.filter(
          (dispatch) => dispatch.messageId === payload.messageId,
        )
        if (contextEnrolled) {
          if (!payload.contextDispatch) {
            throw new Error(`Assistant settlement is missing context dispatch binding: ${payload.messageId}`)
          }
          if (payload.contextDispatch.count !== contextDispatches.length) {
            throw new Error(`Assistant settlement context dispatch count does not match: ${payload.messageId}`)
          }
          const finalDispatch = contextDispatches.at(-1)?.eventId ?? null
          if (payload.contextDispatch.finalEventId !== finalDispatch) {
            throw new Error(`Assistant settlement final context dispatch does not match: ${payload.messageId}`)
          }
          if (payload.status === "completed" && contextDispatches.length === 0) {
            throw new Error(`Completed assistant message has no context dispatch: ${payload.messageId}`)
          }
          if (contextDispatches.length !== promptDispatches.length) {
            throw new Error(`Assistant settlement prompt/context dispatch counts differ: ${payload.messageId}`)
          }
        } else if (payload.contextDispatch) {
          throw new Error(`Assistant settlement cannot claim unenrolled context dispatches: ${payload.messageId}`)
        }
        message.settlement = {
          status: payload.status,
          ...(payload.finishReason ? { finishReason: payload.finishReason } : {}),
          ...(payload.errorCode ? { errorCode: payload.errorCode } : {}),
          attemptCount: payload.attemptCount,
          usage: payload.usage,
          text: payload.text,
          reasoningPartCount: payload.reasoningPartCount,
          reasoningUtf8Bytes: payload.reasoningUtf8Bytes,
          ...(payload.promptDispatch ? { promptDispatch: payload.promptDispatch } : {}),
          ...(payload.contextDispatch ? { contextDispatch: payload.contextDispatch } : {}),
          eventId: event.eventId,
          settledAt: event.occurredAt,
        }
        break
      }

      case "compaction_recording_started": {
        const payload = event.payload as Extract<RunEventPayload, { type: "compaction_recording_started" }>["payload"]
        if (isTerminalStatus(state.status)) throw new Error(`Cannot enroll compaction after run settlement`)
        if (event.correlationId !== payload.sessionId) throw new Error(`Compaction marker correlation mismatch`)
        if (state.compactionHistory.sessions.some((candidate) => candidate.sessionId === payload.sessionId)) {
          throw new Error(`Compaction coverage marker already exists: ${payload.sessionId}`)
        }
        if (
          payload.priorScopeHistory === "none" &&
          state.assistantHistory.messages.some((message) => message.sessionId === payload.sessionId && message.summary)
        ) {
          throw new Error(`Compaction marker cannot erase known prior summaries`)
        }
        state.compactionHistory.sessions.push({
          sessionId: payload.sessionId,
          coverage: payload.priorScopeHistory === "none" ? "complete" : "partial",
          markerEventId: event.eventId,
          cutoverMarkerId: payload.cutoverMarkerId,
          priorScopeHistory: payload.priorScopeHistory,
          copiedHistory: payload.copiedHistory,
          ...(payload.sourceSessionId ? { sourceSessionId: payload.sourceSessionId } : {}),
          replacementEventId: null,
        })
        break
      }

      case "compaction_attempt_bound": {
        const payload = event.payload as Extract<RunEventPayload, { type: "compaction_attempt_bound" }>["payload"]
        const session = state.compactionHistory.sessions.find((candidate) => candidate.sessionId === payload.sessionId)
        if (!session?.markerEventId || isTerminalStatus(state.status)) throw new Error(`Compaction attempt has no active marker`)
        if (event.correlationId !== payload.summaryMessageId || event.causationId !== session.markerEventId) {
          throw new Error(`Compaction attempt identity mismatch`)
        }
        if (session.replacementEventId !== payload.previousReplacementEventId) {
          throw new Error(`Compaction attempt uses a stale replacement boundary`)
        }
        if (state.compactionHistory.attempts.some((attempt) => attempt.sessionId === payload.sessionId && attempt.status === "open")) {
          throw new Error(`Compaction session already has an open attempt`)
        }
        if (state.compactionHistory.attempts.some((attempt) => attempt.summaryMessageId === payload.summaryMessageId)) {
          throw new Error(`Compaction summary identity already bound`)
        }
        if (!state.compactionHistory.attempts.some((attempt) => attempt.sessionId === payload.sessionId) &&
          payload.markerMessageId !== session.cutoverMarkerId) {
          throw new Error(`First compaction attempt must use its cutover marker`)
        }
        if (state.compactionHistory.attempts.some((attempt) =>
          attempt.sessionId === payload.sessionId && attempt.markerMessageId === payload.markerMessageId)) {
          throw new Error(`Compaction marker already used by an attempt`)
        }
        if (
          payload.prefix.messageIds.at(-1) !== payload.markerMessageId ||
          payload.prefix.messageIds.includes(payload.summaryMessageId) ||
          commitCompactionPrefix(payload.prefix.messageIds).digest !== payload.prefix.digest
        ) {
          throw new Error(`Compaction attempt prefix does not replay`)
        }
        const previous = state.compactionHistory.attempts.find((attempt) =>
          attempt.outcomeEventId === payload.previousReplacementEventId && attempt.status === "adopted")
        if (payload.previousReplacementEventId) {
          if (!previous || previous.sessionId !== payload.sessionId ||
            payload.prefix.messageIds[0] !== previous.markerMessageId ||
            !payload.prefix.messageIds.includes(previous.summaryMessageId)) {
            throw new Error(`Compaction prefix omits the previous replacement boundary`)
          }
        }
        const mostRecent = state.compactionHistory.attempts.findLast((attempt) => attempt.sessionId === payload.sessionId)
        if (mostRecent?.status === "not_adopted") {
          const priorPrefix = mostRecent.prefix.messageIds
          if (!priorPrefix.every((messageId, index) => payload.prefix.messageIds[index] === messageId) ||
            !payload.prefix.messageIds.includes(mostRecent.summaryMessageId)) {
            throw new Error(`Compaction prefix skips a non-adopted attempt`)
          }
        }
        state.compactionHistory.attempts.push({
          ...payload,
          eventId: event.eventId,
          status: "open",
          outcomeEventId: null,
        })
        break
      }

      case "compaction_attempt_closed": {
        const payload = event.payload as Extract<RunEventPayload, { type: "compaction_attempt_closed" }>["payload"]
        const attempt = state.compactionHistory.attempts.find((candidate) => candidate.eventId === payload.attemptEventId)
        const summary = state.assistantHistory.messages.find((candidate) => candidate.messageId === payload.summaryMessageId)
        if (!attempt || attempt.status !== "open" || attempt.sessionId !== payload.sessionId || attempt.summaryMessageId !== payload.summaryMessageId) {
          throw new Error(`Compaction close does not match an open attempt`)
        }
        if (event.correlationId !== payload.summaryMessageId || event.causationId !== payload.summarySettlementEventId) {
          throw new Error(`Compaction close causation mismatch`)
        }
        if (!summary?.summary || summary.sessionId !== payload.sessionId || summary.settlement?.eventId !== payload.summarySettlementEventId) {
          throw new Error(`Compaction close has no matching settled summary`)
        }
        const settlement = summary.settlement
        const validReason =
          (payload.reason === "failed" && settlement.status === "failed") ||
          (payload.reason === "cancelled" && settlement.status === "cancelled") ||
          (payload.reason === "finish_not_stop" && settlement.status === "completed" && settlement.finishReason !== "stop") ||
          (payload.reason === "empty_summary" && settlement.status === "completed" && settlement.finishReason === "stop")
        if (!validReason) throw new Error(`Compaction close reason does not match summary settlement`)
        attempt.status = "not_adopted"
        attempt.outcomeEventId = event.eventId
        attempt.reason = payload.reason
        break
      }

      case "compaction_replacement_recorded": {
        const payload = event.payload as Extract<RunEventPayload, { type: "compaction_replacement_recorded" }>["payload"]
        const attempt = state.compactionHistory.attempts.find((candidate) => candidate.eventId === payload.attemptEventId)
        const session = state.compactionHistory.sessions.find((candidate) => candidate.sessionId === payload.sessionId)
        const summary = state.assistantHistory.messages.find((candidate) => candidate.messageId === payload.summaryMessageId)
        if (!attempt || attempt.status !== "open" || !session?.markerEventId || isTerminalStatus(state.status)) {
          throw new Error(`Compaction replacement has no active attempt`)
        }
        if (state.compactionHistory.attempts.some((candidate) =>
          candidate !== attempt && candidate.sessionId === payload.sessionId &&
          candidate.markerMessageId === payload.markerMessageId && candidate.status === "adopted")) {
          throw new Error(`Compaction marker already has an adopted replacement`)
        }
        if (
          event.correlationId !== payload.summaryMessageId ||
          event.causationId !== payload.summarySettlementEventId ||
          attempt.sessionId !== payload.sessionId ||
          attempt.markerMessageId !== payload.markerMessageId ||
          attempt.summaryMessageId !== payload.summaryMessageId ||
          attempt.previousReplacementEventId !== payload.previousReplacementEventId ||
          attempt.prefix.digest !== payload.prefixDigest ||
          session.replacementEventId !== payload.previousReplacementEventId
        ) {
          throw new Error(`Compaction replacement does not match bound attempt and active boundary`)
        }
        const settlement = summary?.settlement
        if (
          !summary?.summary || summary.sessionId !== payload.sessionId || summary.parentMessageId !== payload.markerMessageId ||
          !settlement || settlement.eventId !== payload.summarySettlementEventId ||
          settlement.status !== "completed" || settlement.finishReason !== "stop" ||
          !settlement.text.parts.some((part) => part.finalization === "finalized_post_plugin" && part.utf8Bytes > 0) ||
          settlement.text.digest !== payload.summaryDigest ||
          settlement.promptDispatch?.finalEventId !== payload.promptEventId ||
          settlement.contextDispatch?.finalEventId !== payload.contextEventId
        ) {
          throw new Error(`Compaction replacement has no eligible settled summary`)
        }
        const context = state.contextHistory.dispatches.find((dispatch) => dispatch.eventId === payload.contextEventId)
        if (!context || context.messageId !== payload.summaryMessageId || context.partition.digest !== payload.contextPartitionDigest) {
          throw new Error(`Compaction replacement context commitment mismatch`)
        }
        attempt.status = "adopted"
        attempt.outcomeEventId = event.eventId
        session.replacementEventId = event.eventId
        break
      }

      case "prompt_recording_started": {
        const payload = event.payload as Extract<RunEventPayload, { type: "prompt_recording_started" }>["payload"]
        if (isTerminalStatus(state.status)) {
          throw new Error(`Cannot start prompt recording for ${payload.sessionId} after run settlement`)
        }
        if (event.correlationId !== payload.sessionId) {
          throw new Error(`Prompt coverage marker correlation does not match session: ${payload.sessionId}`)
        }
        if (state.promptHistory.sessions.some((candidate) => candidate.sessionId === payload.sessionId)) {
          throw new Error(`Prompt coverage marker already exists for session: ${payload.sessionId}`)
        }
        const message = state.assistantHistory.messages.find(
          (candidate) => candidate.messageId === payload.cutoverMessageId,
        )
        if (!message || message.sessionId !== payload.sessionId) {
          throw new Error(`Prompt coverage marker cutover must identify an opened assistant message`)
        }
        if (message.settlement) {
          throw new Error(`Prompt coverage cannot enroll settled message: ${payload.cutoverMessageId}`)
        }
        if (event.causationId !== message.openedEventId) {
          throw new Error(`Prompt coverage marker must be caused by its cutover assistant message`)
        }
        const knownPrior = state.assistantHistory.messages.some(
          (candidate) => candidate.sessionId === payload.sessionId && candidate.openedSeq < message.openedSeq,
        )
        if (knownPrior && payload.priorScopeHistory === "none") {
          throw new Error(`Prompt coverage marker cannot declare known prior history absent: ${payload.sessionId}`)
        }
        const assistantSession = state.assistantHistory.sessions.find(
          (candidate) => candidate.sessionId === payload.sessionId,
        )
        if (payload.copiedHistory === "excluded") {
          if (!assistantSession?.sourceSessionId || assistantSession.sourceSessionId !== payload.sourceSessionId) {
            throw new Error(`Prompt copied-history source does not match assistant session lineage`)
          }
        }
        state.promptHistory.sessions.push({
          sessionId: payload.sessionId,
          coverage: payload.priorScopeHistory === "none" ? "complete" : "partial",
          markerEventId: event.eventId,
          markerSeq: event.seq,
          priorScopeHistory: payload.priorScopeHistory,
          copiedHistory: payload.copiedHistory,
          ...(payload.sourceSessionId ? { sourceSessionId: payload.sourceSessionId } : {}),
          cutoverMessageId: payload.cutoverMessageId,
        })
        break
      }

      case "prompt_contribution_recorded": {
        const payload = event.payload as PromptContributionPayload
        if (isTerminalStatus(state.status)) {
          throw new Error(`Cannot record prompt contribution after run settlement: ${payload.messageId}`)
        }
        if (event.correlationId !== payload.messageId) {
          throw new Error(`Prompt contribution correlation does not match message: ${payload.messageId}`)
        }
        const message = state.assistantHistory.messages.find((candidate) => candidate.messageId === payload.messageId)
        if (!message) throw new Error(`Prompt contribution references unopened assistant message: ${payload.messageId}`)
        if (message.settlement)
          throw new Error(`Prompt contribution references settled assistant message: ${payload.messageId}`)
        if (
          message.sessionId !== payload.sessionId ||
          message.providerId !== payload.providerId ||
          message.modelId !== payload.modelId
        ) {
          throw new Error(`Prompt contribution identity does not match opened assistant message: ${payload.messageId}`)
        }
        if (event.causationId !== message.openedEventId) {
          throw new Error(`Prompt contribution must be caused by its assistant open event: ${payload.messageId}`)
        }
        const marker = state.promptHistory.sessions.find(
          (candidate) => candidate.sessionId === payload.sessionId && candidate.markerEventId,
        )
        if (!marker) throw new Error(`Prompt contribution has no producer coverage marker: ${payload.sessionId}`)
        const enrolled =
          marker.cutoverMessageId === payload.messageId ||
          (marker.markerSeq !== null && message.openedSeq > marker.markerSeq)
        if (!enrolled) throw new Error(`Prompt contribution predates its session cutover: ${payload.messageId}`)
        const existing = state.promptHistory.dispatches.filter((dispatch) => dispatch.messageId === payload.messageId)
        if (payload.dispatchOrdinal !== existing.length + 1) {
          throw new Error(
            `Prompt dispatch ordinal is not contiguous for ${payload.messageId}: expected ${existing.length + 1}, got ${payload.dispatchOrdinal}`,
          )
        }
        state.promptHistory.dispatches.push({
          ...payload,
          eventId: event.eventId,
          recordedAt: event.occurredAt,
        })
        break
      }

      case "context_recording_started": {
        const payload = event.payload as Extract<RunEventPayload, { type: "context_recording_started" }>["payload"]
        if (isTerminalStatus(state.status)) {
          throw new Error(`Cannot start context recording for ${payload.sessionId} after run settlement`)
        }
        if (event.correlationId !== payload.sessionId) {
          throw new Error(`Context coverage marker correlation does not match session: ${payload.sessionId}`)
        }
        if (state.contextHistory.sessions.some((candidate) => candidate.sessionId === payload.sessionId)) {
          throw new Error(`Context coverage marker already exists for session: ${payload.sessionId}`)
        }
        const message = state.assistantHistory.messages.find(
          (candidate) => candidate.messageId === payload.cutoverMessageId,
        )
        if (!message || message.sessionId !== payload.sessionId) {
          throw new Error(`Context coverage marker cutover must identify an opened assistant message`)
        }
        if (message.settlement) {
          throw new Error(`Context coverage cannot enroll settled message: ${payload.cutoverMessageId}`)
        }
        if (event.causationId !== message.openedEventId) {
          throw new Error(`Context coverage marker must be caused by its cutover assistant message`)
        }
        const knownPrior = state.assistantHistory.messages.some(
          (candidate) => candidate.sessionId === payload.sessionId && candidate.openedSeq < message.openedSeq,
        )
        if (knownPrior && payload.priorScopeHistory === "none") {
          throw new Error(`Context coverage marker cannot declare known prior history absent: ${payload.sessionId}`)
        }
        const assistantSession = state.assistantHistory.sessions.find(
          (candidate) => candidate.sessionId === payload.sessionId,
        )
        if (payload.copiedHistory === "excluded") {
          if (!assistantSession?.sourceSessionId || assistantSession.sourceSessionId !== payload.sourceSessionId) {
            throw new Error(`Context copied-history source does not match assistant session lineage`)
          }
        }
        state.contextHistory.sessions.push({
          sessionId: payload.sessionId,
          coverage: payload.priorScopeHistory === "none" ? "complete" : "partial",
          markerEventId: event.eventId,
          markerSeq: event.seq,
          priorScopeHistory: payload.priorScopeHistory,
          copiedHistory: payload.copiedHistory,
          ...(payload.sourceSessionId ? { sourceSessionId: payload.sourceSessionId } : {}),
          cutoverMessageId: payload.cutoverMessageId,
        })
        break
      }

      case "context_contribution_recorded": {
        const payload = event.payload as ContextContributionPayload
        if (isTerminalStatus(state.status)) {
          throw new Error(`Cannot record context contribution after run settlement: ${payload.messageId}`)
        }
        if (event.correlationId !== payload.messageId) {
          throw new Error(`Context contribution correlation does not match message: ${payload.messageId}`)
        }
        if (event.causationId !== payload.promptEventId) {
          throw new Error(`Context contribution must be caused by its prompt dispatch: ${payload.messageId}`)
        }
        const message = state.assistantHistory.messages.find((candidate) => candidate.messageId === payload.messageId)
        if (!message)
          throw new Error(`Context contribution references unopened assistant message: ${payload.messageId}`)
        if (message.settlement)
          throw new Error(`Context contribution references settled assistant message: ${payload.messageId}`)
        if (
          message.sessionId !== payload.sessionId ||
          message.providerId !== payload.providerId ||
          message.modelId !== payload.modelId
        ) {
          throw new Error(`Context contribution identity does not match opened assistant message: ${payload.messageId}`)
        }
        const marker = state.contextHistory.sessions.find(
          (candidate) => candidate.sessionId === payload.sessionId && candidate.markerEventId,
        )
        if (!marker) throw new Error(`Context contribution has no producer coverage marker: ${payload.sessionId}`)
        const enrolled =
          marker.cutoverMessageId === payload.messageId ||
          (marker.markerSeq !== null && message.openedSeq > marker.markerSeq)
        if (!enrolled) throw new Error(`Context contribution predates its session cutover: ${payload.messageId}`)

        const promptDispatch = state.promptHistory.dispatches.find(
          (dispatch) => dispatch.eventId === payload.promptEventId,
        )
        if (
          !promptDispatch ||
          promptDispatch.messageId !== payload.messageId ||
          promptDispatch.sessionId !== payload.sessionId ||
          promptDispatch.providerId !== payload.providerId ||
          promptDispatch.modelId !== payload.modelId ||
          promptDispatch.dispatchOrdinal !== payload.dispatchOrdinal
        ) {
          throw new Error(`Context contribution does not match its prompt dispatch: ${payload.messageId}`)
        }
        if (promptDispatch.commitment.canonicalization !== "provider-adapter-instructions-v2") {
          throw new Error(`Context contribution requires a partitioned prompt commitment: ${payload.messageId}`)
        }

        const partition = payload.partition
        if (recomputeProviderInputPartitionDigest(partition.atoms) !== partition.digest) {
          throw new Error(`Context contribution partition digest does not replay: ${payload.messageId}`)
        }
        const instructionOrdinals = partition.atoms
          .filter((atom) => atom.owner === "instruction")
          .map((atom) => atom.ordinal)
        const contextOrdinals = partition.atoms.filter((atom) => atom.owner === "context").map((atom) => atom.ordinal)
        if (
          JSON.stringify(instructionOrdinals) !== JSON.stringify(partition.instructionAtomOrdinals) ||
          JSON.stringify(contextOrdinals) !== JSON.stringify(partition.contextAtomOrdinals) ||
          instructionOrdinals.length + contextOrdinals.length !== partition.atoms.length
        ) {
          throw new Error(`Context contribution partition is not an exact complement: ${payload.messageId}`)
        }
        const locationKeys = partition.atoms.map((atom) => JSON.stringify(atom.location))
        if (new Set(locationKeys).size !== locationKeys.length) {
          throw new Error(`Context contribution atom locations are not unique: ${payload.messageId}`)
        }
        if (
          partition.atoms.some(
            (atom) =>
              (atom.origin === "transform_output" && atom.sourceOrdinals.length > 0) ||
              (atom.origin !== "transform_output" && atom.sourceOrdinals.length === 0) ||
              new Set(atom.sourceOrdinals).size !== atom.sourceOrdinals.length,
          )
        ) {
          throw new Error(`Context contribution source attribution is invalid: ${payload.messageId}`)
        }
        const promptPartition = promptDispatch.commitment.partition
        if (
          promptPartition.canonicalization !== partition.canonicalization ||
          promptPartition.digest !== partition.digest ||
          promptPartition.atomCount !== partition.atomCount ||
          JSON.stringify(promptPartition.instructionAtomOrdinals) !== JSON.stringify(instructionOrdinals) ||
          JSON.stringify(promptPartition.contextAtomOrdinals) !== JSON.stringify(contextOrdinals)
        ) {
          throw new Error(`Context contribution partition does not match prompt commitment: ${payload.messageId}`)
        }
        const existing = state.contextHistory.dispatches.filter((dispatch) => dispatch.messageId === payload.messageId)
        if (payload.dispatchOrdinal !== existing.length + 1) {
          throw new Error(
            `Context dispatch ordinal is not contiguous for ${payload.messageId}: expected ${existing.length + 1}, got ${payload.dispatchOrdinal}`,
          )
        }
        state.contextHistory.dispatches.push({
          ...payload,
          eventId: event.eventId,
          recordedAt: event.occurredAt,
        })
        break
      }

      case "tool_result_recorded": {
        const payload = event.payload as Extract<RunEventPayload, { type: "tool_result_recorded" }>["payload"]
        const invocation = state.invocations[payload.invocationId]
        if (!invocation) {
          throw new Error(`Tool result references unknown invocation: ${payload.invocationId}`)
        }
        if (event.correlationId !== payload.invocationId) {
          throw new Error(`Tool result correlation does not match invocation: ${payload.invocationId}`)
        }
        if (!invocation.authorizationEventId) {
          throw new Error(`Tool result has no authorization: ${payload.invocationId}`)
        }
        if (event.causationId !== invocation.authorizationEventId) {
          throw new Error(`Tool result authorization causation does not match invocation: ${payload.invocationId}`)
        }
        if (invocation.status !== "authorized") {
          throw new Error(
            `Cannot record tool result for invocation ${payload.invocationId} from status ${invocation.status}`,
          )
        }
        if (invocation.resultEventId) {
          throw new Error(`Invocation already has a terminal result: ${payload.invocationId}`)
        }
        invocation.resultEventId = event.eventId
        invocation.status = payload.status
        break
      }

      case "approval_requested": {
        if (isTerminalStatus(state.status)) {
          throw new Error(`Cannot request approval for terminal run ${state.runId}`)
        }
        if (state.status !== "waiting_approval" && !isLegalTransition(state.status, "waiting_approval")) {
          throw new Error(`Illegal transition from ${state.status} to waiting_approval`)
        }
        if (state.status !== "waiting_approval") {
          state.status = "waiting_approval"
        }
        const payload = event.payload as Extract<RunEventPayload, { type: "approval_requested" }>["payload"]
        if (state.approvals.some((approval) => approval.approvalId === payload.approvalId)) {
          throw new Error(`Approval already requested: ${payload.approvalId}`)
        }
        state.pendingApprovalIds.push(payload.approvalId)
        state.governance.budget.approvalsRequested += 1
        state.approvals.push({
          approvalId: payload.approvalId,
          approvalType: payload.approvalType,
          risk: payload.risk,
          title: payload.title ?? null,
          reason: payload.reason ?? null,
          expectedConsequence: payload.expectedConsequence ?? null,
          stepId: payload.stepId ?? null,
          context: payload.context ?? null,
          source: payload.source ?? null,
          correlationId: event.correlationId ?? null,
          requestedAt: event.occurredAt,
          status: "pending",
          decidedBy: null,
          decidedAt: null,
          comment: null,
        })
        break
      }

      case "approval_resolved": {
        const payload = event.payload as {
          approvalId: string
          decision: "approved" | "rejected" | "expired" | "cancelled"
          actor?: string | null
          comment?: string
          resolvedAt?: string
        }
        const record = state.approvals.find((approval) => approval.approvalId === payload.approvalId)
        if (!record) {
          throw new Error(`Approval resolution references unknown approval: ${payload.approvalId}`)
        }
        if (record.status !== "pending") {
          throw new Error(`Approval already resolved: ${payload.approvalId}`)
        }
        state.pendingApprovalIds = state.pendingApprovalIds.filter((id) => id !== payload.approvalId)
        record.status = payload.decision
        record.decidedBy = payload.actor ?? null
        record.decidedAt = payload.resolvedAt ?? event.occurredAt
        record.comment = payload.comment ?? null

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
        const payload = event.payload as Extract<RunEventPayload, { type: "mutation_recorded" }>["payload"]
        let receiptIds: string[]
        let changedPaths: string[]

        if ("receipt" in payload) {
          if (payload.receipt.runId !== state.runId) {
            throw new Error(
              `Mutation receipt ${payload.receipt.receiptId} belongs to ${payload.receipt.runId}, not ${state.runId}`,
            )
          }
          if (new Set(payload.observationWindowInvocationIds).size !== payload.observationWindowInvocationIds.length) {
            throw new Error(`Mutation observation window contains duplicate invocation identities`)
          }
          for (const invocationId of payload.observationWindowInvocationIds) {
            const invocation = state.invocations[invocationId]
            if (!invocation) {
              throw new Error(`Mutation observation references unknown invocation: ${invocationId}`)
            }
            if (invocation.status !== "authorized" && invocation.resultEventId === null) {
              throw new Error(
                `Mutation observation references invocation ${invocationId} without allowed execution authority`,
              )
            }
          }
          receiptIds = [payload.receipt.receiptId]
          changedPaths = payload.receipt.changedPaths
        } else {
          receiptIds = payload.receiptIds
          changedPaths = payload.changedPaths
        }

        for (const receiptId of receiptIds) {
          if (!state.governance.mutationReceiptIds.includes(receiptId)) {
            state.governance.mutationReceiptIds.push(receiptId)
          }
        }
        for (const path of changedPaths) {
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
          if (state.compactionHistory.sessions.some((session) => session.markerEventId &&
            !state.compactionHistory.attempts.some((attempt) => attempt.sessionId === session.sessionId))) {
            throw new Error(`Run cannot complete with a compaction marker lacking its first attempt`)
          }
          if (state.compactionHistory.attempts.some((attempt) => attempt.status === "open")) {
            throw new Error(`Run cannot complete with open compaction attempts`)
          }
          const unsettled = state.assistantHistory.messages
            .filter((message) => message.settlement === null)
            .map((message) => message.messageId)
          if (unsettled.length > 0) {
            throw new Error(`Run cannot complete with unsettled assistant messages: ${unsettled.join(", ")}`)
          }
          const missingPromptMessages = state.assistantHistory.messages.flatMap((message) => {
            const marker = state.promptHistory.sessions.find(
              (candidate) => candidate.sessionId === message.sessionId && candidate.markerEventId,
            )
            const enrolled = Boolean(
              marker &&
                (marker.cutoverMessageId === message.messageId ||
                  (marker.markerSeq !== null && message.openedSeq > marker.markerSeq)),
            )
            if (!enrolled || message.settlement?.status !== "completed") return []
            const dispatches = state.promptHistory.dispatches.filter(
              (dispatch) => dispatch.messageId === message.messageId,
            )
            const binding = message.settlement.promptDispatch
            if (
              !binding ||
              binding.count !== dispatches.length ||
              binding.finalEventId !== (dispatches.at(-1)?.eventId ?? null)
            ) {
              return [message.messageId]
            }
            return []
          })
          if (missingPromptMessages.length > 0) {
            throw new Error(`Run cannot complete with missing prompt provenance: ${missingPromptMessages.join(", ")}`)
          }
          const missingContextMessages = state.assistantHistory.messages.flatMap((message) => {
            const marker = state.contextHistory.sessions.find(
              (candidate) => candidate.sessionId === message.sessionId && candidate.markerEventId,
            )
            const enrolled = Boolean(
              marker &&
                (marker.cutoverMessageId === message.messageId ||
                  (marker.markerSeq !== null && message.openedSeq > marker.markerSeq)),
            )
            if (!enrolled || message.settlement?.status !== "completed") return []
            const dispatches = state.contextHistory.dispatches.filter(
              (dispatch) => dispatch.messageId === message.messageId,
            )
            const binding = message.settlement.contextDispatch
            if (
              !binding ||
              binding.count !== dispatches.length ||
              binding.finalEventId !== (dispatches.at(-1)?.eventId ?? null)
            ) {
              return [message.messageId]
            }
            return []
          })
          if (missingContextMessages.length > 0) {
            throw new Error(`Run cannot complete with missing context provenance: ${missingContextMessages.join(", ")}`)
          }
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
          const completedPayload = event.payload as { completionProof?: RunState["governance"]["completionProof"] }
          if (completedPayload?.completionProof) {
            state.governance.completionProof = completedPayload.completionProof
          }
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

  const recordedInvocationIds = new Set(state.delegationHistory.records.map((record) => record.invocationId))
  state.delegationHistory.missingInvocationIds = Object.values(state.invocations)
    .filter(
      (invocation) =>
        invocation.toolId === "task" &&
        invocation.status !== "awaiting_authorization" &&
        invocation.status !== "denied" &&
        !recordedInvocationIds.has(invocation.invocationId),
    )
    .map((invocation) => invocation.invocationId)

  const capturedCreations = new Set(
    state.delegationHistory.records
      .filter((record) => record.mode === "created")
      .map((record) => record.childSessionId),
  )
  state.delegationHistory.uncapturedCreationSessionIds = [
    ...new Set(
      state.delegationHistory.records
        .filter((record) => record.mode === "resumed" && !capturedCreations.has(record.childSessionId))
        .map((record) => record.childSessionId),
    ),
  ]

  const incomplete =
    state.delegationHistory.missingInvocationIds.length > 0 ||
    state.delegationHistory.uncapturedCreationSessionIds.length > 0
  state.delegationHistory.coverage = incomplete
    ? state.delegationHistory.records.length > 0
      ? "partial"
      : "unavailable"
    : "complete"

  const knownSessionIds = new Set<string>([
    state.runId,
    ...state.delegationHistory.records.map((record) => record.childSessionId),
    ...state.assistantHistory.sessions.map((session) => session.sessionId),
    ...state.assistantHistory.messages.map((message) => message.sessionId),
  ])
  for (const sessionId of knownSessionIds) {
    if (state.assistantHistory.sessions.some((session) => session.sessionId === sessionId)) continue
    state.assistantHistory.sessions.push({
      sessionId,
      coverage: "unavailable",
      markerEventId: null,
      priorScopeHistory: null,
      copiedHistory: null,
    })
  }
  state.assistantHistory.sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  state.assistantHistory.unsettledMessageIds = state.assistantHistory.messages
    .filter((message) => message.settlement === null)
    .map((message) => message.messageId)
  const markedSessions = state.assistantHistory.sessions.filter((session) => session.markerEventId !== null)
  state.assistantHistory.coverage =
    markedSessions.length === 0
      ? "unavailable"
      : state.assistantHistory.sessions.every((session) => session.coverage === "complete")
        ? "complete"
        : "partial"

  const promptKnownSessionIds = new Set<string>([
    ...knownSessionIds,
    ...state.promptHistory.sessions.map((session) => session.sessionId),
    ...state.promptHistory.dispatches.map((dispatch) => dispatch.sessionId),
  ])
  for (const sessionId of promptKnownSessionIds) {
    if (state.promptHistory.sessions.some((session) => session.sessionId === sessionId)) continue
    state.promptHistory.sessions.push({
      sessionId,
      coverage: "unavailable",
      markerEventId: null,
      markerSeq: null,
      priorScopeHistory: null,
      copiedHistory: null,
    })
  }
  state.promptHistory.sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  state.promptHistory.missingMessageIds = state.assistantHistory.messages.flatMap((message) => {
    const marker = state.promptHistory.sessions.find(
      (candidate) => candidate.sessionId === message.sessionId && candidate.markerEventId,
    )
    const enrolled = Boolean(
      marker &&
        (marker.cutoverMessageId === message.messageId ||
          (marker.markerSeq !== null && message.openedSeq > marker.markerSeq)),
    )
    if (!enrolled || message.settlement?.status !== "completed") return []
    const dispatches = state.promptHistory.dispatches.filter((dispatch) => dispatch.messageId === message.messageId)
    const binding = message.settlement.promptDispatch
    return binding &&
      binding.count === dispatches.length &&
      binding.finalEventId === (dispatches.at(-1)?.eventId ?? null)
      ? []
      : [message.messageId]
  })
  const promptMarkedSessions = state.promptHistory.sessions.filter((session) => session.markerEventId !== null)
  state.promptHistory.coverage =
    promptMarkedSessions.length === 0
      ? "unavailable"
      : state.promptHistory.sessions.every((session) => session.coverage === "complete") &&
          state.promptHistory.missingMessageIds.length === 0
        ? "complete"
        : "partial"

  const contextKnownSessionIds = new Set<string>([
    ...knownSessionIds,
    ...state.contextHistory.sessions.map((session) => session.sessionId),
    ...state.contextHistory.dispatches.map((dispatch) => dispatch.sessionId),
  ])
  for (const sessionId of contextKnownSessionIds) {
    if (state.contextHistory.sessions.some((session) => session.sessionId === sessionId)) continue
    state.contextHistory.sessions.push({
      sessionId,
      coverage: "unavailable",
      markerEventId: null,
      markerSeq: null,
      priorScopeHistory: null,
      copiedHistory: null,
    })
  }
  state.contextHistory.sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  state.contextHistory.missingMessageIds = state.assistantHistory.messages.flatMap((message) => {
    const marker = state.contextHistory.sessions.find(
      (candidate) => candidate.sessionId === message.sessionId && candidate.markerEventId,
    )
    const enrolled = Boolean(
      marker &&
        (marker.cutoverMessageId === message.messageId ||
          (marker.markerSeq !== null && message.openedSeq > marker.markerSeq)),
    )
    if (!enrolled || message.settlement?.status !== "completed") return []
    const dispatches = state.contextHistory.dispatches.filter((dispatch) => dispatch.messageId === message.messageId)
    const binding = message.settlement.contextDispatch
    return binding &&
      binding.count === dispatches.length &&
      binding.finalEventId === (dispatches.at(-1)?.eventId ?? null)
      ? []
      : [message.messageId]
  })
  const contextMarkedSessions = state.contextHistory.sessions.filter((session) => session.markerEventId !== null)
  state.contextHistory.coverage =
    contextMarkedSessions.length === 0
      ? "unavailable"
      : state.contextHistory.sessions.every((session) => session.coverage === "complete") &&
          state.contextHistory.missingMessageIds.length === 0
        ? "complete"
        : "partial"

  const compactionKnownSessionIds = new Set<string>([
    ...knownSessionIds,
    ...state.compactionHistory.sessions.map((session) => session.sessionId),
    ...state.compactionHistory.attempts.map((attempt) => attempt.sessionId),
  ])
  for (const sessionId of compactionKnownSessionIds) {
    if (state.compactionHistory.sessions.some((session) => session.sessionId === sessionId)) continue
    state.compactionHistory.sessions.push({
      sessionId,
      coverage: "unavailable",
      markerEventId: null,
      priorScopeHistory: null,
      copiedHistory: null,
      replacementEventId: null,
    })
  }
  state.compactionHistory.sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId))
  for (const session of state.compactionHistory.sessions) {
    if (!session.markerEventId) continue
    const attempts = state.compactionHistory.attempts.filter((attempt) => attempt.sessionId === session.sessionId)
    session.coverage = session.priorScopeHistory === "none" && attempts.length > 0 &&
      attempts.every((attempt) => attempt.status !== "open") ? "complete" : "partial"
  }
  state.compactionHistory.openAttemptEventIds = state.compactionHistory.attempts
    .filter((attempt) => attempt.status === "open")
    .map((attempt) => attempt.eventId)
  state.compactionHistory.coverage = state.compactionHistory.sessions.every(
    (session) => session.markerEventId && session.coverage === "complete",
  ) && state.compactionHistory.openAttemptEventIds.length === 0
    ? "complete"
    : state.compactionHistory.sessions.some((session) => session.markerEventId)
      ? "partial"
      : "unavailable"

  return state
}
