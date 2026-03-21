import { z } from "zod"
import type { WorkflowClass } from "@/execution/workflow-class"
import type { ExecutionContract } from "@/execution/execution-contract"

export const WorkflowStepTypeSchema = z.enum([
  "prepare_draft",
  "request_approval",
  "commit_execution",
  "collect_context",
  "analyze_repository",
  "publish_report",
  "produce_review",
  "request_signoff",
  "finalize_outcome",
  "generic",
])
export type WorkflowStepType = z.infer<typeof WorkflowStepTypeSchema>

export const WorkflowTerminalReasonSchema = z.enum([
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
export type WorkflowTerminalReason = z.infer<typeof WorkflowTerminalReasonSchema>

export const WorkflowTrustPostureSchema = z.enum(["high", "medium", "low", "minimal"])
export type WorkflowTrustPosture = z.infer<typeof WorkflowTrustPostureSchema>

export const WorkflowApprovalModeSchema = z.enum(["none", "manual", "auto"])
export type WorkflowApprovalMode = z.infer<typeof WorkflowApprovalModeSchema>

export const WorkflowStepSchema = z.object({
  stepId: z.string(),
  type: WorkflowStepTypeSchema,
  title: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
})
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>

export const DraftArtifactSchema = z.object({
  type: z.enum(["file", "patch", "message", "summary", "report"]),
  content: z.string(),
  path: z.string().optional(),
  targetPath: z.string().optional(),
  artifactId: z.string().optional(),
})
export type DraftArtifact = z.infer<typeof DraftArtifactSchema>

export const ExecutionResultSchema = z.object({
  success: z.boolean(),
  artifactId: z.string().optional(),
  output: z.string().optional(),
  error: z.string().optional(),
})
export type ExecutionResult = z.infer<typeof ExecutionResultSchema>

export interface WorkflowContext {
  runId: string
  contract: ExecutionContract
}

export interface WorkflowStepResult {
  stepId: string
  success: boolean
  outputs: DraftArtifact[]
  error?: string
}

export interface WorkflowExecutionResult {
  success: boolean
  finalArtifactId?: string
  stepResults: WorkflowStepResult[]
  error?: string
}

export interface WorkflowMetadata {
  workflowClass: WorkflowClass
  riskLevel: string
  executionMode: string
  toolAllowlist: string[]
  toolBlocklist: string[]
  approvalMode: WorkflowApprovalMode
}

export interface WorkflowOutcome {
  decision: "approved" | "rejected" | "expired" | "completed" | "failed"
  reason: string
  actorId?: string
  timestamp: string
}

export interface WorkflowSummary {
  workflowClass: WorkflowClass
  runId: string
  terminalState: "completed" | "failed" | "cancelled"
  terminalReason: WorkflowTerminalReason
  trustPosture: WorkflowTrustPosture
  stepCount: number
  durationMs?: number
  outcome?: WorkflowOutcome
  finalArtifactId?: string
}

export const FIXED_STEPS: WorkflowStep[] = [
  {
    stepId: "prepare_draft",
    type: "prepare_draft",
    title: "Prepare Draft",
    description: "Generate or prepare the draft artifact for review",
    required: true,
  },
  {
    stepId: "request_approval",
    type: "request_approval",
    title: "Request Approval",
    description: "Create approval request and pause for human decision",
    required: true,
  },
  {
    stepId: "commit_execution",
    type: "commit_execution",
    title: "Commit Execution",
    description: "Execute the approved artifact",
    required: true,
  },
]

export const REPO_ANALYZE_STEPS: WorkflowStep[] = [
  {
    stepId: "collect_context",
    type: "collect_context",
    title: "Collect Context",
    description: "Gather repository structure, file tree, and metadata",
    required: true,
  },
  {
    stepId: "analyze_repository",
    type: "analyze_repository",
    title: "Analyze Repository",
    description: "Perform code analysis, pattern detection, and quality assessment",
    required: true,
  },
  {
    stepId: "publish_report",
    type: "publish_report",
    title: "Publish Report",
    description: "Generate and publish structured analysis report artifact",
    required: true,
  },
]

export const REVIEW_AND_SIGNOFF_STEPS: WorkflowStep[] = [
  {
    stepId: "collect_context",
    type: "collect_context",
    title: "Collect Context",
    description: "Gather relevant information for review",
    required: true,
  },
  {
    stepId: "produce_review",
    type: "produce_review",
    title: "Produce Review",
    description: "Generate structured review artifact with findings and recommendations",
    required: true,
  },
  {
    stepId: "request_signoff",
    type: "request_signoff",
    title: "Request Signoff",
    description: "Create signoff request and await human decision",
    required: true,
  },
  {
    stepId: "finalize_outcome",
    type: "finalize_outcome",
    title: "Finalize Outcome",
    description: "Record final decision and produce signed outcome artifact",
    required: true,
  },
]

export function getStepsForWorkflow(workflowClass: WorkflowClass): WorkflowStep[] {
  switch (workflowClass) {
    case "draft_and_approve":
      return FIXED_STEPS
    case "repo_analyze":
      return REPO_ANALYZE_STEPS
    case "review_and_signoff":
      return REVIEW_AND_SIGNOFF_STEPS
    case "generic":
    default:
      return []
  }
}

export function isFixedWorkflow(workflowClass: WorkflowClass): boolean {
  return (
    workflowClass === "draft_and_approve" || workflowClass === "repo_analyze" || workflowClass === "review_and_signoff"
  )
}
