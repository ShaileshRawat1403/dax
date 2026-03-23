import { RunGateway } from "@/server/run-gateway"
import { getStepsForWorkflow } from "@/workflows/types"
import type { WorkflowClass } from "@/server/run-contract"
import type { RunSnapshot, RunSummary } from "@/server/run-contract"

export const WORKFLOW_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  draft_and_approve: {
    label: "Draft & Approve",
    description: "Generate a draft and request approval before execution",
    icon: "edit",
  },
  repo_analyze: {
    label: "Repository Analysis",
    description: "Read-only analysis of repository structure and code",
    icon: "search",
  },
  review_and_signoff: {
    label: "Review & Signoff",
    description: "Structured review with human signoff decision",
    icon: "clipboard-check",
  },
  generic: {
    label: "Generic Workflow",
    description: "General-purpose workflow execution",
    icon: "workflow",
  },
}

export const STEP_LABELS: Record<string, { label: string; description: string }> = {
  prepare_draft: { label: "Prepare Draft", description: "Generate or prepare the draft artifact for review" },
  request_approval: { label: "Request Approval", description: "Create approval request and pause for human decision" },
  commit_execution: { label: "Commit Execution", description: "Execute the approved artifact" },
  collect_context: { label: "Collect Context", description: "Gather relevant information for the workflow" },
  analyze_repository: { label: "Analyze Repository", description: "Perform analysis on repository structure and code" },
  publish_report: { label: "Publish Report", description: "Generate and publish structured report artifact" },
  produce_review: {
    label: "Produce Review",
    description: "Generate structured review with findings and recommendations",
  },
  request_signoff: { label: "Request Signoff", description: "Create signoff request and await human decision" },
  finalize_outcome: {
    label: "Finalize Outcome",
    description: "Record final decision and produce signed outcome artifact",
  },
}

export const TERMINAL_REASON_LABELS: Record<
  string,
  { label: string; description: string; severity: "info" | "success" | "warning" | "error" }
> = {
  workflow_completed: { label: "Completed", description: "Workflow finished successfully", severity: "success" },
  workflow_failed: { label: "Failed", description: "Workflow encountered an error", severity: "error" },
  workflow_signed_off: { label: "Signed Off", description: "Human approved the workflow outcome", severity: "success" },
  workflow_rejected: { label: "Rejected", description: "Human rejected the workflow outcome", severity: "warning" },
  workflow_expired: { label: "Expired", description: "Signoff request expired without response", severity: "warning" },
  workflow_cancelled: { label: "Cancelled", description: "Workflow was cancelled", severity: "warning" },
  execution_error: { label: "Execution Error", description: "Run failed during execution", severity: "error" },
  permission_denied: {
    label: "Permission Denied",
    description: "Operation blocked due to insufficient permissions",
    severity: "error",
  },
  timeout: { label: "Timeout", description: "Run exceeded time limit", severity: "warning" },
}

export const APPROVAL_TYPE_LABELS: Record<string, { label: string; description: string; icon: string }> = {
  file_write: { label: "File Write", description: "Modify or create files on disk", icon: "file-edit" },
  command_execute: { label: "Command Execution", description: "Run shell commands", icon: "terminal" },
  patch_apply: { label: "Patch Apply", description: "Apply code changes via patch", icon: "git-pull-request" },
  tool_use: { label: "Tool Use", description: "Execute a tool or API call", icon: "tool" },
  workflow_gate: {
    label: "Workflow Gate",
    description: "Checkpoint requiring human approval to proceed",
    icon: "gate",
  },
}

export const RISK_LABELS: Record<string, { label: string; description: string; severity: number; color: string }> = {
  low: { label: "Low Risk", description: "Read-only or non-destructive operation", severity: 1, color: "green" },
  medium: { label: "Medium Risk", description: "May modify files but is reversible", severity: 2, color: "yellow" },
  high: { label: "High Risk", description: "Shell execution or significant changes", severity: 3, color: "orange" },
  critical: { label: "Critical Risk", description: "Destructive or irreversible operation", severity: 4, color: "red" },
}

export const TRUST_POSTURE_LABELS: Record<string, { label: string; description: string; color: string }> = {
  high: { label: "High Trust", description: "Read-only operations, minimal risk", color: "green" },
  medium: { label: "Medium Trust", description: "Moderate risk, may require approvals", color: "yellow" },
  low: { label: "Low Trust", description: "Elevated risk, manual approvals required", color: "orange" },
  minimal: { label: "Minimal Trust", description: "Highest risk, strict controls", color: "red" },
}

function getStepLabel(stepId: string): { label: string; description: string } {
  return STEP_LABELS[stepId] ?? { label: stepId, description: "" }
}

function getApprovalWhatHappensNext(
  type: string,
  context?: { filePath?: string; command?: string; toolName?: string },
): { afterApprove: string; afterDeny?: string } {
  switch (type) {
    case "file_write":
      return {
        afterApprove: `Write changes will be applied to ${context?.filePath ?? "the specified file"}.`,
        afterDeny: "File write will be skipped.",
      }
    case "command_execute":
      return {
        afterApprove: `Command "${context?.command ?? "..."}" will be executed.`,
        afterDeny: "Command will not run.",
      }
    case "patch_apply":
      return {
        afterApprove: "Patch will be applied to modify code.",
        afterDeny: "Patch will not be applied.",
      }
    case "tool_use":
      return {
        afterApprove: `Tool "${context?.toolName ?? "..."}" will be executed.`,
        afterDeny: "Tool execution will be skipped.",
      }
    case "workflow_gate":
      return {
        afterApprove: "Workflow will proceed to the next step.",
        afterDeny: "Workflow will halt at this checkpoint.",
      }
    default:
      return {
        afterApprove: "Operation will proceed.",
        afterDeny: "Operation will be cancelled.",
      }
  }
}

export interface SoothsayerRunDetail {
  runId: string
  status: string
  authority: string
  sourceSystem?: string
  title?: string
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  progress: {
    currentStep: string
    currentStepLabel?: string
    currentStepDescription?: string
    totalSteps: number
    percentage: number
  }
  trust: {
    posture: string
    postureLabel?: string
    postureDescription?: string
    blocked: boolean
  }
  workflow: {
    class: string
    classLabel?: string
    classDescription?: string
    stepGraph: string[]
    currentStepIndex: number
    trustPosture: string
    trustPostureLabel?: string
  } | null
  terminalReason?: string
  terminalReasonLabel?: string
  terminalReasonDescription?: string
  terminalReasonSeverity?: "info" | "success" | "warning" | "error"
  approvals: {
    pending: number
    approved: number
    denied: number
  }
  artifacts: {
    total: number
    latestIds: string[]
  }
  lastEvent?: {
    eventId: string
    sequence: number
    cursor: string
    timestamp: string
  }
}

export interface SoothsayerApprovalDetail {
  approvalId: string
  runId: string
  type: string
  typeLabel?: string
  typeDescription?: string
  typeIcon?: string
  status: string
  risk: string
  riskLabel?: string
  riskDescription?: string
  riskSeverity?: number
  riskColor?: string
  title: string
  titleEnriched?: string
  reason: string
  context: {
    stepId?: string
    filePath?: string
    command?: string
    toolName?: string
    diffPreview?: string
    notes?: string[]
  }
  createdAt: string
  updatedAt: string
  whatHappensNext?: {
    afterApprove: string
    afterDeny?: string
  }
}

export interface SoothsayerWorkflowCard {
  runId: string
  title?: string
  workflowClass: string
  workflowClassLabel?: string
  workflowClassDescription?: string
  status: string
  trustPosture: string
  trustPostureLabel?: string
  progress: {
    currentStep: string
    currentStepLabel?: string
    currentStepDescription?: string
    currentStepIndex: number
    totalSteps: number
    percentage: number
  }
  terminalReason?: string
  terminalReasonLabel?: string
  terminalReasonSeverity?: "info" | "success" | "warning" | "error"
  createdAt: string
  completedAt?: string
}

export interface SoothsayerOverview {
  activeRuns: SoothsayerWorkflowCard[]
  recentRuns: SoothsayerWorkflowCard[]
  pendingApprovals: SoothsayerApprovalDetail[]
  authorityMetrics: {
    dax_state_machine: number
    dax_legacy: number
    total: number
  }
}

function calculateProgress(
  workflow: RunSnapshot["workflow"],
  currentStep: RunSnapshot["currentStep"],
): {
  currentStep: string
  currentStepLabel?: string
  currentStepDescription?: string
  totalSteps: number
  percentage: number
} {
  if (!workflow) {
    const label = currentStep?.title ?? "Unknown"
    return {
      currentStep: label,
      currentStepLabel: label,
      totalSteps: 0,
      percentage: 0,
    }
  }

  const currentIndex = workflow.currentStepIndex ?? 0
  const totalSteps = workflow.totalSteps
  const percentage = totalSteps > 0 ? Math.round((currentIndex / totalSteps) * 100) : 0

  const stepId = workflow.stepGraph[currentIndex] ?? currentStep?.title ?? "Unknown"
  const stepInfo = getStepLabel(stepId)

  return {
    currentStep: stepId,
    currentStepLabel: stepInfo.label,
    currentStepDescription: stepInfo.description,
    totalSteps,
    percentage,
  }
}

function toWorkflowCard(snapshot: RunSnapshot): SoothsayerWorkflowCard {
  const workflow = snapshot.workflow
  const totalSteps = workflow?.totalSteps ?? 0
  const currentIndex = workflow?.currentStepIndex ?? 0
  const percentage = totalSteps > 0 ? Math.round((currentIndex / totalSteps) * 100) : 0

  const workflowClass = workflow?.workflowClass ?? "generic"
  const workflowInfo = WORKFLOW_LABELS[workflowClass] ?? WORKFLOW_LABELS.generic
  const currentStepId = workflow?.stepGraph[currentIndex] ?? snapshot.currentStep?.title ?? "Unknown"
  const stepInfo = getStepLabel(currentStepId)
  const trustInfo = TRUST_POSTURE_LABELS[workflow?.trustPosture ?? "medium"]
  const terminalReasonInfo = snapshot.terminalReason ? TERMINAL_REASON_LABELS[snapshot.terminalReason] : undefined

  return {
    runId: snapshot.runId,
    title: snapshot.title,
    workflowClass,
    workflowClassLabel: workflowInfo.label,
    workflowClassDescription: workflowInfo.description,
    status: snapshot.status,
    trustPosture: workflow?.trustPosture ?? "medium",
    trustPostureLabel: trustInfo?.label,
    progress: {
      currentStep: currentStepId,
      currentStepLabel: stepInfo.label,
      currentStepDescription: stepInfo.description,
      currentStepIndex: currentIndex,
      totalSteps,
      percentage,
    },
    terminalReason: snapshot.terminalReason,
    terminalReasonLabel: terminalReasonInfo?.label,
    terminalReasonSeverity: terminalReasonInfo?.severity,
    createdAt: snapshot.createdAt,
    completedAt: snapshot.completedAt,
  }
}

export function enrichApproval(approval: Record<string, unknown>): SoothsayerApprovalDetail {
  const type = String(approval.type ?? "tool_use")
  const risk = String(approval.risk ?? "medium")
  const context = (approval.context as SoothsayerApprovalDetail["context"]) ?? {}

  const typeInfo = APPROVAL_TYPE_LABELS[type] ?? { label: type, description: "", icon: "help-circle" }
  const riskInfo = RISK_LABELS[risk] ?? { label: risk, description: "", severity: 0, color: "gray" }
  const whatNext = getApprovalWhatHappensNext(type, context)

  let titleEnriched = approval.title as string
  if (type === "command_execute" && context.command) {
    titleEnriched = `Run command: ${context.command.slice(0, 50)}${context.command.length > 50 ? "..." : ""}`
  } else if (type === "file_write" && context.filePath) {
    titleEnriched = `Write to: ${context.filePath}`
  } else if (type === "tool_use" && context.toolName) {
    titleEnriched = `Use tool: ${context.toolName}`
  }

  return {
    approvalId: String(approval.approvalId ?? ""),
    runId: String(approval.runId ?? ""),
    type,
    typeLabel: typeInfo.label,
    typeDescription: typeInfo.description,
    typeIcon: typeInfo.icon,
    status: String(approval.status ?? "pending"),
    risk,
    riskLabel: riskInfo.label,
    riskDescription: riskInfo.description,
    riskSeverity: riskInfo.severity,
    riskColor: riskInfo.color,
    title: String(approval.title ?? "Approval required"),
    titleEnriched,
    reason: String(approval.reason ?? ""),
    context,
    createdAt: String(approval.createdAt ?? new Date().toISOString()),
    updatedAt: String(approval.updatedAt ?? approval.createdAt ?? new Date().toISOString()),
    whatHappensNext: whatNext,
  }
}

function enrichApprovals(approvals: Record<string, unknown>[]): SoothsayerApprovalDetail[] {
  return approvals.map(enrichApproval)
}

export namespace SoothsayerAPI {
  export async function getOverview(): Promise<SoothsayerOverview> {
    const overview = await RunGateway.getOverview()
    const authorityMetrics = RunGateway.getAuthorityCounters()

    const activeCards = await Promise.all(
      overview.activeRuns.map(async (run) => {
        const snapshot = await RunGateway.getSnapshot(run.runId)
        return toWorkflowCard(snapshot)
      }),
    )

    const recentCards = await Promise.all(
      overview.recentRuns.map(async (run) => {
        const snapshot = await RunGateway.getSnapshot(run.runId)
        return toWorkflowCard(snapshot)
      }),
    )

    const pendingApprovals = overview.pendingApprovals.map((approval) =>
      enrichApproval({
        approvalId: approval.approvalId,
        runId: approval.runId,
        type: approval.type,
        risk: approval.risk,
        title: approval.title,
        reason: approval.reason,
        status: "pending",
        context: {},
        createdAt: approval.createdAt,
        updatedAt: approval.createdAt,
      }),
    )

    return {
      activeRuns: activeCards,
      recentRuns: recentCards,
      pendingApprovals,
      authorityMetrics,
    }
  }

  export async function getRunDetail(runId: string): Promise<SoothsayerRunDetail | null> {
    try {
      const snapshot = await RunGateway.getSnapshot(runId)
      const approvals = (await RunGateway.getApprovals(runId)) as Array<{ status: string }>

      const workflow = snapshot.workflow
      const workflowClass = workflow?.workflowClass ?? "generic"
      const workflowInfo = WORKFLOW_LABELS[workflowClass] ?? WORKFLOW_LABELS.generic
      const trustInfo = TRUST_POSTURE_LABELS[workflow?.trustPosture ?? "medium"]
      const terminalReasonInfo = snapshot.terminalReason ? TERMINAL_REASON_LABELS[snapshot.terminalReason] : undefined
      const progress = calculateProgress(workflow, snapshot.currentStep)

      return {
        runId: snapshot.runId,
        status: snapshot.status,
        authority: snapshot.authority,
        sourceSystem: snapshot.sourceSystem,
        title: snapshot.title,
        metadata: snapshot.metadata,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        progress: {
          currentStep: progress.currentStep,
          currentStepLabel: progress.currentStepLabel,
          currentStepDescription: progress.currentStepDescription,
          totalSteps: progress.totalSteps,
          percentage: progress.percentage,
        },
        trust: {
          posture: snapshot.trust?.posture ?? "unknown",
          postureLabel: TRUST_POSTURE_LABELS[snapshot.trust?.posture ?? "unknown"]?.label,
          postureDescription: TRUST_POSTURE_LABELS[snapshot.trust?.posture ?? "unknown"]?.description,
          blocked: snapshot.trust?.blocked ?? false,
        },
        workflow: workflow
          ? {
              class: workflow.workflowClass,
              classLabel: workflowInfo.label,
              classDescription: workflowInfo.description,
              stepGraph: workflow.stepGraph,
              currentStepIndex: workflow.currentStepIndex ?? 0,
              trustPosture: workflow.trustPosture,
              trustPostureLabel: trustInfo?.label,
            }
          : null,
        terminalReason: snapshot.terminalReason,
        terminalReasonLabel: terminalReasonInfo?.label,
        terminalReasonDescription: terminalReasonInfo?.description,
        terminalReasonSeverity: terminalReasonInfo?.severity,
        approvals: {
          pending: approvals.filter((a) => a.status === "pending").length,
          approved: approvals.filter((a) => a.status === "approved").length,
          denied: approvals.filter((a) => a.status === "denied").length,
        },
        artifacts: {
          total: snapshot.artifactSummary?.total ?? 0,
          latestIds: snapshot.artifactSummary?.latestArtifactIds ?? [],
        },
        lastEvent: snapshot.lastEvent ?? undefined,
      }
    } catch {
      return null
    }
  }

  export async function getRunSummary(runId: string): Promise<RunSummary | null> {
    try {
      return await RunGateway.getSummary(runId)
    } catch {
      return null
    }
  }

  export async function getApprovalQueue(runId?: string): Promise<SoothsayerApprovalDetail[]> {
    if (runId) {
      const approvals = await RunGateway.getApprovals(runId)
      return enrichApprovals(approvals as Record<string, unknown>[])
    }

    const overview = await RunGateway.getOverview()
    const allApprovals: Record<string, unknown>[] = []

    for (const run of overview.activeRuns) {
      const approvals = await RunGateway.getApprovals(run.runId)
      allApprovals.push(...(approvals.filter((a) => a.status === "pending") as Record<string, unknown>[]))
    }

    return enrichApprovals(allApprovals).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  }

  export async function getWorkflowSteps(workflowClass: WorkflowClass): Promise<string[] | null> {
    if (!isFixedWorkflow(workflowClass)) {
      return null
    }
    return getStepsForWorkflow(workflowClass).map((s) => s.stepId)
  }

  export async function resolveApproval(
    runId: string,
    approvalId: string,
    decision: "approve" | "deny",
    actorId: string,
    comment?: string,
  ) {
    const approvals = await RunGateway.getApprovals(runId)
    const approval = (approvals as Array<{ approvalId: string; status: string }>).find(
      (a) => a.approvalId === approvalId,
    )

    if (approval && approval.status !== "pending") {
      return {
        approvalId,
        status: approval.status,
        resolution: {
          decision: approval.status === "approved" ? "approve" : "deny",
          actorId,
          source: "soothsayer",
          comment: "Already resolved - idempotent response",
        },
        resolvedAt: new Date().toISOString(),
        idempotent: true,
      }
    }

    return RunGateway.resolveApproval(runId, approvalId, {
      decision,
      actorId,
      source: "soothsayer",
      comment,
    })
  }

  export function subscribeToRun(runId: string, listener: (event: unknown) => void) {
    return RunGateway.subscribe(runId, listener as (event: import("@/server/run-contract").RunEvent) => void)
  }

  export function getAuthorityCounters() {
    return RunGateway.getAuthorityCounters()
  }
}

function isFixedWorkflow(workflowClass: WorkflowClass): boolean {
  return (
    workflowClass === "draft_and_approve" || workflowClass === "repo_analyze" || workflowClass === "review_and_signoff"
  )
}
