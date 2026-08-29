import { Session } from "@/session"
import { resolveExecutionAuthority } from "./contract-guardian"
import { getRunAuthority } from "@/state/events/run-event-store"
import {
  getEventAuthorityState,
  recordToolInvocation,
  recordAuthorization,
  recordToolResult,
  type ToolResultOutcome,
} from "@/state/events/event-transitions"
import { computeCanonicalCommitment } from "./canonical-commitment"
import { isToolAllowedByContract, type ExecutionContract } from "./execution-contract"
import { isMutatingTool } from "@/tool/tool-class"
import {
  discardNativeMutationObservation,
  NativeMutationObservationError,
  prepareNativeMutationObservation,
  settleNativeMutationObservation,
} from "./native-mutation-observation"

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
    public readonly stage: "invocation" | "authorization" | "result",
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
 * Records one new governed attempt. Re-dispatch of an existing invocation ID
 * is rejected: after a crash DAX cannot know whether an external effect
 * occurred, so idempotent event append must never re-enter the executor.
 */
export async function beginNativeInvocation(params: {
  sessionID: string
  invocationId: string
  toolId: string
  executor: { kind: NativeExecutorKind; id: string }
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

    pending.set(params.invocationId, {
      authorityRunId: authority.authorityRunId,
      contractId: authority.contractId,
      contractDisposition: isToolAllowedByContract(authority.contract, params.toolId) ? "allowed" : "denied",
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
    if (state.contractDisposition === "denied") {
      state.reasonCodes.add("contract_tool_denied")
      await appendAuthorization(params.invocationId, state, "denied")
      throw new NativeAuthorizationDeniedError(params.invocationId, "contract_tool_denied")
    }
    return { status: "recorded" }
  } finally {
    beginning.delete(params.invocationId)
  }
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
