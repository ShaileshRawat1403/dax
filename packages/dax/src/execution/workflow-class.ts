import z from "zod"

export const WorkflowClassSchema = z.enum(["generic", "draft_and_approve", "repo_analyze", "review_and_signoff"])
export type WorkflowClass = z.infer<typeof WorkflowClassSchema>

export const WORKFLOW_CLASSES = WorkflowClassSchema.options

export const WorkflowClassInfo: Record<WorkflowClass, { description: string; approval_mode: string }> = {
  generic: {
    description: "General purpose execution without predefined step structure",
    approval_mode: "derived_from_risk",
  },
  draft_and_approve: {
    description: "Generate artifact → approval gate → execute/commit",
    approval_mode: "required",
  },
  repo_analyze: {
    description: "Analyze repository structure, code, and patterns",
    approval_mode: "optional",
  },
  review_and_signoff: {
    description: "Review code, PR, or document and provide signoff",
    approval_mode: "strict",
  },
}

export const ExecutionModeSchema = z.enum(["auto", "approval_gated", "manual"])
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>

export const EXECUTION_MODE_DEFAULTS: Record<WorkflowClass, ExecutionMode> = {
  generic: "auto",
  draft_and_approve: "approval_gated",
  repo_analyze: "auto",
  review_and_signoff: "approval_gated",
}

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"])
export type RiskLevel = z.infer<typeof RiskLevelSchema>

export const RISK_TO_APPROVAL_MODE: Record<RiskLevel, ExecutionMode> = {
  low: "auto",
  medium: "approval_gated",
  high: "approval_gated",
  critical: "manual",
}
