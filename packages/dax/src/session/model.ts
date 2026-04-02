import z from "zod"
import { Identifier } from "../id/id"
import { Snapshot } from "@/snapshot"
import { AuditFinding } from "../governance/audit-types"
import { Permission, type SessionVerification } from "@/governance"

export namespace SessionV2 {
  export const Intent = z
    .object({
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
      contract: z
        .object({
          goal: z.string(),
          successCriteria: z.string().array(),
          explicitConstraints: z.string().array(),
          executionProfile: z
            .object({
              mode: z.enum(["fast", "balanced", "safe", "audit-heavy"]),
              riskLevel: z.enum(["low", "medium", "high"]),
              writeScope: z.enum(["none", "single_file", "multi_file", "unknown"]),
              approvalLikelihood: z.enum(["low", "medium", "high"]),
            })
            .optional(),
          contractDelta: z
            .object({
              inferredScope: z.string().array().optional(),
              inferredTargets: z.string().array().optional(),
              addedValidation: z.string().array().optional(),
              unresolvedUnknowns: z.string().array().optional(),
            })
            .optional(),
          validationPlan: z
            .object({
              preflight: z.string().array().optional(),
              postChange: z.string().array().optional(),
              shipReadiness: z.string().array().optional(),
            })
            .optional(),
          governanceHints: z
            .object({
              likelyTriggers: z.string().array().optional(),
              lowerRiskAlternatives: z.string().array().optional(),
              operatorDecisionsNeeded: z.string().array().optional(),
            })
            .optional(),
          repoImpact: z
            .object({
              targetFiles: z.string().array().optional(),
              targetSubsystems: z.string().array().optional(),
              docsImpact: z.boolean().optional(),
              testImpact: z.boolean().optional(),
              avoidAreas: z.string().array().optional(),
            })
            .optional(),
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
        })
        .optional(),
    })
    .meta({
      ref: "SessionIntent",
    })
  export type Intent = z.infer<typeof Intent>

  export const TaskStatus = z.enum(["pending", "running", "completed", "failed", "blocked", "awaiting_approval"])
  export type TaskStatus = z.infer<typeof TaskStatus>

  export const PlannedTask = z
    .object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      operator_type: z.string(),
      status: TaskStatus,
      dependencies: z.string().array(),
      context: z.record(z.string(), z.any()),
      result: z.any().optional(),
      error: z.string().optional(),
    })
    .meta({
      ref: "PlannedTask",
    })
  export type PlannedTask = z.infer<typeof PlannedTask>

  export const Plan = z
    .object({
      id: z.string(),
      intent_id: z.string().optional(),
      tasks: z.record(z.string(), PlannedTask),
      status: TaskStatus,
    })
    .meta({
      ref: "SessionPlan",
    })
  export type Plan = z.infer<typeof Plan>

  export const TimelineEvent = z
    .object({
      id: z.string(),
      type: z.string(),
      timestamp: z.number(),
      messageID: z.string().optional(),
      payload: z.record(z.string(), z.any()),
    })
    .meta({
      ref: "TimelineEvent",
    })
  export type TimelineEvent = z.infer<typeof TimelineEvent>

  export const ArtifactRecord = z
    .object({
      id: z.string(),
      kind: z.string(),
      path: z.string().optional(),
      hash: z.string().optional(),
      metadata: z.record(z.string(), z.any()),
      created_at: z.number(),
    })
    .meta({
      ref: "ArtifactRecord",
    })
  export type ArtifactRecord = z.infer<typeof ArtifactRecord>

  export const ReflectionRisk = z.object({
    level: z.enum(["low", "medium", "high"]),
    item: z.string(),
    mitigation: z.string().optional(),
  })

  export const ReflectionAlternative = z.object({
    id: z.string(),
    path: z.string(),
    tradeoff: z.string(),
  })

  export const Reflection = z
    .object({
      goal: z.string(),
      outcome_expected: z.string(),
      assumptions: z.string().array(),
      ambiguities: z.string().array(),
      risks: ReflectionRisk.array(),
      alternatives: ReflectionAlternative.array(),
      decision: z.enum(["proceed", "ask", "branch", "stop"]),
      justification: z.string().optional(),
      confidence: z.number(),
      requiresApproval: z.boolean(),
      verificationPlan: z.string().array(),
      timestamp: z.string(),
    })
    .meta({
      ref: "ExecutionReflection",
    })
  export type Reflection = z.infer<typeof Reflection>

  export const State = z
    .object({
      intent: Intent.optional(),
      plan: Plan.optional(),
      activity_timeline: TimelineEvent.array(),
      approvals: Permission.Request.array(),
      artifacts: ArtifactRecord.array(),
      audit_findings: AuditFinding.array(),
      trust_posture: z.any().optional(),
      reflection: Reflection.optional(),
      reflection_history: Reflection.array().optional(),
    })
    .meta({
      ref: "SessionStateV2",
    })
  export type State = z.infer<typeof State>
}
