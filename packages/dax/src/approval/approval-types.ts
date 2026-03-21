import { z } from "zod"

export const ApprovalStatusSchema = z.enum(["pending", "approved", "denied", "expired", "cancelled"])
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>

export const ApprovalTypeSchema = z.enum(["file_write", "command_execute", "patch_apply", "tool_use", "workflow_gate"])
export type ApprovalType = z.infer<typeof ApprovalTypeSchema>

export const ApprovalSourceSchema = z.enum(["workflow", "permission", "system", "manual"])
export type ApprovalSource = z.infer<typeof ApprovalSourceSchema>

export const ApprovalContextSchema = z.object({
  stepId: z.string().optional(),
  filePath: z.string().optional(),
  command: z.string().optional(),
  toolName: z.string().optional(),
  diffPreview: z.string().optional(),
  notes: z.array(z.string()).optional(),
  originalPermissionId: z.string().optional(),
})
export type ApprovalContext = z.infer<typeof ApprovalContextSchema>

export const ApprovalResolutionSchema = z.object({
  decision: z.enum(["approve", "deny"]),
  actorId: z.string().optional(),
  comment: z.string().optional(),
  resolvedAt: z.string(),
})
export type ApprovalResolution = z.infer<typeof ApprovalResolutionSchema>

export const ApprovalSchema = z.object({
  approvalId: z.string(),
  runId: z.string(),
  stepId: z.string().nullable(),
  type: ApprovalTypeSchema,
  risk: z.enum(["low", "medium", "high", "critical"]),
  title: z.string(),
  reason: z.string(),
  context: ApprovalContextSchema.optional(),
  expectedConsequence: z.string().optional(),
  status: ApprovalStatusSchema,
  requestedAt: z.string(),
  resolvedAt: z.string().nullable(),
  actor: z.string().nullable(),
  source: ApprovalSourceSchema,
  resolution: ApprovalResolutionSchema.nullable(),
})
export type Approval = z.infer<typeof ApprovalSchema>

export const PENDING_STATUSES: ApprovalStatus[] = ["pending"]
export const TERMINAL_STATUSES: ApprovalStatus[] = ["approved", "denied", "expired", "cancelled"]
export const ALL_STATUSES: ApprovalStatus[] = [...PENDING_STATUSES, ...TERMINAL_STATUSES]

export function isPending(status: ApprovalStatus): boolean {
  return status === "pending"
}

export function isTerminal(status: ApprovalStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function canTransition(from: ApprovalStatus, to: ApprovalStatus): boolean {
  if (from !== "pending") return false
  return to === "approved" || to === "denied" || to === "expired" || to === "cancelled"
}

export function createApproval(params: {
  approvalId: string
  runId: string
  stepId?: string | null
  type: ApprovalType
  risk: "low" | "medium" | "high" | "critical"
  title: string
  reason: string
  context?: ApprovalContext
  expectedConsequence?: string
  source?: ApprovalSource
}): Approval {
  return {
    approvalId: params.approvalId,
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
}
