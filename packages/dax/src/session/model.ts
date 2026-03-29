import z from "zod"
import { Identifier } from "../id/id"
import { Snapshot } from "@/snapshot"
import { AuditFinding } from "../governance/audit-types"
import { Permission, type SessionVerification } from "@/governance"

export namespace SessionV2 {
  export const Intent = z.object({
    prompt: z.string(),
    intentType: z.string(),
    confidence: z.number(),
    activeMode: z.string(),
    suggestedOperator: z.string(),
    requiredSkills: z.string().array(),
    requestedOutput: z.string(),
    riskLevel: z.enum(["low", "medium", "high"]),
    scope: z.string(),
    constraints: z.string().array(),
    contract: z.object({
      goal: z.string(),
      successCriteria: z.string().array(),
      explicitConstraints: z.string().array(),
      executionPlan: z.string().array().optional(),
      contextSignals: z.string().array().optional(),
      operatorWatchouts: z.string().array().optional(),
      targetFiles: z.string().array().optional(),
      validationCommands: z.string().array().optional(),
      executionMode: z.enum(["fast", "balanced", "safe", "audit-heavy"]).optional(),
      riskLevel: z.enum(["low", "medium", "high"]).optional(),
      likelyWrites: z.string().array().optional(),
      approvalForecast: z.string().array().optional(),
      unknowns: z.string().array().optional(),
      rollbackPlan: z.string().array().optional(),
      formattedPrompt: z.string().optional(),
      requiredFramework: z.string().optional(),
    }).optional(),
  }).meta({
    ref: "SessionIntent",
  })
  export type Intent = z.infer<typeof Intent>

  export const TaskStatus = z.enum(["pending", "running", "completed", "failed", "blocked", "awaiting_approval"])
  export type TaskStatus = z.infer<typeof TaskStatus>

  export const PlannedTask = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    operator_type: z.string(),
    status: TaskStatus,
    dependencies: z.string().array(),
    context: z.record(z.string(), z.any()),
    result: z.any().optional(),
    error: z.string().optional(),
  }).meta({
    ref: "PlannedTask",
  })
  export type PlannedTask = z.infer<typeof PlannedTask>

  export const Plan = z.object({
    id: z.string(),
    intent_id: z.string().optional(),
    tasks: z.record(z.string(), PlannedTask),
    status: TaskStatus,
  }).meta({
    ref: "SessionPlan",
  })
  export type Plan = z.infer<typeof Plan>

  export const TimelineEvent = z.object({
    id: z.string(),
    type: z.string(),
    timestamp: z.number(),
    messageID: z.string().optional(),
    payload: z.record(z.string(), z.any()),
  }).meta({
    ref: "TimelineEvent",
  })
  export type TimelineEvent = z.infer<typeof TimelineEvent>

  export const ArtifactRecord = z.object({
    id: z.string(),
    kind: z.string(),
    path: z.string().optional(),
    hash: z.string().optional(),
    metadata: z.record(z.string(), z.any()),
    created_at: z.number(),
  }).meta({
    ref: "ArtifactRecord",
  })
  export type ArtifactRecord = z.infer<typeof ArtifactRecord>

  export const State = z.object({
    intent: Intent.optional(),
    plan: Plan.optional(),
    activity_timeline: TimelineEvent.array(),
    approvals: Permission.Request.array(),
    artifacts: ArtifactRecord.array(),
    audit_findings: AuditFinding.array(),
    trust_posture: z.any().optional(),
  }).meta({
    ref: "SessionStateV2",
  })
  export type State = z.infer<typeof State>
}
