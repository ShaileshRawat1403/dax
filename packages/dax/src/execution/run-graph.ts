import { type TaskGraph, type PlannedTask, getRunnableTasks } from "../planner/task-graph"
import { OperatorRouter, defaultRouter } from "../operators/router"
import type { OperatorContext } from "../operators/base"
import type { ApprovalRequest } from "../governance/approval"
import type { ArtifactRecord } from "../governance/artifact"
import type { TrustDelta } from "../governance/trust"

export interface GraphRunResult {
  success: boolean
  blockedTasks: string[]
  failedTasks: string[]
}

const milestoneLabels: Record<string, string> = {
  task_detect_boundaries: "Boundary pass completed",
  task_detect_entrypoints: "Entry-point pass completed",
  task_trace_execution_flow: "Execution-flow pass completed",
  task_detect_integrations: "Integrations pass completed",
  task_generate_report: "Report prepared",
}

/**
 * The core DAX runtime loop.
 * Executes the task graph deterministically, routing tasks to their assigned operators,
 * and evaluating governance/approvals (RAO) after execution.
 */
export async function runGraph(
  graph: TaskGraph,
  ctx: OperatorContext,
  router: OperatorRouter = defaultRouter,
): Promise<GraphRunResult> {
  const blockedTasks: string[] = []
  const failedTasks: string[] = []
  const recordedArtifacts: ArtifactRecord[] = []
  const trustDeltas: TrustDelta[] = []
  const pendingApprovals: ApprovalRequest[] = []

  while (true) {
    const runnableTasks = getRunnableTasks(graph)

    if (runnableTasks.length === 0) {
      break
    }

    for (const task of runnableTasks) {
      task.status = "running"

      try {
        const operator = await router.route(task)
        const result = await operator.execute(task, {
          ...ctx,
          graph,
        })

        // --- RAO Governance Boundary ---
        if (result.approvalRequest) {
          task.status = "blocked"
          blockedTasks.push(task.id)
          pendingApprovals.push(result.approvalRequest)
          if (ctx.reportApprovalRequest) {
            await ctx.reportApprovalRequest(result.approvalRequest)
          }
          continue
        }

        if (!result.success) {
          task.status = "failed"
          task.error = result.error
          failedTasks.push(task.id)
          continue
        }

        // --- Execution Success ---
        task.status = "completed"
        task.result = result.output

        if (result.artifacts) {
          recordedArtifacts.push(...result.artifacts)
          if (ctx.reportArtifact) {
            for (const artifact of result.artifacts) {
              await ctx.reportArtifact(artifact)
            }
          }
        }

        if (result.trustDelta) {
          trustDeltas.push(result.trustDelta)
          console.log(`TRUST: Trust delta of ${result.trustDelta.change} for task ${task.id}`)
        }

        if (ctx.reportMilestone) {
          const label = milestoneLabels[task.id]
          if (label) {
            await ctx.reportMilestone({ taskID: task.id, label })
          }
        }
      } catch (err) {
        task.status = "failed"
        task.error = err instanceof Error ? err : new Error(String(err))
        failedTasks.push(task.id)
      }
    }

    if (blockedTasks.length > 0 || failedTasks.length > 0) {
      break
    }
  }

  // Determine final status
  const allTasksCompleted = Array.from(graph.tasks.values()).every((t) => t.status === "completed")

  if (allTasksCompleted) {
    graph.status = "completed"
  } else if (failedTasks.length > 0) {
    graph.status = "failed"
  } else if (blockedTasks.length > 0) {
    graph.status = "blocked"
  }

  return {
    success: allTasksCompleted,
    blockedTasks,
    failedTasks,
  }
}
