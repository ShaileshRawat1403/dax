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

export const ScopePolicy = z.object({
  targetFiles: z.string().array().default([]),
  targetSubsystems: z.string().array().default([]),
  avoidAreas: z.string().array().default([]),
})
export type ScopePolicy = z.infer<typeof ScopePolicy>

export const MutationBudgetPolicy = z.object({
  maxFilesTouched: z.number().int().positive().default(8),
  maxMutatingCommands: z.number().int().positive().default(6),
  maxApprovalRequests: z.number().int().positive().default(4),
  maxRepeatedFailures: z.number().int().positive().default(3),
})
export type MutationBudgetPolicy = z.infer<typeof MutationBudgetPolicy>

export const PostconditionPolicy = z.object({
  verificationRequired: z.boolean().default(false),
  validationPlan: z.string().array().default([]),
  validationCommands: z.string().array().default([]),
})
export type PostconditionPolicy = z.infer<typeof PostconditionPolicy>

export const SensitivityPolicy = z.object({
  sensitivePatterns: z.string().array().default([]),
  forbiddenPatterns: z.string().array().default([]),
})
export type SensitivityPolicy = z.infer<typeof SensitivityPolicy>

const FieldProvenanceEnum = z.enum(["operator-authored", "operator-confirmed", "inferred-unreviewed"])

export const RuntimePolicy = z.object({
  scope: ScopePolicy,
  budgets: MutationBudgetPolicy,
  postconditions: PostconditionPolicy,
  sensitivity: SensitivityPolicy,
  /** Per-field provenance for worker_run scope (see WorkerConstraints.ScopeProvenance). */
  provenance: z.object({
    writeScope: FieldProvenanceEnum,
    forbiddenPaths: FieldProvenanceEnum,
    verification: FieldProvenanceEnum,
  }).optional(),
  /**
   * Governed-worker network egress confinement (worker_run). Absent means the
   * default: filter on with the provider host allowlist. `filter: false` is the
   * operator escape hatch; `allowHosts` widens the allowlist. Enforced by the
   * run's forward proxy (see worker/egress-allowlist.ts).
   */
  egress: z.object({
    filter: z.boolean().default(true),
    allowHosts: z.string().array().default([]),
  }).optional(),
})
export type RuntimePolicy = z.infer<typeof RuntimePolicy>

export const ExecutionContract = z.object({
  schemaVersion: SchemaVersion.default("v1"),
  contractId: z.string(),
  contractInstanceId: z.string().optional(),
  contractDigest: z.string().optional(),
  runId: z.string(),
  workflowClass: WorkflowClassSchema,
  workflowHint: WorkflowClassSchema.optional(),
  workflowHintAccepted: z.boolean().optional(),
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
  runtimePolicy: RuntimePolicy.optional(),
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
  contractInstanceId: z.string().optional(),
  contractDigest: z.string().optional(),
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
