import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { ApprovalStore } from "./approval-store"
import {
  type Approval,
  type ApprovalStatus,
  type ApprovalType,
  type ApprovalContext,
  type ApprovalSource,
  createApproval as createApprovalObject,
  type ApprovalResolution,
} from "./approval-types"
import { Tracer } from "@/runtime/telemetry"

const log = Log.create({ service: "approval-transitions" })

export class IllegalApprovalTransitionError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly fromStatus: ApprovalStatus,
    public readonly toStatus: ApprovalStatus,
  ) {
    super(`Illegal approval transition for "${approvalId}" from "${fromStatus}" to "${toStatus}"`)
    this.name = "IllegalApprovalTransitionError"
  }
}

export class ApprovalNotFoundError extends Error {
  constructor(public readonly approvalId: string) {
    super(`Approval not found: ${approvalId}`)
    this.name = "ApprovalNotFoundError"
  }
}

export class ApprovalAlreadyResolvedError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly currentStatus: ApprovalStatus,
  ) {
    super(`Approval "${approvalId}" already resolved with status "${currentStatus}"`)
    this.name = "ApprovalAlreadyResolvedError"
  }
}

export interface CreateApprovalParams {
  runId: string
  stepId?: string | null
  type: ApprovalType
  risk: "low" | "medium" | "high" | "critical"
  title: string
  reason: string
  context?: ApprovalContext
  expectedConsequence?: string
  source?: ApprovalSource
}

export async function createAndPersistApproval(params: CreateApprovalParams): Promise<Approval> {
  const approvalId = `apr_${Identifier.create("permission", false)}`

  const approval = createApprovalObject({
    approvalId,
    runId: params.runId,
    stepId: params.stepId,
    type: params.type,
    risk: params.risk,
    title: params.title,
    reason: params.reason,
    context: params.context,
    expectedConsequence: params.expectedConsequence,
    source: params.source ?? "workflow",
  })

  await ApprovalStore.add(params.runId, approval)

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

  if (!approval) {
    throw new ApprovalNotFoundError(approvalId)
  }

  if (!isPending(approval.status)) {
    throw new ApprovalAlreadyResolvedError(approvalId, approval.status)
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

  if (!approval) {
    throw new ApprovalNotFoundError(approvalId)
  }

  if (!isPending(approval.status)) {
    throw new ApprovalAlreadyResolvedError(approvalId, approval.status)
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

  log.info("approval denied", { runId, approvalId, actorId })

  return resolved
}

export async function expireApproval(runId: string, approvalId: string): Promise<Approval> {
  const approval = await ApprovalStore.get(runId, approvalId)

  if (!approval) {
    throw new ApprovalNotFoundError(approvalId)
  }

  if (!isPending(approval.status)) {
    throw new ApprovalAlreadyResolvedError(approvalId, approval.status)
  }

  const updated = await ApprovalStore.update(runId, approvalId, (a) => ({
    ...a,
    status: "expired" as ApprovalStatus,
    resolvedAt: new Date().toISOString(),
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

  if (!approval) {
    throw new ApprovalNotFoundError(approvalId)
  }

  if (!isPending(approval.status)) {
    throw new ApprovalAlreadyResolvedError(approvalId, approval.status)
  }

  const updated = await ApprovalStore.update(runId, approvalId, (a) => ({
    ...a,
    status: "cancelled" as ApprovalStatus,
    resolvedAt: new Date().toISOString(),
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

export namespace ApprovalTransitions {
  export async function create(params: CreateApprovalParams): Promise<Approval> {
    return createAndPersistApproval(params)
  }

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
