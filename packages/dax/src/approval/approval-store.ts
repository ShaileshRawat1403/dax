import { Storage } from "@/storage/storage"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import type { Approval } from "./approval-types"
import { ApprovalSchema, isPending, isTerminal } from "./approval-types"

const log = Log.create({ service: "approval-store" })

async function storagePath(runId: string): Promise<string[]> {
  return ["approvals", Instance.project.id, runId]
}

export async function readApprovals(runId: string): Promise<Approval[]> {
  try {
    const approvals = await Storage.read<Approval[]>(await storagePath(runId))
    return approvals
  } catch (error) {
    if (Storage.NotFoundError.isInstance(error)) {
      return []
    }
    log.error("failed to read approvals", { error, runId })
    throw error
  }
}

export async function writeApprovals(runId: string, approvals: Approval[]): Promise<void> {
  try {
    await Storage.write(await storagePath(runId), approvals)
  } catch (error) {
    log.error("failed to write approvals", { error, runId })
    throw error
  }
}

export async function addApproval(runId: string, approval: Approval): Promise<Approval> {
  const approvals = await readApprovals(runId)

  const existing = approvals.find((a) => a.approvalId === approval.approvalId)
  if (existing) {
    log.warn("approval already exists, returning existing", { runId, approvalId: approval.approvalId })
    return existing
  }

  const updated = [...approvals, approval]
  await writeApprovals(runId, updated)
  log.info("approval added", { runId, approvalId: approval.approvalId })

  return approval
}

export async function getApproval(runId: string, approvalId: string): Promise<Approval | null> {
  const approvals = await readApprovals(runId)
  return approvals.find((a) => a.approvalId === approvalId) ?? null
}

export async function updateApproval(
  runId: string,
  approvalId: string,
  updater: (approval: Approval) => Approval,
): Promise<Approval | null> {
  const approvals = await readApprovals(runId)
  const index = approvals.findIndex((a) => a.approvalId === approvalId)

  if (index === -1) {
    log.warn("approval not found for update", { runId, approvalId })
    return null
  }

  const updated = updater(approvals[index])
  const newApprovals = [...approvals]
  newApprovals[index] = updated
  await writeApprovals(runId, newApprovals)

  log.info("approval updated", { runId, approvalId, newStatus: updated.status })

  return updated
}

export async function getPendingApprovals(runId: string): Promise<Approval[]> {
  const approvals = await readApprovals(runId)
  return approvals.filter((a) => isPending(a.status))
}

export async function getTerminalApprovals(runId: string): Promise<Approval[]> {
  const approvals = await readApprovals(runId)
  return approvals.filter((a) => isTerminal(a.status))
}

export async function getApprovalIds(runId: string): Promise<string[]> {
  const approvals = await readApprovals(runId)
  return approvals.map((a) => a.approvalId)
}

export async function deleteApproval(runId: string, approvalId: string): Promise<boolean> {
  const approvals = await readApprovals(runId)
  const index = approvals.findIndex((a) => a.approvalId === approvalId)

  if (index === -1) {
    return false
  }

  const updated = approvals.filter((a) => a.approvalId !== approvalId)
  await writeApprovals(runId, updated)
  log.info("approval deleted", { runId, approvalId })

  return true
}

export async function resolveApproval(
  runId: string,
  approvalId: string,
  resolution: { decision: "approve" | "deny"; actorId?: string; comment?: string },
): Promise<Approval | null> {
  // Single read-check-write cycle to minimize TOCTOU window
  const approvals = await readApprovals(runId)
  const index = approvals.findIndex((a) => a.approvalId === approvalId)

  if (index === -1) {
    log.warn("approval not found for resolution", { runId, approvalId })
    return null
  }

  const existing = approvals[index]

  if (!isPending(existing.status)) {
    log.warn("approval already resolved", { runId, approvalId, currentStatus: existing.status })
    return existing
  }

  const now = new Date().toISOString()
  const updated: Approval = {
    ...existing,
    status: resolution.decision === "approve" ? "approved" : "denied",
    resolvedAt: now,
    actor: resolution.actorId ?? null,
    resolution: {
      decision: resolution.decision,
      actorId: resolution.actorId,
      comment: resolution.comment,
      resolvedAt: now,
    },
  }

  const newApprovals = [...approvals]
  newApprovals[index] = updated
  await writeApprovals(runId, newApprovals)
  log.info("approval resolved", { runId, approvalId, decision: resolution.decision })

  return updated
}

export namespace ApprovalStore {
  export async function getApprovals(runId: string): Promise<Approval[]> {
    return readApprovals(runId)
  }

  export async function get(runId: string, approvalId: string): Promise<Approval | null> {
    return getApproval(runId, approvalId)
  }

  export async function add(runId: string, approval: Approval): Promise<Approval> {
    return addApproval(runId, approval)
  }

  export async function update(
    runId: string,
    approvalId: string,
    updater: (approval: Approval) => Approval,
  ): Promise<Approval | null> {
    return updateApproval(runId, approvalId, updater)
  }

  export async function resolve(
    runId: string,
    approvalId: string,
    resolution: { decision: "approve" | "deny"; actorId?: string; comment?: string },
  ): Promise<Approval | null> {
    return resolveApproval(runId, approvalId, resolution)
  }

  export async function pending(runId: string): Promise<Approval[]> {
    return getPendingApprovals(runId)
  }

  export async function terminal(runId: string): Promise<Approval[]> {
    return getTerminalApprovals(runId)
  }

  export async function ids(runId: string): Promise<string[]> {
    return getApprovalIds(runId)
  }

  export async function remove(runId: string, approvalId: string): Promise<boolean> {
    return deleteApproval(runId, approvalId)
  }
}
