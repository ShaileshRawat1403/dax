import { z } from "zod"

export const StepErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
})
export type StepError = z.infer<typeof StepErrorSchema>

export const StepRecordSchema = z.object({
  stepId: z.string(),
  title: z.string(),
  type: z.enum(["proposed", "executed", "approved", "rejected"]),
  status: z.enum(["proposed", "running", "completed", "failed", "blocked"]),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  error: StepErrorSchema.nullable(),
  outputs: z.array(z.string()),
})
export type StepRecord = z.infer<typeof StepRecordSchema>

export const TrustSummarySchema = z.object({
  posture: z.enum(["low", "guarded", "moderate", "strong"]),
  score: z.number().nullable(),
  blocked: z.boolean().default(false),
  reasons: z.array(z.string()).default([]),
})
export type TrustSummary = z.infer<typeof TrustSummarySchema>

export const RunErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
})
export type RunError = z.infer<typeof RunErrorSchema>

export const BaselineCheckpointSchema = z.object({
  baselineRef: z.string().optional(),
  snapshotId: z.string().optional(),
  createdAt: z.string(),
})
export type BaselineCheckpoint = z.infer<typeof BaselineCheckpointSchema>

export const VerificationStateSchema = z.object({
  required: z.boolean().default(false),
  satisfied: z.boolean().default(false),
  receiptIds: z.string().array().default([]),
})
export type VerificationState = z.infer<typeof VerificationStateSchema>

export const RuntimeGovernanceSchema = z.object({
  guardEnforcementMode: z.enum(["warn", "enforce"]).default("warn"),
  budget: z.object({
    maxFilesTouched: z.number().int().positive().default(8),
    maxMutatingCommands: z.number().int().positive().default(6),
    maxApprovalRequests: z.number().int().positive().default(4),
    maxRepeatedFailures: z.number().int().positive().default(3),
    filesTouched: z.number().int().nonnegative().default(0),
    mutatingCommands: z.number().int().nonnegative().default(0),
    approvalsRequested: z.number().int().nonnegative().default(0),
  }),
  providerPressure: z
    .object({
      lane: z.string().optional(),
      throttles: z.number().int().nonnegative().default(0),
      inFlight: z.number().int().nonnegative().default(0),
      queueLength: z.number().int().nonnegative().default(0),
    })
    .default({
      throttles: 0,
      inFlight: 0,
      queueLength: 0,
    }),
  touchedFiles: z.string().array().default([]),
  baselineCheckpoint: BaselineCheckpointSchema.nullable().default(null),
  mutationReceiptIds: z.string().array().default([]),
  verification: VerificationStateSchema.default({
    required: false,
    satisfied: false,
    receiptIds: [],
  }),
  planQuality: z
    .object({
      score: z.number().int().min(0).max(100),
      decision: z.enum(["proceed", "pause"]),
      failedChecks: z.array(z.string()).default([]),
      guidance: z.array(z.string()).default([]),
      checkedAt: z.string(),
    })
    .nullable()
    .default(null),
  completionProof: z
    .object({
      decision: z.enum(["pass", "fail"]),
      failedChecks: z.array(z.string()).default([]),
      verificationExecuted: z.boolean().default(false),
      receiptIds: z.string().array().default([]),
      artifactChecks: z.boolean().default(true),
      expectedOutputChecks: z.boolean().default(true),
      expectedOutputTypesSatisfied: z.string().array().default([]),
      expectedOutputTypesMissing: z.string().array().default([]),
      scopeChecks: z.boolean().default(true),
      sensitivePathApprovalChecks: z.boolean().default(true),
      checkedAt: z.string(),
    })
    .nullable()
    .default(null),
  failureCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
})
export type RuntimeGovernance = z.infer<typeof RuntimeGovernanceSchema>

export const RunStatusSchema = z.enum([
  "created",
  "compiled",
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
])
export type RunStatus = z.infer<typeof RunStatusSchema>

export const RunStateSchema = z.object({
  runId: z.string(),
  contractId: z.string(),
  status: RunStatusSchema,
  currentStepId: z.string().nullable(),
  steps: StepRecordSchema.array(),
  pendingApprovalIds: z.string().array(),
  // Mirrors the reducer projection (state/events/run-reducer.ts). The two
  // RunState declarations are a duplication in their own right; keeping them in
  // step is the interim, collapsing them into one is follow-on work.
  approvals: z
    .object({
      approvalId: z.string(),
      approvalType: z.string(),
      risk: z.string(),
      title: z.string().nullable(),
      reason: z.string().nullable(),
      expectedConsequence: z.string().nullable(),
      stepId: z.string().nullable(),
      status: z.enum(["pending", "approved", "rejected"]),
      decidedBy: z.string().nullable(),
      decidedAt: z.string().nullable(),
    })
    .array()
    .default([]),
  evidence: z
    .object({
      contract: z
        .object({
          writeScope: z.string().array(),
          forbiddenPaths: z.string().array(),
          verification: z.string().array(),
          provenance: z.record(z.string(), z.string()).nullable(),
        })
        .nullable(),
      sandbox: z
        .object({
          provider: z.string(),
          providerId: z.string().nullable(),
          filesystem: z.string(),
          network: z.string(),
          reapedDescendants: z.boolean(),
          egress: z.string().nullable(),
          egressEnforcement: z.string().nullable(),
          egressAllowHosts: z.string().array(),
        })
        .nullable(),
      egressDenials: z
        .object({ providerId: z.string().nullable(), hosts: z.string().array() })
        .array(),
    })
    .default({ contract: null, sandbox: null, egressDenials: [] }),
  completion: z
    .object({
      completedAt: z.string(),
      verificationReceiptIds: z.string().array(),
      mutationReceiptIds: z.string().array(),
    })
    .nullable()
    .default(null),
  artifactIds: z.string().array(),
  governance: RuntimeGovernanceSchema.default({
    guardEnforcementMode: "warn",
    budget: {
      maxFilesTouched: 8,
      maxMutatingCommands: 6,
      maxApprovalRequests: 4,
      maxRepeatedFailures: 3,
      filesTouched: 0,
      mutatingCommands: 0,
      approvalsRequested: 0,
    },
    providerPressure: {
      throttles: 0,
      inFlight: 0,
      queueLength: 0,
    },
    touchedFiles: [],
    baselineCheckpoint: null,
    mutationReceiptIds: [],
    verification: {
      required: false,
      satisfied: false,
      receiptIds: [],
    },
    planQuality: null,
    completionProof: null,
    failureCounts: {},
  }),
  trust: TrustSummarySchema.nullable(),
  error: RunErrorSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
})
export type RunState = z.infer<typeof RunStateSchema>

export const LEGAL_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  created: ["compiled", "cancelled"],
  compiled: ["queued", "cancelled"],
  queued: ["running", "cancelled"],
  running: ["waiting_approval", "completed", "failed", "cancelled"],
  waiting_approval: ["running", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
}

export function isLegalTransition(from: RunStatus, to: RunStatus): boolean {
  const legal = LEGAL_TRANSITIONS[from]
  return legal.includes(to)
}

export function createInitialRunState(runId: string, contractId: string): RunState {
  const now = new Date().toISOString()
  return {
    runId,
    contractId,
    status: "created",
    currentStepId: null,
    steps: [],
    pendingApprovalIds: [],
    approvals: [],
    evidence: { contract: null, sandbox: null, egressDenials: [] },
    completion: null,
    artifactIds: [],
    governance: {
      guardEnforcementMode: "warn",
      budget: {
        maxFilesTouched: 8,
        maxMutatingCommands: 6,
        maxApprovalRequests: 4,
        maxRepeatedFailures: 3,
        filesTouched: 0,
        mutatingCommands: 0,
        approvalsRequested: 0,
      },
      providerPressure: {
        throttles: 0,
        inFlight: 0,
        queueLength: 0,
      },
      touchedFiles: [],
      baselineCheckpoint: null,
      mutationReceiptIds: [],
      verification: {
        required: false,
        satisfied: false,
        receiptIds: [],
      },
      planQuality: null,
      completionProof: null,
      failureCounts: {},
    },
    trust: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  }
}

export function isTerminalStatus(status: RunStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled"
}

export function isStepTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "blocked"
}

export const RunStatusExternalSchema = z.enum([
  "created",
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
])

export function toExternalStatus(internal: RunStatus): z.infer<typeof RunStatusExternalSchema> {
  if (internal === "compiled") return "created"
  return internal as z.infer<typeof RunStatusExternalSchema>
}
