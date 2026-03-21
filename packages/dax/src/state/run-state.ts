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
  artifactIds: z.string().array(),
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
    artifactIds: [],
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
