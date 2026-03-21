import z from "zod"
import {
  WorkflowClassSchema,
  ExecutionModeSchema,
  RiskLevelSchema,
  EXECUTION_MODE_DEFAULTS,
  RISK_TO_APPROVAL_MODE,
} from "./workflow-class"
import type { WorkflowClass, ExecutionMode, RiskLevel } from "./workflow-class"

export const SchemaVersion = z.literal("v1")
export type SchemaVersion = z.infer<typeof SchemaVersion>

export const ApprovalPolicy = z.object({
  mode: z.enum(["auto", "approval_gated", "manual"]),
  requireForRiskAbove: RiskLevelSchema.optional(),
  toolCategories: z.enum(["edit", "shell", "external", "dangerous"]).array().optional(),
})
export type ApprovalPolicy = z.infer<typeof ApprovalPolicy>

export const OutputContract = z.object({
  type: z.enum(["file", "diff", "report", "summary", "patch"]),
  description: z.string(),
  pathHint: z.string().optional(),
})
export type OutputContract = z.infer<typeof OutputContract>

export const RetryPolicy = z.object({
  maxAttempts: z.number().min(1).max(5).default(1),
  backoffMs: z.number().min(0).default(1000),
  retryableErrors: z.string().array().optional(),
})
export type RetryPolicy = z.infer<typeof RetryPolicy>

export const FallbackPolicy = z.object({
  action: z.enum(["fail", "retry", "skip_step", "notify"]),
  notifyOnFallback: z.boolean().default(false),
})
export type FallbackPolicy = z.infer<typeof FallbackPolicy>

export const ExecutionContract = z.object({
  schemaVersion: SchemaVersion.default("v1"),
  contractId: z.string(),
  runId: z.string(),
  workflowClass: WorkflowClassSchema,
  intent: z.string(),
  executionMode: ExecutionModeSchema,
  riskLevel: RiskLevelSchema,
  toolAllowlist: z.string().array(),
  toolBlocklist: z.string().array(),
  approvalPolicy: ApprovalPolicy,
  expectedOutputs: OutputContract.array(),
  timeoutMs: z.number().min(60000).max(3600000).default(1800000),
  fallbackPolicy: FallbackPolicy.optional(),
  retryPolicy: RetryPolicy.optional(),
  providerHint: z.string().optional(),
  modelHint: z.string().optional(),
  repoPath: z.string().optional(),
  branch: z.string().optional(),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  initiatedBy: z.string().optional(),
  createdAt: z.string(),
})
export type ExecutionContract = z.infer<typeof ExecutionContract>

export const ExecutionContractMeta = z.object({
  contractId: z.string(),
  runId: z.string(),
  workflowClass: WorkflowClassSchema,
  executionMode: ExecutionModeSchema,
  riskLevel: RiskLevelSchema,
  createdAt: z.string(),
})
export type ExecutionContractMeta = z.infer<typeof ExecutionContractMeta>

export function isValidContract(contract: unknown): contract is ExecutionContract {
  return ExecutionContract.safeParse(contract).success
}

export function getContractSummary(contract: ExecutionContract): {
  contractId: string
  workflowClass: WorkflowClass
  executionMode: ExecutionMode
  riskLevel: RiskLevel
  toolCount: number
} {
  return {
    contractId: contract.contractId,
    workflowClass: contract.workflowClass,
    executionMode: contract.executionMode,
    riskLevel: contract.riskLevel,
    toolCount: contract.toolAllowlist.length,
  }
}

export function deriveExecutionMode(
  workflowClass: WorkflowClass,
  riskLevel: RiskLevel,
  explicitMode?: string,
): ExecutionMode {
  if (explicitMode === "auto" || explicitMode === "approval_gated" || explicitMode === "manual") {
    return explicitMode
  }
  const workflowDefault = EXECUTION_MODE_DEFAULTS[workflowClass]
  const riskOverride = RISK_TO_APPROVAL_MODE[riskLevel]
  if (riskOverride === "manual" || workflowDefault === "manual") return "manual"
  if (riskOverride === "approval_gated" || workflowDefault === "approval_gated") return "approval_gated"
  return "auto"
}
