import { Log } from "@/util/log"
import { Tracer } from "@/runtime/telemetry"
import { ApprovalContextSchema, type Approval, type ApprovalStatus, type ApprovalType, type ApprovalContext } from "./approval-types"
import { ApprovalStore } from "./approval-store"
import { Bus } from "@/bus"
import { Lifecycle } from "@/bus/lifecycle"
import { toApprovalRecordV1 } from "./approval-adapter"
import { getRunAuthority, hasRunEvents, projectRunStateFromEvents } from "@/state/events/run-event-store"
import { addApprovalEvent, resolveApprovalEvent } from "@/state/events/event-transitions"

type CreateApprovalParams = {
  runId: string
  stepId?: string | null
  type: ApprovalType
  risk: "low" | "medium" | "high" | "critical"
  title: string
  reason: string
  context?: ApprovalContext
  expectedConsequence?: string
  source?: "workflow" | "permission" | "system" | "manual"
  /** The native invocation this approval authorizes, when there is one. */
  correlationId?: string
}

const log = Log.create({ service: "approval-transitions" })

async function usesCanonicalApprovalAuthority(runId: string): Promise<boolean> {
  const authority = await getRunAuthority(runId)
  if (authority === "event-log") return true
  if (authority === "legacy") return false
  if (await hasRunEvents(runId)) {
    throw new Error(`Run ${runId} has canonical events without a run authority marker`)
  }
  return false
}

export class ApprovalAlreadyResolvedError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly currentStatus: ApprovalStatus,
  ) {
    super(`Approval ${approvalId} has already been resolved with status: ${currentStatus}`)
    this.name = "ApprovalAlreadyResolvedError"
  }
}

export class ApprovalNotFoundError extends Error {
  constructor(public readonly approvalId: string) {
    super(`Approval ${approvalId} not found`)
    this.name = "ApprovalNotFoundError"
  }
}

// Generate a deterministic hash for approval IDs
async function generateDeterministicApprovalId(params: CreateApprovalParams): Promise<string> {
  const stepId = params.stepId || "no_step"
  const input = `${params.runId}:${stepId}:${params.reason}:${params.type}`

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return `apr_${hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .substring(0, 16)}`
  }

  // Fallback hash
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }
  return `apr_${Math.abs(hash).toString(16).padStart(8, "0")}`
}

export async function createAndPersistApproval(params: CreateApprovalParams): Promise<Approval> {
  const approvalId = await generateDeterministicApprovalId(params)

  const approval: Approval = {
    approvalId,
    runId: params.runId,
    stepId: params.stepId ?? null,
    type: params.type,
    risk: params.risk,
    title: params.title,
    reason: params.reason,
    context: params.context,
    expectedConsequence: params.expectedConsequence,
    status: "pending",
    requestedAt: new Date().toISOString(),
    resolvedAt: null,
    actor: null,
    source: params.source ?? "workflow",
    resolution: null,
  }

  if (await usesCanonicalApprovalAuthority(params.runId)) {
    const state = await addApprovalEvent(params.runId, approvalId, {
      approvalType: params.type,
      risk: params.risk,
      title: params.title,
      reason: params.reason,
      expectedConsequence: params.expectedConsequence,
      stepId: params.stepId,
      context: params.context,
      source: approval.source,
      correlationId: params.correlationId,
    })
    const recorded = state.approvals.find((candidate) => candidate.approvalId === approvalId)
    const expectedContext = params.context ? ApprovalContextSchema.strict().parse(params.context) : null
    const mismatchedFields = !recorded
      ? ["approval"]
      : [
          recorded.approvalType !== params.type ? "type" : null,
          recorded.risk !== params.risk ? "risk" : null,
          recorded.title !== params.title ? "title" : null,
          recorded.reason !== params.reason ? "reason" : null,
          recorded.expectedConsequence !== (params.expectedConsequence ?? null) ? "expectedConsequence" : null,
          recorded.stepId !== (params.stepId ?? null) ? "stepId" : null,
          recorded.source !== approval.source ? "source" : null,
          !approvalContextsEqual(recorded.context, expectedContext) ? "context" : null,
        ].filter((field): field is string => field !== null)
    if (mismatchedFields.length > 0) {
      throw new Error(
        `Canonical approval request ${approvalId} does not match the requested authority fact: ${mismatchedFields.join(", ")}`,
      )
    }
  }

  // The canonical request is admitted first. The compatibility store may be
  // repaired by retry; it must never be the only durable authority record.
  const existing = await ApprovalStore.get(params.runId, approvalId)
  if (existing) {
    log.debug("approval already exists, skipping compatibility creation", { runId: params.runId, approvalId })
    return existing
  }

  await ApprovalStore.add(params.runId, approval)

  await Bus.publish(Lifecycle.ApprovalRequested, {
    runId: params.runId,
    approval: toApprovalRecordV1(approval),
  })

  await Bus.publish(Lifecycle.InterventionRequired, {
    runId: params.runId,
    reason: params.reason,
    type: params.source === "permission" ? "policy_violation" : "hitl_task",
    approvalId,
  })

  Tracer.approvalRequested(params.runId, approvalId, params.type, params.risk)

  log.info("approval created", {
    runId: params.runId,
    approvalId,
    type: params.type,
    risk: params.risk,
  })

  return approval
}

export async function approveApproval(
  runId: string,
  approvalId: string,
  actorId?: string,
  comment?: string,
): Promise<Approval> {
  const approval = await ApprovalStore.get(runId, approvalId)
  const canonical = await usesCanonicalApprovalAuthority(runId)
  const state = canonical ? await projectRunStateFromEvents(runId) : null
  const canonicalApproval = state?.approvals.find((candidate) => candidate.approvalId === approvalId)
  if (!approval && !canonicalApproval) throw new ApprovalNotFoundError(approvalId)
  if (approval && !isPending(approval.status)) throw new ApprovalAlreadyResolvedError(approvalId, approval.status)

  const resolvedAt = new Date().toISOString()
  if (canonical) {
    const resolvedState = await resolveApprovalEvent(runId, approvalId, "approved", actorId ?? null, comment, resolvedAt)
    assertCanonicalResolution(resolvedState, approvalId, "approved", actorId ?? null, comment)
  }

  if (!approval && canonicalApproval) {
    await ApprovalStore.add(runId, approvalFromCanonical(runId, canonicalApproval))
  }

  const resolved = await ApprovalStore.resolve(runId, approvalId, {
    decision: "approve",
    actorId,
    comment,
  })

  if (!resolved) {
    throw new ApprovalNotFoundError(approvalId)
  }

  Tracer.approvalResolved(runId, approvalId, "approve")

  await Bus.publish(Lifecycle.ApprovalResolved, {
    runId: runId,
    approvalId,
    decision: "approve",
    comment,
  })

  log.info("approval approved", { runId, approvalId, actorId })

  return resolved
}

export async function denyApproval(
  runId: string,
  approvalId: string,
  actorId?: string,
  comment?: string,
): Promise<Approval> {
  const approval = await ApprovalStore.get(runId, approvalId)
  const canonical = await usesCanonicalApprovalAuthority(runId)
  const state = canonical ? await projectRunStateFromEvents(runId) : null
  const canonicalApproval = state?.approvals.find((candidate) => candidate.approvalId === approvalId)
  if (!approval && !canonicalApproval) throw new ApprovalNotFoundError(approvalId)
  if (approval && !isPending(approval.status)) throw new ApprovalAlreadyResolvedError(approvalId, approval.status)

  const resolvedAt = new Date().toISOString()
  if (canonical) {
    const resolvedState = await resolveApprovalEvent(runId, approvalId, "rejected", actorId ?? null, comment, resolvedAt)
    assertCanonicalResolution(resolvedState, approvalId, "rejected", actorId ?? null, comment)
  }

  if (!approval && canonicalApproval) {
    await ApprovalStore.add(runId, approvalFromCanonical(runId, canonicalApproval))
  }

  const resolved = await ApprovalStore.resolve(runId, approvalId, {
    decision: "deny",
    actorId,
    comment,
  })

  if (!resolved) {
    throw new ApprovalNotFoundError(approvalId)
  }

  Tracer.approvalResolved(runId, approvalId, "deny")

  await Bus.publish(Lifecycle.ApprovalResolved, {
    runId: runId,
    approvalId,
    decision: "deny",
    comment,
  })

  log.info("approval denied", { runId, approvalId, actorId })

  return resolved
}

export async function expireApproval(runId: string, approvalId: string): Promise<Approval> {
  const approval = await ApprovalStore.get(runId, approvalId)
  const canonical = await usesCanonicalApprovalAuthority(runId)
  const state = canonical ? await projectRunStateFromEvents(runId) : null
  const canonicalApproval = state?.approvals.find((candidate) => candidate.approvalId === approvalId)
  if (!approval && !canonicalApproval) throw new ApprovalNotFoundError(approvalId)
  if (approval && !isPending(approval.status)) throw new ApprovalAlreadyResolvedError(approvalId, approval.status)

  const resolvedAt = new Date().toISOString()
  if (canonical) {
    const resolvedState = await resolveApprovalEvent(runId, approvalId, "expired", null, undefined, resolvedAt)
    assertCanonicalResolution(resolvedState, approvalId, "expired", null, undefined)
  }
  if (!approval && canonicalApproval) await ApprovalStore.add(runId, approvalFromCanonical(runId, canonicalApproval))

  const updated = await ApprovalStore.update(runId, approvalId, (a: Approval) => ({
    ...a,
    status: "expired" as ApprovalStatus,
    resolvedAt,
    actor: null,
    resolution: null,
  }))

  if (!updated) {
    throw new ApprovalNotFoundError(approvalId)
  }

  log.info("approval expired", { runId, approvalId })

  return updated
}

export async function cancelApproval(runId: string, approvalId: string): Promise<Approval> {
  const approval = await ApprovalStore.get(runId, approvalId)
  const canonical = await usesCanonicalApprovalAuthority(runId)
  const state = canonical ? await projectRunStateFromEvents(runId) : null
  const canonicalApproval = state?.approvals.find((candidate) => candidate.approvalId === approvalId)
  if (!approval && !canonicalApproval) throw new ApprovalNotFoundError(approvalId)
  if (approval && !isPending(approval.status)) throw new ApprovalAlreadyResolvedError(approvalId, approval.status)

  const resolvedAt = new Date().toISOString()
  if (canonical) {
    const resolvedState = await resolveApprovalEvent(runId, approvalId, "cancelled", null, undefined, resolvedAt)
    assertCanonicalResolution(resolvedState, approvalId, "cancelled", null, undefined)
  }
  if (!approval && canonicalApproval) await ApprovalStore.add(runId, approvalFromCanonical(runId, canonicalApproval))

  const updated = await ApprovalStore.update(runId, approvalId, (a: Approval) => ({
    ...a,
    status: "cancelled" as ApprovalStatus,
    resolvedAt,
    actor: null,
    resolution: null,
  }))

  if (!updated) {
    throw new ApprovalNotFoundError(approvalId)
  }

  log.info("approval cancelled", { runId, approvalId })

  return updated
}

export async function getPendingCount(runId: string): Promise<number> {
  const pending = await ApprovalStore.pending(runId)
  return pending.length
}

export async function hasPendingApprovals(runId: string): Promise<boolean> {
  const pending = await ApprovalStore.pending(runId)
  return pending.length > 0
}

export async function attachToRun(runId: string, approval: Approval): Promise<void> {
  await ApprovalStore.add(runId, approval)
}

function isPending(status: ApprovalStatus): boolean {
  return status === "pending"
}

function approvalContextsEqual(left: ApprovalContext | null, right: ApprovalContext | null): boolean {
  if (left === null || right === null) return left === right
  return (
    left.stepId === right.stepId &&
    left.filePath === right.filePath &&
    left.command === right.command &&
    left.toolName === right.toolName &&
    left.diffPreview === right.diffPreview &&
    left.originalPermissionId === right.originalPermissionId &&
    JSON.stringify(left.notes ?? []) === JSON.stringify(right.notes ?? [])
  )
}

function assertCanonicalResolution(
  state: Awaited<ReturnType<typeof resolveApprovalEvent>>,
  approvalId: string,
  decision: "approved" | "rejected" | "expired" | "cancelled",
  actor: string | null,
  comment: string | undefined,
): void {
  const recorded = state.approvals.find((candidate) => candidate.approvalId === approvalId)
  if (
    !recorded ||
    recorded.status !== decision ||
    recorded.decidedBy !== actor ||
    recorded.comment !== (comment ?? null)
  ) {
    throw new Error(`Canonical approval resolution ${approvalId} does not match the requested authority fact`)
  }
}

function approvalFromCanonical(
  runId: string,
  approval: NonNullable<Awaited<ReturnType<typeof projectRunStateFromEvents>>>["approvals"][number],
): Approval {
  return {
    approvalId: approval.approvalId,
    runId,
    stepId: approval.stepId,
    type: approval.approvalType as ApprovalType,
    risk: approval.risk as Approval["risk"],
    title: approval.title ?? "Approval required",
    reason: approval.reason ?? "Canonical approval request",
    context: approval.context ?? undefined,
    expectedConsequence: approval.expectedConsequence ?? undefined,
    status: "pending",
    requestedAt: approval.requestedAt,
    resolvedAt: null,
    actor: null,
    source: approval.source ?? "workflow",
    resolution: null,
  }
}

export namespace ApprovalTransitions {
  /**
   * Creates a new approval request.
   * @param params - Approval creation parameters
   * @returns Created approval
   */
  export async function create(params: CreateApprovalParams): Promise<Approval> {
    return createAndPersistApproval(params)
  }

  /**
   * Approves a pending approval.
   * @param runId - Run ID
   * @param approvalId - Approval ID to approve
   * @param actorId - Optional actor ID
   * @param comment - Optional approval comment
   * @returns Updated approval
   */
  export async function approve(
    runId: string,
    approvalId: string,
    actorId?: string,
    comment?: string,
  ): Promise<Approval> {
    return approveApproval(runId, approvalId, actorId, comment)
  }

  export async function deny(runId: string, approvalId: string, actorId?: string, comment?: string): Promise<Approval> {
    return denyApproval(runId, approvalId, actorId, comment)
  }

  export async function expire(runId: string, approvalId: string): Promise<Approval> {
    return expireApproval(runId, approvalId)
  }

  export async function cancel(runId: string, approvalId: string): Promise<Approval> {
    return cancelApproval(runId, approvalId)
  }

  export async function resolve(
    runId: string,
    approvalId: string,
    resolution: { decision: "approve" | "deny"; actorId?: string; comment?: string },
  ): Promise<Approval | null> {
    if (resolution.decision === "approve") {
      return approveApproval(runId, approvalId, resolution.actorId, resolution.comment)
    } else {
      return denyApproval(runId, approvalId, resolution.actorId, resolution.comment)
    }
  }

  export async function pendingCount(runId: string): Promise<number> {
    return getPendingCount(runId)
  }

  export async function hasPending(runId: string): Promise<boolean> {
    return hasPendingApprovals(runId)
  }

  export async function attach(runId: string, approval: Approval): Promise<void> {
    return attachToRun(runId, approval)
  }
}
