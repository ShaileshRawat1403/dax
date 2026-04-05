import { Log } from "@/util/log"
import type { Approval, ApprovalType } from "@/approval/approval-types"
import { ApprovalTransitions } from "@/approval/approval-transitions"

const log = Log.create({ service: "permission-adapter" })

export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  createdAt: number
  tool?: { callID?: string }
  metadata?: {
    command?: string
    filePath?: string
    path?: string
    diff?: string
    files?: any[]
  }
}

function inferApprovalType(permission: string): ApprovalType {
  const lower = permission.toLowerCase()
  if (lower === "shell") return "command_execute"
  if (lower.includes("patch")) return "patch_apply"
  if (lower.includes("write") || lower.includes("edit")) return "file_write"
  return "tool_use"
}

function inferRiskLevel(permission: string, type: ApprovalType): "low" | "medium" | "high" | "critical" {
  if (type === "command_execute") return "high"
  if (type === "file_write" || type === "patch_apply") return "medium"
  return "low"
}

function buildTitle(permission: string): string {
  const action = permission.charAt(0).toUpperCase() + permission.slice(1).toLowerCase()
  return `${action} requires approval`
}

function buildReason(patterns: string[]): string {
  if (patterns.length === 0) return "Permission request"
  return patterns.join(", ")
}

/**
 * Adapts a permission request to an approval.
 * Converts runtime permission requests into approval workflow.
 * @param request - Permission request to adapt
 * @param stepId - Optional step ID
 * @returns Created approval
 */
export async function adaptPermissionRequest(request: PermissionRequest, stepId?: string): Promise<Approval> {
  const type = inferApprovalType(request.permission)
  const risk = inferRiskLevel(request.permission, type)

  const approval = await ApprovalTransitions.create({
    runId: request.sessionID,
    stepId: stepId ?? request.tool?.callID,
    type,
    risk,
    title: buildTitle(request.permission),
    reason: buildReason(request.patterns),
    context: {
      stepId: request.tool?.callID,
      filePath: request.metadata?.filePath ?? request.metadata?.path,
      command: request.metadata?.command,
      toolName: request.permission,
      notes: request.patterns.length > 0 ? request.patterns : undefined,
      originalPermissionId: request.id,
      diffPreview: request.metadata?.diff,
    },
    source: "permission",
  })

  log.info("adapted permission to approval", {
    permissionId: request.id,
    approvalId: approval.approvalId,
    runId: request.sessionID,
    type,
    risk,
  })

  return approval
}

/**
 * Resolves a permission request from user reply.
 * @param runId - Run ID
 * @param permissionId - Permission ID to resolve
 * @param reply - User reply (allow, deny, reject)
 */
export async function resolveFromPermissionReply(
  runId: string,
  permissionId: string,
  reply: "allow" | "deny" | "reject",
): Promise<void> {
  const approvals = await import("@/approval/approval-store").then((m) => m.ApprovalStore.getApprovals(runId))
  const approval = approvals.find((a) => a.approvalId === permissionId || a.context?.stepId === permissionId)

  if (!approval) {
    log.warn("no matching approval found for permission reply", { runId, permissionId })
    return
  }

  if (reply === "reject" || reply === "deny") {
    await ApprovalTransitions.deny(runId, approval.approvalId, "system", `Permission reply: ${reply}`)
  } else {
    await ApprovalTransitions.approve(runId, approval.approvalId, "system", `Permission reply: ${reply}`)
  }
}

export namespace PermissionAdapter {
  export async function adapt(request: PermissionRequest, stepId?: string): Promise<Approval> {
    return adaptPermissionRequest(request, stepId)
  }

  export async function resolve(
    runId: string,
    permissionId: string,
    reply: "allow" | "deny" | "reject",
  ): Promise<void> {
    return resolveFromPermissionReply(runId, permissionId, reply)
  }
}
