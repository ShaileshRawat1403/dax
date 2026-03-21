import { z } from "zod"
import type { WorkflowClass } from "@/execution/workflow-class"
import type { ExecutionContract } from "@/execution/execution-contract"

export const WorkflowStepTypeSchema = z.enum(["prepare_draft", "request_approval", "commit_execution", "generic"])
export type WorkflowStepType = z.infer<typeof WorkflowStepTypeSchema>

export const WorkflowStepSchema = z.object({
  stepId: z.string(),
  type: WorkflowStepTypeSchema,
  title: z.string(),
  description: z.string(),
  required: z.boolean().default(true),
})
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>

export const DraftArtifactSchema = z.object({
  type: z.enum(["file", "patch", "message", "summary"]),
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

export function getStepsForWorkflow(workflowClass: WorkflowClass): WorkflowStep[] {
  switch (workflowClass) {
    case "draft_and_approve":
      return FIXED_STEPS
    case "repo_analyze":
    case "review_and_signoff":
    case "generic":
    default:
      return []
  }
}

export function isFixedWorkflow(workflowClass: WorkflowClass): boolean {
  return workflowClass === "draft_and_approve"
}
