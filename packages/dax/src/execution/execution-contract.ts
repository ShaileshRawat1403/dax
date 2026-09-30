import z from "zod"
import { AntigravityConversationOptions } from "@/worker/antigravity-stream"
import {
  WorkflowClassSchema,
  ExecutionModeSchema,
  RiskLevelSchema,
  EXECUTION_MODE_DEFAULTS,
  RISK_TO_APPROVAL_MODE,
} from "./workflow-class"
import type { WorkflowClass, ExecutionMode, RiskLevel } from "./workflow-class"
import { isNativeToolAlias } from "@/capability/native-alias"
import { CapabilityGrants } from "@/capability/grant"

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
  workerConversation: AntigravityConversationOptions.optional(),
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

const ExecutionContractBase = z.object({
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
  /** Required for v2; absent in historical v1 contracts. Never inferred on replay. */
  capabilityGrants: CapabilityGrants.optional(),
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
/** The executable contract. The runtime is v1-only: a v1 contract cannot carry grants. */
export const ExecutionContract = ExecutionContractBase.superRefine((contract, ctx) => {
  if (contract.capabilityGrants !== undefined) {
    ctx.addIssue({ code: "custom", path: ["capabilityGrants"], message: "v1 contract cannot claim capability grants" })
  }
})
export type ExecutionContract = z.infer<typeof ExecutionContract>

/**
 * Candidate wire format, inactive. Nothing in production writes, reads or
 * executes it: the guardian accepts only `ExecutionContract`. It exists so the
 * shared resolver's grant path can be specified and tested before activation.
 */
export const ExecutionContractV2 = ExecutionContractBase.omit({ schemaVersion: true, capabilityGrants: true }).extend({
  schemaVersion: z.literal("v2"),
  capabilityGrants: CapabilityGrants,
})
export type ExecutionContractV2 = z.infer<typeof ExecutionContractV2>

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

/**
 * Contract tool authority is independent of whether a registry happens to
 * expose a tool. An absent contract preserves the native pre-contract path;
 * an empty allowlist means no allowlist restriction, matching existing prompt
 * filtering semantics. A blocklist always takes precedence.
 */
export function isToolAllowedByContract(
  contract: Pick<ExecutionContract, "toolAllowlist" | "toolBlocklist"> | null | undefined,
  toolId: string,
): boolean {
  if (!contract) return true
  if (contract.toolBlocklist.includes(toolId)) return false
  return contract.toolAllowlist.length === 0 || contract.toolAllowlist.includes(toolId)
}

export type ContractToolDecision =
  | { allowed: true }
  | { allowed: false; reasonCode: "contract_tool_denied" | "contract_alias_executor_mismatch" }

/**
 * Contract tool authority for the executor that was actually selected.
 *
 * A v1 contract names tools by alias. The alias of a DAX built-in denotes that
 * built-in. An executor that is not a built-in but holds a built-in's alias,
 * such as a plugin named `read`, is not what the allowlist entry names, so the
 * entry does not cover it: it cannot inherit the built-in's authority, or its
 * place in a read-only contract, by sharing a name.
 *
 * This only narrows. A blocked alias stays blocked for every executor, an
 * absent contract and an empty allowlist behave as before, and a stored
 * contract is read exactly as it was written. It applies to executions that
 * start now; it does not change how a recorded decision replays.
 */
export function decideContractTool(
  contract: Pick<ExecutionContract, "toolAllowlist" | "toolBlocklist"> | null | undefined,
  toolId: string,
  executor: { kind: "builtin" | "plugin" | "mcp" },
): ContractToolDecision {
  if (!isToolAllowedByContract(contract, toolId)) return { allowed: false, reasonCode: "contract_tool_denied" }
  if (
    contract &&
    contract.toolAllowlist.length > 0 &&
    executor.kind !== "builtin" &&
    isNativeToolAlias(toolId)
  ) {
    return { allowed: false, reasonCode: "contract_alias_executor_mismatch" }
  }
  return { allowed: true }
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
