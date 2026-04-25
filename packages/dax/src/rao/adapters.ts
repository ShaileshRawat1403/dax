import type { Approval as InternalApproval } from "@/approval/approval-types"
import type { ExecutionContract as InternalExecutionContract } from "@/execution/execution-contract"
import type { RunState as InternalRunState, StepRecord } from "@/state/run-state"
import { RAOProtocol } from "./schema"

export namespace RAOAdapter {
  export function toRAORunState(internal: InternalRunState): RAOProtocol.RunState {
    let status: RAOProtocol.RunState["status"] = "failed"
    switch (internal.status) {
      case "created":
      case "compiled":
        status = "planned"
        break
      case "queued":
      case "running":
        status = "running"
        break
      case "waiting_approval":
        status = "waiting_approval"
        break
      case "completed":
        status = "verified"
        break
      case "failed":
      case "cancelled":
        status = "failed"
        break
      default:
        status = "failed"
    }

    let currentStep: RAOProtocol.Step | undefined
    if (internal.currentStepId) {
      const step = internal.steps.find((s: StepRecord) => s.stepId === internal.currentStepId)
      if (step) {
        currentStep = {
          stepId: step.stepId,
          description: step.title,
          status: mapStepStatus(step.status),
        }
      }
    }

    return {
      runId: internal.runId,
      status,
      currentStep,
      evidence: [], // Expected to be populated by the audit system
    }
  }

  function mapStepStatus(status: StepRecord["status"]): RAOProtocol.Step["status"] {
    switch (status) {
      case "proposed":
      case "blocked":
        return "pending"
      case "running":
        return "running"
      case "completed":
        return "completed"
      case "failed":
        return "failed"
      default:
        return "failed"
    }
  }

  export function toRAOApprovalRequest(internal: InternalApproval): RAOProtocol.ApprovalRequest {
    const proposedTool = internal.context?.toolName || internal.context?.command || internal.type
    return {
      approvalId: internal.approvalId,
      runId: internal.runId,
      reason: internal.reason,
      proposedAction: {
        tool: proposedTool,
        parameters: {
          filePath: internal.context?.filePath,
          command: internal.context?.command,
        },
      },
      risk: internal.risk,
      diffPreview: internal.context?.diffPreview
        ? {
            filesChanged: 1, // Basic heuristic since diff payload parsing isn't standardized yet
            additions: 0,
            deletions: 0,
            patch: internal.context.diffPreview,
          }
        : undefined,
    }
  }

  export function toRAORunRequest(internal: InternalExecutionContract): RAOProtocol.RunRequest {
    return {
      intent: internal.intent,
      scope: {
        projectId: internal.projectId || "unknown-project",
        directories: internal.repoPath ? [internal.repoPath] : undefined,
      },
      actor: {
        id: internal.initiatedBy || "system",
        type: "system", // Defaulting to system unless actor type is specifically tracked
      },
      riskProfile: {
        level: internal.riskLevel,
        factors: [], // Risk factors to be populated from internal policies
      },
      allowedTools: internal.toolAllowlist.map((tool: string) => ({
        name: tool,
      })),
    }
  }
}
