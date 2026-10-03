import { Session } from "@/session"
import { resolveExecutionAuthority } from "./contract-guardian"
import { getRunAuthority } from "@/state/events/run-event-store"
import {
  getEventAuthorityState,
  recordToolInvocation,
  recordCapabilityResolution,
  recordAuthorization,
  recordDelegation,
  recordToolResult,
  type ToolResultOutcome,
} from "@/state/events/event-transitions"
import { computeCanonicalCommitment } from "./canonical-commitment"
import { decideContractTool, type ExecutionContract } from "./execution-contract"
import { resolveCapabilityAuthority, type McpSource } from "@/capability/authority"
import { Instance } from "@/project/instance"
import { isMutatingTool } from "@/tool/tool-class"
import {
  discardNativeMutationObservation,
  NativeMutationObservationError,
  prepareNativeMutationObservation,
  settleNativeMutationObservation,
} from "./native-mutation-observation"
import type { AssistantDelegationReceipt } from "./assistant-provenance"

export type NativeExecutorKind = "builtin" | "plugin" | "mcp"
type PolicyDisposition = "allowed" | "denied" | "approval_required" | "not_evaluated"

type PendingInvocation = {
  authorityRunId: string
  contractId: string
  contractDisposition: "allowed" | "denied"
  authorizationEventId: string | null
  denied: boolean
  resultPending: boolean
  policyChecks: number
  runtimeGuardDisposition: PolicyDisposition
  permissionDisposition: PolicyDisposition
  approvalIds: Set<string>
  reasonCodes: Set<string>
  mutationObservationRequired: boolean
  mutationObservationPrepared: boolean
  mutationObservationError: NativeMutationObservationError | null
}

/** Process-local coordination only; canonical events remain the durable truth. */
const pending = new Map<string, PendingInvocation>()
const beginning = new Set<string>()

export class NativeSettlementAppendError extends Error {
  constructor(
    public readonly stage: "invocation" | "capability_resolution" | "authorization" | "delegation" | "result",
    public readonly invocationId: string,
    cause: unknown,
  ) {
    super(
      `Failed to durably record ${stage} for native invocation ${invocationId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
    this.name = "NativeSettlementAppendError"
  }
}

export class NativeSettlementStateError extends Error {
  constructor(
    public readonly invocationId: string,
    message: string,
  ) {
    super(`Native invocation ${invocationId} cannot proceed: ${message}`)
    this.name = "NativeSettlementStateError"
  }
}

export class NativeAuthorizationDeniedError extends Error {
  constructor(
    public readonly invocationId: string,
    public readonly reasonCode: string,
  ) {
    super(`Native invocation ${invocationId} was denied: ${reasonCode}`)
    this.name = "NativeAuthorizationDeniedError"
  }
}

export async function resolveNativeSettlementAuthority(
  sessionID: string,
): Promise<{
  canonical: boolean
  authorityRunId: string
  contractId: string
  contract: ExecutionContract
} | null> {
  const session = await Session.get(sessionID)
  const authority = await resolveExecutionAuthority(session.id, session.governingRunId)
  const authorityRunId = authority.governingRunId ?? session.id
  if (!authority.contract) return null
  const runAuthority = await getRunAuthority(authorityRunId)
  return {
    canonical: runAuthority === "event-log",
    authorityRunId,
    contractId: authority.contract.contractId,
    contract: authority.contract,
  }
}

export type BeginInvocationResult = { status: "not_canonical" } | { status: "recorded" }

/**
 * Target evidence for the shared lookup. Only the built-in read, write and
 * edit tools have one validated `filePath` that is their whole target, and
 * the built-in task tool's whole target is the agent it starts. Anything else
 * that looks like a path or an agent is not proof of scope.
 */
function nativeFilesystemTarget(kind: NativeExecutorKind, toolId: string, args: unknown) {
  // The built-in task tool's whole target is the agent it starts.
  if (kind === "builtin" && toolId === "task") {
    if (typeof args !== "object" || args === null || !("subagent_type" in args)) return undefined
    return typeof args.subagent_type === "string" && args.subagent_type ? { agent: args.subagent_type } : undefined
  }
  if (kind !== "builtin" || !["read", "write", "edit"].includes(toolId)) return undefined
  if (typeof args !== "object" || args === null || !("filePath" in args)) return undefined
  return typeof args.filePath === "string" ? { paths: [args.filePath] } : undefined
}

/**
 * Records one new governed attempt. Re-dispatch of an existing invocation ID
 * is rejected: after a crash DAX cannot know whether an external effect
 * occurred, so idempotent event append must never re-enter the executor.
 */
export async function beginNativeInvocation(params: {
  sessionID: string
  invocationId: string
  toolId: string
  executor: { kind: NativeExecutorKind; id: string }
  /**
   * The selected executor's descriptor, from its binding; `undefined` for a
   * legacy executor that has none. Required, so a dispatch path cannot forget
   * it and have a built-in recorded as unenrolled. Used only for the
   * record-only capability resolution; it takes no part in the contract
   * decision below.
   */
  capability: unknown
  /** Where an MCP identity was minted from, so a source selector can be proven. */
  source?: McpSource
  args: unknown
  originTurnId?: string
  parentInvocationId?: string
  ordinal?: number
}): Promise<BeginInvocationResult> {
  if (pending.has(params.invocationId) || beginning.has(params.invocationId)) {
    throw new NativeSettlementStateError(params.invocationId, "the invocation identity is already in progress")
  }

  beginning.add(params.invocationId)
  try {
    // An activated reviewed run is governed by its published contract, under
    // enforcement. Every other run, including a reviewed run that is not
    // activated, takes the existing path, where the review barrier refuses it.
    const session = await Session.get(params.sessionID)
    const reviewedRunId = session.governingRunId ?? session.id
    const { GrantReview } = await import("@/capability/grant-review")
    const reviewed = await GrantReview.dispatchAuthority(reviewedRunId)
    if (reviewed) return await beginReviewedInvocation(params, reviewedRunId, reviewed)

    const authority = await resolveNativeSettlementAuthority(params.sessionID)
    if (!authority || !authority.canonical) return { status: "not_canonical" }

    const existing = await getEventAuthorityState(authority.authorityRunId)
    if (existing?.invocations?.[params.invocationId]) {
      throw new NativeSettlementStateError(
        params.invocationId,
        "canonical history already contains this attempt; automatic replay is unsafe",
      )
    }

    const input = await computeCanonicalCommitment(params.args)
    try {
      await recordToolInvocation(authority.authorityRunId, params.invocationId, {
        toolId: params.toolId,
        input: { basis: "validated_tool_input", ...input },
        contractId: authority.contractId,
        executor: params.executor,
        originTurnId: params.originTurnId,
        parentInvocationId: params.parentInvocationId,
        ordinal: params.ordinal,
      })
    } catch (error) {
      throw new NativeSettlementAppendError("invocation", params.invocationId, error)
    }

    // The shared lookup's conclusion, written beside the invocation and before
    // its authorization. It is a shadow: the decision enforced below is still
    // the existing contract rule, and the two are recorded as different events.
    const resolution = resolveCapabilityAuthority({
      path: params.parentInvocationId ? "batch_leaf" : params.executor.kind === "mcp" ? "mcp_tool" : "native_tool",
      initiator: "model",
      contract: authority.contract,
      authorityRunId: authority.authorityRunId,
      executor: { kind: params.executor.kind, alias: params.toolId, descriptor: params.capability },
      source: params.source,
      target: nativeFilesystemTarget(params.executor.kind, params.toolId, params.args),
      directory: Instance.directory,
      worktree: Instance.worktree,
    })
    try {
      await recordCapabilityResolution(authority.authorityRunId, { subjectId: params.invocationId, ...resolution })
    } catch (error) {
      throw new NativeSettlementAppendError("capability_resolution", params.invocationId, error)
    }

    // Decided for the executor that was selected, not for its alias.
    const contractDecision = decideContractTool(authority.contract, params.toolId, params.executor)
    pending.set(params.invocationId, {
      authorityRunId: authority.authorityRunId,
      contractId: authority.contractId,
      contractDisposition: contractDecision.allowed ? "allowed" : "denied",
      authorizationEventId: null,
      denied: false,
      resultPending: false,
      policyChecks: 0,
      runtimeGuardDisposition: "not_evaluated",
      permissionDisposition: "not_evaluated",
      approvalIds: new Set(),
      reasonCodes: new Set(),
      // Built-in mutation semantics come from the existing canonical tool
      // classifier. Plugins and MCP are conservatively observed because their
      // executor contract does not promise workspace purity.
      mutationObservationRequired: params.executor.kind !== "builtin" || isMutatingTool(params.toolId),
      mutationObservationPrepared: false,
      mutationObservationError: null,
    })
    const state = pending.get(params.invocationId)!
    if (!contractDecision.allowed) {
      state.reasonCodes.add(contractDecision.reasonCode)
      await appendAuthorization(params.invocationId, state, "denied")
      throw new NativeAuthorizationDeniedError(params.invocationId, contractDecision.reasonCode)
    }
    return { status: "recorded" }
  } finally {
    beginning.delete(params.invocationId)
  }
}

/**
 * Stage 4b: one invocation of an activated reviewed run. Recorded exactly as a
 * governed invocation is, with the enforced decision taking the place of the
 * v1 contract rule: a denial is settled before anything runs, and an allowed
 * invocation still passes every existing permission check and the runtime
 * guard before its authorization is sealed.
 */
async function beginReviewedInvocation(
  params: Parameters<typeof beginNativeInvocation>[0],
  runId: string,
  reviewed: NonNullable<Awaited<ReturnType<typeof import("@/capability/grant-review").GrantReview.dispatchAuthority>>>,
): Promise<BeginInvocationResult> {
  if ((await getRunAuthority(runId)) !== "event-log") return { status: "not_canonical" }
  const existing = await getEventAuthorityState(runId)
  if (existing?.invocations?.[params.invocationId]) {
    throw new NativeSettlementStateError(
      params.invocationId,
      "canonical history already contains this attempt; automatic replay is unsafe",
    )
  }
  const contract = reviewed.published.contract
  const input = await computeCanonicalCommitment(params.args)
  try {
    await recordToolInvocation(runId, params.invocationId, {
      toolId: params.toolId,
      input: { basis: "validated_tool_input", ...input },
      contractId: contract.contractId,
      executor: params.executor,
      originTurnId: params.originTurnId,
      parentInvocationId: params.parentInvocationId,
      ordinal: params.ordinal,
    })
  } catch (error) {
    throw new NativeSettlementAppendError("invocation", params.invocationId, error)
  }

  const { captureDispatchSnapshot } = await import("@/capability/grant-review-snapshot")
  const { decideReviewedAction, enforcedRecord, settleAsk, recheckAfterWait } = await import("@/capability/enforcement")
  const { GrantReview } = await import("@/capability/grant-review")
  // Decided from the authority and implementation as they are at the moment
  // of deciding; called again after any wait for the operator.
  const decideNow = async (authority: typeof reviewed | undefined) => {
    if (!authority) return undefined
    return decideReviewedAction({
      contract: authority.published.contract,
      contractDigest: authority.published.contractDigest,
      activation: authority.activation,
      resolve: {
        path: params.parentInvocationId ? "batch_leaf" : params.executor.kind === "mcp" ? "mcp_tool" : "native_tool",
        initiator: "model",
        authorityRunId: runId,
        executor: { kind: params.executor.kind, alias: params.toolId, descriptor: params.capability },
        source: params.source,
        target: nativeFilesystemTarget(params.executor.kind, params.toolId, params.args),
        directory: Instance.directory,
        worktree: Instance.worktree,
      },
      current: await captureDispatchSnapshot(authority.published.contract),
    })
  }
  const decided = (await decideNow(reviewed))!
  // A remembered approval satisfies an ask here; otherwise the ask is recorded
  // first and the operator is asked before the authorization is decided.
  const { resolution, satisfied } = await settleAsk(runId, decided)
  try {
    await recordCapabilityResolution(runId, {
      subjectId: params.invocationId,
      ...(enforcedRecord(resolution) as Omit<Parameters<typeof recordCapabilityResolution>[1], "subjectId">),
    })
  } catch (error) {
    throw new NativeSettlementAppendError("capability_resolution", params.invocationId, error)
  }

  let allowed = satisfied
  let askReason: string | undefined
  let expiredAsk: string | undefined
  if (resolution.decision === "ask" && !satisfied && resolution.askSubject) {
    const { askOperator } = await import("@/capability/grant-ask")
    const answer = await askOperator(runId, params.invocationId, resolution.askSubject)
    allowed = answer.decision === "approved"
    if (!allowed) askReason = answer.decision === "expired" ? "grant_ask_expired" : "grant_ask_denied"
    if (answer.decision === "expired") expiredAsk = answer.approvalId
    // The approval answered one exact ask. Whatever changed while waiting is
    // decided again now, and a changed authority or binding denies.
    if (allowed) {
      const stale = await recheckAfterWait(resolution, async () =>
        decideNow(await GrantReview.dispatchAuthority(runId)),
      )
      if (stale) {
        allowed = false
        askReason = stale
      }
    }
  }
  pending.set(params.invocationId, {
    authorityRunId: runId,
    contractId: contract.contractId,
    contractDisposition: allowed ? "allowed" : "denied",
    authorizationEventId: null,
    denied: false,
    resultPending: false,
    policyChecks: 0,
    runtimeGuardDisposition: "not_evaluated",
    permissionDisposition: "not_evaluated",
    approvalIds: new Set(),
    reasonCodes: new Set(),
    mutationObservationRequired: params.executor.kind !== "builtin" || isMutatingTool(params.toolId),
    mutationObservationPrepared: false,
    mutationObservationError: null,
  })
  if (!allowed) {
    const state = pending.get(params.invocationId)!
    const reasonCode = askReason ?? resolution.reasonCode ?? "grant_denied"
    state.reasonCodes.add(reasonCode)
    try {
      // The denial is recorded first; only then is a timed-out ask closed.
      await appendAuthorization(params.invocationId, state, "denied")
    } finally {
      // Never left authorizable in this process, even if the denial could
      // not be written; the ask's deadline keeps it so on replay.
      state.denied = true
      pending.delete(params.invocationId)
    }
    if (expiredAsk) await (await import("@/capability/grant-ask")).expireAsk(runId, expiredAsk)
    throw new NativeAuthorizationDeniedError(params.invocationId, reasonCode)
  }
  return { status: "recorded" }
}

export function isNativeSettlementPending(invocationId: string): boolean {
  return pending.has(invocationId)
}

export function requireNativeSettlementPending(invocationId: string): void {
  if (!pending.has(invocationId)) {
    throw new NativeSettlementStateError(invocationId, "canonical invocation coordination is missing")
  }
}

export type AuthorizationDisposition = {
  finalDisposition: "allowed" | "denied"
  runtimeGuardDisposition: PolicyDisposition
  permissionDisposition: PolicyDisposition
  approvalIds: string[]
  reasonCodes: string[]
}

function mergeDisposition(current: PolicyDisposition, next: PolicyDisposition): PolicyDisposition {
  if (current === "denied" || next === "denied") return "denied"
  if (current === "approval_required" || next === "approval_required") return "approval_required"
  if (current === "allowed" || next === "allowed") return "allowed"
  return "not_evaluated"
}

function accumulate(state: PendingInvocation, disposition: AuthorizationDisposition): void {
  state.policyChecks++
  state.runtimeGuardDisposition = mergeDisposition(state.runtimeGuardDisposition, disposition.runtimeGuardDisposition)
  state.permissionDisposition = mergeDisposition(state.permissionDisposition, disposition.permissionDisposition)
  for (const id of disposition.approvalIds) state.approvalIds.add(id)
  for (const code of disposition.reasonCodes) state.reasonCodes.add(code)
}

async function appendAuthorization(
  invocationId: string,
  state: PendingInvocation,
  finalDisposition: "allowed" | "denied",
): Promise<void> {
  let updated: Awaited<ReturnType<typeof recordAuthorization>>
  try {
    updated = await recordAuthorization(state.authorityRunId, invocationId, {
      finalDisposition,
      contractDisposition: state.contractDisposition,
      runtimeGuardDisposition: state.runtimeGuardDisposition,
      permissionDisposition: state.permissionDisposition,
      approvalIds: [...state.approvalIds],
      reasonCodes: [...state.reasonCodes],
    })
  } catch (error) {
    throw new NativeSettlementAppendError("authorization", invocationId, error)
  }

  if (finalDisposition === "denied") {
    state.denied = true
    pending.delete(invocationId)
    return
  }

  const eventId = updated.invocations?.[invocationId]?.authorizationEventId ?? null
  if (!eventId) {
    throw new NativeSettlementAppendError(
      "authorization",
      invocationId,
      new Error("no authorization event id projected"),
    )
  }
  state.authorizationEventId = eventId
}

/** Accumulates one successful policy checkpoint without releasing execution. */
export function noteNativePolicyDecision(invocationId: string, disposition: AuthorizationDisposition): void {
  const state = pending.get(invocationId)
  if (!state) throw new NativeSettlementStateError(invocationId, "policy ran without a pending invocation")
  if (state.authorizationEventId || state.denied) {
    throw new NativeSettlementStateError(invocationId, "policy ran after final authorization")
  }
  accumulate(state, disposition)
}

/** Records a final denial immediately; denied invocations never have results. */
export async function denyNativeAuthorization(
  invocationId: string,
  disposition: AuthorizationDisposition,
): Promise<void> {
  const state = pending.get(invocationId)
  if (!state) throw new NativeSettlementStateError(invocationId, "denial has no pending invocation")
  if (state.authorizationEventId || state.denied) {
    throw new NativeSettlementStateError(invocationId, "authorization is already final")
  }
  accumulate(state, disposition)
  await appendAuthorization(invocationId, state, "denied")
}

/** Durably seals the combined allowed decision before hooks or execution. */
export async function completeNativeAuthorization(invocationId: string): Promise<void> {
  const state = pending.get(invocationId)
  if (!state) throw new NativeSettlementStateError(invocationId, "authorization has no pending invocation")
  if (state.denied) throw new NativeSettlementStateError(invocationId, "authorization was denied")
  if (state.authorizationEventId) {
    if (state.mutationObservationError) throw state.mutationObservationError
    if (state.mutationObservationRequired && !state.mutationObservationPrepared) {
      throw new NativeSettlementStateError(invocationId, "mutation observation is not prepared")
    }
    return
  }
  if (state.policyChecks === 0) {
    throw new NativeSettlementStateError(invocationId, "no material policy checkpoint was evaluated")
  }
  await appendAuthorization(invocationId, state, "allowed")
  if (state.mutationObservationRequired) {
    try {
      await prepareNativeMutationObservation(state.authorityRunId, invocationId)
      state.mutationObservationPrepared = true
    } catch (error) {
      state.mutationObservationError =
        error instanceof NativeMutationObservationError
          ? error
          : new NativeMutationObservationError(state.authorityRunId, "baseline", String(error), { cause: error })
      throw state.mutationObservationError
    }
  }
}

/** Compatibility/test helper for a caller holding a complete disposition. */
export async function settleNativeAuthorization(
  invocationId: string,
  disposition: AuthorizationDisposition,
): Promise<void> {
  if (disposition.finalDisposition === "denied") {
    await denyNativeAuthorization(invocationId, disposition)
    return
  }
  noteNativePolicyDecision(invocationId, disposition)
  await completeNativeAuthorization(invocationId)
}

export function isNativeInvocationAuthorized(invocationId: string): boolean {
  return Boolean(pending.get(invocationId)?.authorizationEventId)
}

/**
 * Durably records which child an authorized task invocation selected. This is
 * dispatch intent, not evidence that the child model started or completed.
 * Durable reducer validation under the run lock remains the authority check.
 */
export async function recordNativeDelegation(
  invocationId: string,
  details: {
    parentSessionId: string
    childSessionId: string
    agent: string
    mode: "created" | "resumed"
  },
): Promise<AssistantDelegationReceipt> {
  const state = pending.get(invocationId)
  if (!state) throw new NativeSettlementStateError(invocationId, "delegation has no pending invocation")
  if (state.denied) throw new NativeSettlementStateError(invocationId, "delegation authorization was denied")
  if (!state.authorizationEventId) {
    throw new NativeSettlementStateError(invocationId, "delegation arrived before durable authorization")
  }
  if (state.resultPending) {
    throw new NativeSettlementStateError(invocationId, "delegation arrived while terminal settlement was pending")
  }

  try {
    const updated = await recordDelegation(state.authorityRunId, invocationId, state.authorizationEventId, details)
    const record = updated.delegationHistory.records.find((candidate) => candidate.invocationId === invocationId)
    if (!record) throw new Error("delegation event did not project")
    return {
      kind: "task_delegated",
      invocationId,
      delegationEventId: record.eventId,
      authorizationEventId: record.authorizationEventId,
      parentSessionId: record.parentSessionId,
      agent: record.agent,
      mode: record.mode,
    }
  } catch (error) {
    throw new NativeSettlementAppendError("delegation", invocationId, error)
  }
}

/**
 * Records terminal truth. Failed appends retain pending state, preventing a
 * repeated begin() from re-entering an executor whose effect may have occurred.
 */
export async function finalizeNativeResult(invocationId: string, outcome: ToolResultOutcome): Promise<void> {
  const state = pending.get(invocationId)
  if (!state) throw new NativeSettlementStateError(invocationId, "result has no pending invocation")
  if (state.denied) return
  if (!state.authorizationEventId) {
    throw new NativeSettlementStateError(invocationId, "result arrived before durable authorization")
  }
  if (state.resultPending) {
    throw new NativeSettlementStateError(invocationId, "a terminal result append is already in progress")
  }

  state.resultPending = true
  try {
    // Kernel evidence is durable before the terminal result can become a
    // model-visible success. Failed/cancelled executions are observed too: an
    // executor can mutate before it throws or is cancelled.
    if (state.mutationObservationPrepared) {
      await settleNativeMutationObservation(state.authorityRunId, invocationId)
    }
    await recordToolResult(state.authorityRunId, invocationId, state.authorizationEventId, outcome)
    pending.delete(invocationId)
  } catch (error) {
    state.resultPending = false
    if (error instanceof NativeMutationObservationError) throw error
    throw new NativeSettlementAppendError("result", invocationId, error)
  }
}

/** Test/diagnostic seam. Production code must not use this for recovery. */
export function discardNativeSettlement(invocationId: string): void {
  const state = pending.get(invocationId)
  if (state?.mutationObservationPrepared) {
    discardNativeMutationObservation(state.authorityRunId, invocationId)
  }
  pending.delete(invocationId)
  beginning.delete(invocationId)
}
