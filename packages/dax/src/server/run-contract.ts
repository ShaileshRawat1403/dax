import z from "zod"

export const SchemaVersion = z.literal("v1")
export type SchemaVersion = z.infer<typeof SchemaVersion>

export const SourceSystem = z.enum(["soothsayer", "dax", "cli", "api"])
export type SourceSystem = z.infer<typeof SourceSystem>

export const WorkflowClass = z.enum(["draft_and_approve", "repo_analyze", "review_and_signoff", "generic"])
export type WorkflowClass = z.infer<typeof WorkflowClass>

export const WorkflowTrustPosture = z.enum(["high", "medium", "low", "minimal"])
export type WorkflowTrustPosture = z.infer<typeof WorkflowTrustPosture>

export const WorkflowTerminalReason = z.enum([
  "workflow_completed",
  "workflow_failed",
  "workflow_signed_off",
  "workflow_rejected",
  "workflow_expired",
  "workflow_cancelled",
  "execution_error",
  "permission_denied",
  "timeout",
])
export type WorkflowTerminalReason = z.infer<typeof WorkflowTerminalReason>

export const WorkflowSummary = z.object({
  workflowClass: WorkflowClass,
  stepGraph: z.string().array(),
  currentStepIndex: z.number().optional(),
  totalSteps: z.number(),
  trustPosture: WorkflowTrustPosture,
  terminalReason: WorkflowTerminalReason.optional(),
})
export type WorkflowSummary = z.infer<typeof WorkflowSummary>

export const RunStatus = z.enum([
  "created",
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
])
export type RunStatus = z.infer<typeof RunStatus>

export const StepStatus = z.enum(["proposed", "running", "completed", "failed", "blocked"])
export type StepStatus = z.infer<typeof StepStatus>

export const ApprovalStatus = z.enum(["pending", "approved", "denied", "expired", "cancelled"])
export type ApprovalStatus = z.infer<typeof ApprovalStatus>

export const ApprovalDecision = z.enum(["approve", "deny"])
export type ApprovalDecision = z.infer<typeof ApprovalDecision>

export const RiskLevel = z.enum(["low", "medium", "high", "critical"])
export type RiskLevel = z.infer<typeof RiskLevel>

export const ArtifactType = z.enum(["diff", "file", "report", "log", "summary", "patch"])
export type ArtifactType = z.infer<typeof ArtifactType>

export const RunIntent = z
  .object({
    input: z.string(),
    kind: z.enum(["general", "analysis", "edit", "workflow_step"]).optional(),
    repoPath: z.string().optional(),
    branch: z.string().optional(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  })
  .meta({ ref: "RunIntentV1" })
export type RunIntent = z.infer<typeof RunIntent>

export const RunTrustState = z
  .object({
    score: z.number().optional(),
    posture: z.enum(["low", "guarded", "moderate", "strong"]).optional(),
    blocked: z.boolean().optional(),
    reasons: z.string().array().optional(),
  })
  .meta({ ref: "RunTrustStateV1" })
export type RunTrustState = z.infer<typeof RunTrustState>

export const RunArtifactSummary = z
  .object({
    total: z.number(),
    byType: z.record(z.string(), z.number()).optional(),
    latestArtifactIds: z.string().array().optional(),
  })
  .meta({ ref: "RunArtifactSummaryV1" })
export type RunArtifactSummary = z.infer<typeof RunArtifactSummary>

export const RunCurrentStep = z
  .object({
    stepId: z.string(),
    status: StepStatus,
    title: z.string(),
    detail: z.string().optional(),
  })
  .meta({ ref: "RunCurrentStepV1" })
export type RunCurrentStep = z.infer<typeof RunCurrentStep>

export const RunSnapshot = z
  .object({
    schemaVersion: SchemaVersion,
    authority: z.enum(["dax", "dax-state-machine", "dax-legacy"]),
    sourceSystem: SourceSystem.optional(),
    runId: z.string(),
    status: RunStatus,
    createdAt: z.string(),
    updatedAt: z.string(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    title: z.string().optional(),
    currentStep: RunCurrentStep.optional(),
    pendingApprovalCount: z.number(),
    trust: RunTrustState.optional(),
    artifactSummary: RunArtifactSummary.optional(),
    workflow: WorkflowSummary.optional(),
    terminalReason: WorkflowTerminalReason.optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    lastEvent: z
      .object({
        eventId: z.string(),
        sequence: z.number(),
        cursor: z.string(),
        timestamp: z.string(),
      })
      .nullable()
      .optional(),
  })
  .meta({ ref: "RunSnapshotV1" })
export type RunSnapshot = z.infer<typeof RunSnapshot>

export const ApprovalResolution = z
  .object({
    decision: ApprovalDecision,
    actorId: z.string().optional(),
    source: z.enum(["soothsayer", "dax", "cli", "system"]),
    comment: z.string().optional(),
  })
  .meta({ ref: "ApprovalResolutionV1" })
export type ApprovalResolution = z.infer<typeof ApprovalResolution>

export const ApprovalContext = z
  .object({
    stepId: z.string().optional(),
    filePath: z.string().optional(),
    command: z.string().optional(),
    toolName: z.string().optional(),
    diffPreview: z.string().optional(),
    notes: z.string().array().optional(),
  })
  .meta({ ref: "ApprovalContextV1" })
export type ApprovalContext = z.infer<typeof ApprovalContext>

export const ApprovalRecord = z
  .object({
    approvalId: z.string(),
    runId: z.string(),
    type: z.enum(["file_write", "command_execute", "patch_apply", "tool_use", "workflow_gate"]),
    status: ApprovalStatus,
    risk: RiskLevel,
    title: z.string(),
    reason: z.string(),
    context: ApprovalContext.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    resolvedAt: z.string().optional(),
    resolution: ApprovalResolution.optional(),
  })
  .meta({ ref: "ApprovalRecordV1" })
export type ApprovalRecord = z.infer<typeof ApprovalRecord>

export const ArtifactRecord = z
  .object({
    artifactId: z.string(),
    runId: z.string(),
    type: ArtifactType,
    title: z.string(),
    createdAt: z.string(),
    path: z.string().optional(),
    mimeType: z.string().optional(),
    preview: z
      .object({
        text: z.string().optional(),
        truncated: z.boolean().optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    links: z
      .object({
        self: z.string().optional(),
        download: z.string().optional(),
      })
      .optional(),
  })
  .meta({ ref: "ArtifactRecordV1" })
export type ArtifactRecord = z.infer<typeof ArtifactRecord>

export const PersonaPreset = z
  .object({
    personaId: z.string(),
    providerHint: z.string().optional(),
    modelHint: z.string().optional(),
    temperature: z.number().optional(),
    verbosity: z.enum(["concise", "balanced", "detailed"]).optional(),
    tone: z.enum(["technical", "formal", "friendly", "direct"]).optional(),
    riskLevel: RiskLevel.optional(),
    approvalMode: z.enum(["strict", "balanced", "relaxed"]).optional(),
    preferredCapabilityClasses: z
      .enum(["analysis", "planning", "code", "refactor", "review", "shell", "docs"])
      .array()
      .optional(),
    eli12: z.boolean().optional(),
  })
  .meta({ ref: "PersonaPresetV1" })
export type PersonaPreset = z.infer<typeof PersonaPreset>

export const CreateRunRequest = z
  .object({
    intent: RunIntent,
    personaPreset: PersonaPreset.optional(),
    workflowHint: z.enum(["draft_and_approve", "repo_analyze", "review_and_signoff"]).optional(),
    metadata: z
      .object({
        initiatedBy: z.string().optional(),
        source: z.literal("soothsayer").optional(),
        workspaceId: z.string().optional(),
        projectId: z.string().optional(),
        chatId: z.string().optional(),
        workflowId: z.string().optional(),
        channel: z.string().optional(),
        sessionId: z.string().optional(),
        targeting: z
          .object({
            mode: z.enum(["explicit_repo_path", "default_cwd"]),
            repoPath: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .meta({ ref: "CreateRunRequestV1" })
export type CreateRunRequest = z.infer<typeof CreateRunRequest>

export const CreateRunResponse = z
  .object({
    runId: z.string(),
    status: RunStatus,
    createdAt: z.string(),
    workflowHint: WorkflowClass.optional(),
    workflowHintAccepted: z.boolean().optional(),
    workflowClass: WorkflowClass.optional(),
    warnings: z.string().array().optional(),
  })
  .meta({ ref: "CreateRunResponseV1" })
export type CreateRunResponse = z.infer<typeof CreateRunResponse>

export const ResolveApprovalRequest = z
  .object({
    decision: ApprovalDecision,
    actorId: z.string(),
    source: z.literal("soothsayer"),
    comment: z.string().optional(),
    requestId: z.string().optional(),
  })
  .meta({ ref: "ResolveApprovalRequestV1" })
export type ResolveApprovalRequest = z.infer<typeof ResolveApprovalRequest>

export const ResolveApprovalResponse = z
  .object({
    approvalId: z.string(),
    status: ApprovalStatus,
    resolution: ApprovalResolution,
    resolvedAt: z.string().optional(),
  })
  .meta({ ref: "ResolveApprovalResponseV1" })
export type ResolveApprovalResponse = z.infer<typeof ResolveApprovalResponse>

export const RunSummary = z
  .object({
    runId: z.string(),
    status: RunStatus,
    authority: z.enum(["dax", "dax-state-machine", "dax-legacy"]).optional(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    stepCount: z.number(),
    completedStepCount: z.number().optional(),
    failedStepCount: z.number().optional(),
    pendingStepCount: z.number().optional(),
    approvalCount: z.number(),
    approvedCount: z.number().optional(),
    deniedCount: z.number().optional(),
    pendingApprovalCount: z.number().optional(),
    artifactCount: z.number(),
    trust: RunTrustState.optional(),
    workflow: WorkflowSummary.optional(),
    terminalReason: WorkflowTerminalReason.optional(),
    outcome: z
      .object({
        summaryText: z.string().optional(),
        result: z.enum(["success", "failure", "partial", "pending"]).optional(),
        terminalReason: z.string().optional(),
      })
      .optional(),
  })
  .meta({ ref: "RunSummaryV1" })
export type RunSummary = z.infer<typeof RunSummary>

export const RunSourceSurface = z.enum(["chat", "workflow", "direct", "unknown"])
export type RunSourceSurface = z.infer<typeof RunSourceSurface>

export const RunTargetingSummary = z
  .object({
    mode: z.enum(["explicit_repo_path", "default_cwd"]),
    repoPath: z.string().optional(),
  })
  .meta({ ref: "RunTargetingSummaryV1" })
export type RunTargetingSummary = z.infer<typeof RunTargetingSummary>

export const RunListItem = z
  .object({
    runId: z.string(),
    title: z.string().optional(),
    status: RunStatus,
    sourceSystem: SourceSystem.optional(),
    sourceSurface: RunSourceSurface,
    createdAt: z.string(),
    updatedAt: z.string(),
    startedAt: z.string().optional(),
    completedAt: z.string().optional(),
    currentStep: RunCurrentStep.optional(),
    pendingApprovalCount: z.number(),
    targeting: RunTargetingSummary.optional(),
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
    chatId: z.string().optional(),
    workflowId: z.string().optional(),
  })
  .meta({ ref: "RunListItemV1" })
export type RunListItem = z.infer<typeof RunListItem>

export const PendingApprovalSummary = z
  .object({
    approvalId: z.string(),
    runId: z.string(),
    type: z.enum(["file_write", "command_execute", "patch_apply", "tool_use", "workflow_gate"]),
    risk: RiskLevel,
    title: z.string(),
    reason: z.string(),
    createdAt: z.string(),
    targeting: RunTargetingSummary.optional(),
    sourceSurface: RunSourceSurface,
    workspaceId: z.string().optional(),
    projectId: z.string().optional(),
  })
  .meta({ ref: "PendingApprovalSummaryV1" })
export type PendingApprovalSummary = z.infer<typeof PendingApprovalSummary>

export const RunOverviewResponse = z
  .object({
    activeRuns: RunListItem.array(),
    recentRuns: RunListItem.array(),
    pendingApprovals: PendingApprovalSummary.array(),
  })
  .meta({ ref: "RunOverviewResponseV1" })
export type RunOverviewResponse = z.infer<typeof RunOverviewResponse>

export const RunEventType = z.enum([
  "run.created",
  "run.started",
  "run.state_changed",
  "step.proposed",
  "step.started",
  "step.completed",
  "step.failed",
  "approval.requested",
  "approval.resolved",
  "artifact.created",
  "trust.updated",
  "run.completed",
  "run.failed",
])
export type RunEventType = z.infer<typeof RunEventType>

const RunCreatedPayload = z.object({
  status: z.literal("created"),
  title: z.string().optional(),
})

const RunStartedPayload = z.object({
  status: z.literal("running"),
})

const RunStateChangedPayload = z.object({
  previousStatus: RunStatus,
  currentStatus: RunStatus,
  reason: z.string().optional(),
})

const StepProposedPayload = z.object({
  stepId: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  risk: RiskLevel.optional(),
})

const StepStartedPayload = z.object({
  stepId: z.string(),
  title: z.string(),
  detail: z.string().optional(),
})

const StepCompletedPayload = z.object({
  stepId: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  durationMs: z.number().optional(),
})

const StepFailedPayload = z.object({
  stepId: z.string(),
  title: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
})

const ApprovalRequestedPayload = z.object({
  approval: ApprovalRecord,
})

const ApprovalResolvedPayload = z.object({
  approvalId: z.string(),
  status: ApprovalStatus,
  decision: ApprovalDecision,
  actorId: z.string().optional(),
  source: z.enum(["soothsayer", "dax", "cli", "system"]),
  comment: z.string().optional(),
  resolvedAt: z.string(),
})

const ArtifactCreatedPayload = z.object({
  artifact: ArtifactRecord,
})

const TrustUpdatedPayload = z.object({
  trust: RunTrustState,
  reason: z.string().optional(),
})

const RunCompletedPayload = z.object({
  status: z.literal("completed"),
  summaryAvailable: z.boolean(),
})

const RunFailedPayload = z.object({
  status: z.literal("failed"),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
  }),
})

export const RunEventPayload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run.created"), payload: RunCreatedPayload }),
  z.object({ type: z.literal("run.started"), payload: RunStartedPayload }),
  z.object({ type: z.literal("run.state_changed"), payload: RunStateChangedPayload }),
  z.object({ type: z.literal("step.proposed"), payload: StepProposedPayload }),
  z.object({ type: z.literal("step.started"), payload: StepStartedPayload }),
  z.object({ type: z.literal("step.completed"), payload: StepCompletedPayload }),
  z.object({ type: z.literal("step.failed"), payload: StepFailedPayload }),
  z.object({ type: z.literal("approval.requested"), payload: ApprovalRequestedPayload }),
  z.object({ type: z.literal("approval.resolved"), payload: ApprovalResolvedPayload }),
  z.object({ type: z.literal("artifact.created"), payload: ArtifactCreatedPayload }),
  z.object({ type: z.literal("trust.updated"), payload: TrustUpdatedPayload }),
  z.object({ type: z.literal("run.completed"), payload: RunCompletedPayload }),
  z.object({ type: z.literal("run.failed"), payload: RunFailedPayload }),
])

export const RunEvent = z
  .object({
    schemaVersion: SchemaVersion,
    eventId: z.string(),
    sequence: z.number(),
    cursor: z.string(),
    runId: z.string(),
    type: RunEventType,
    timestamp: z.string(),
    payload: z.record(z.string(), z.any()),
  })
  .meta({ ref: "RunEventV1" })
export type RunEvent = z.infer<typeof RunEvent>

export const GetApprovalsResponse = z
  .object({
    runId: z.string(),
    approvals: ApprovalRecord.array(),
  })
  .meta({ ref: "GetApprovalsResponseV1" })
export type GetApprovalsResponse = z.infer<typeof GetApprovalsResponse>
