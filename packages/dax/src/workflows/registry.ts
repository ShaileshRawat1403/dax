import type { WorkflowClass } from "@/execution/workflow-class"
import type { ExecutionContract } from "@/execution/execution-contract"
import type { WorkflowContext } from "./types"
import { DraftApproveExecuteWorkflow } from "./draft-approve-execute"
import { RepoAnalyzeWorkflow } from "./repo-analyze"
import { ReviewAndSignoffWorkflow } from "./review-and-signoff"
import { WorkerRunWorkflow } from "./worker-run"

export interface Workflow {
  execute(): Promise<{
    success: boolean
    finalArtifactId?: string
    stepResults: Array<{
      stepId: string
      success: boolean
      outputs: Array<Record<string, unknown>>
      error?: string
    }>
    error?: string
  }>
}

export type WorkflowConstructor = new (context: WorkflowContext) => Workflow

const WORKFLOW_REGISTRY: Record<string, WorkflowConstructor> = {
  draft_and_approve: DraftApproveExecuteWorkflow,
  repo_analyze: RepoAnalyzeWorkflow,
  review_and_signoff: ReviewAndSignoffWorkflow,
  worker_run: WorkerRunWorkflow,
}

export function getWorkflowConstructor(workflowClass: WorkflowClass): WorkflowConstructor | null {
  return WORKFLOW_REGISTRY[workflowClass] ?? null
}

export function createWorkflow(workflowClass: WorkflowClass, context: WorkflowContext): Workflow | null {
  const constructor = getWorkflowConstructor(workflowClass)
  if (!constructor) {
    return null
  }
  return new constructor(context)
}

export function isWorkflowAvailable(workflowClass: WorkflowClass): boolean {
  return workflowClass in WORKFLOW_REGISTRY
}

export function listAvailableWorkflows(): WorkflowClass[] {
  return Object.keys(WORKFLOW_REGISTRY) as WorkflowClass[]
}

export namespace WorkflowRegistry {
  export function get(workflowClass: WorkflowClass): WorkflowConstructor | null {
    return getWorkflowConstructor(workflowClass)
  }

  export function create(workflowClass: WorkflowClass, context: WorkflowContext): Workflow | null {
    return createWorkflow(workflowClass, context)
  }

  export function isAvailable(workflowClass: WorkflowClass): boolean {
    return isWorkflowAvailable(workflowClass)
  }

  export function list(): WorkflowClass[] {
    return listAvailableWorkflows()
  }
}
