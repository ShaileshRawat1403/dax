import { type TaskGraph, type PlannedTask, getRunnableTasks } from "../planner/task-graph"
import { OperatorRouter, defaultRouter } from "../operators/router"
import type { OperatorContext } from "../operators/base"
import type { ApprovalRequest } from "../governance/approval"
import type { ArtifactRecord } from "../governance/artifact"
import type { TrustDelta } from "../governance/trust"
import { SessionStateManager } from "../session/update-state"
import { saveSnapshot } from "../session/persist-state"
import type { GraphStatus } from "../session/snapshot-types"
import { buildContextPack } from "../context/build-context-pack"

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
  stateManager?: SessionStateManager,
  options?: {
    skipTaskIds?: string[]
    initialSessionState?: any
  },
): Promise<GraphRunResult> {
  const blockedTasks: string[] = []
  const failedTasks: string[] = []
  const recordedArtifacts: ArtifactRecord[] = []
  const trustDeltas: TrustDelta[] = []
  const pendingApprovals: ApprovalRequest[] = []
  const skipTaskIds = new Set(options?.skipTaskIds || [])

  // Restore initial session state if provided (for resume)
  if (options?.initialSessionState && stateManager) {
    // We need a way to set the state directly, or just use it as the base
    // For now, we'll assume the stateManager is initialized with this state
    // or we pass it to the operators
    console.log("Restoring session state from snapshot...")
  }

  while (true) {
    const runnableTasks = getRunnableTasks(graph).filter((t) => !skipTaskIds.has(t.id))

    if (runnableTasks.length === 0) {
      break
    }

    for (const task of runnableTasks) {
      // Skip if explicitly marked to skip
      if (skipTaskIds.has(task.id)) {
        continue
      }

      task.status = "running"

      try {
        const operator = await router.route(task)

        // Build context pack if state manager exists
        const contextPack = stateManager
          ? buildContextPack(stateManager.getState(), task.id, operator.type as any)
          : undefined

        const result = await operator.execute(task, {
          ...ctx,
          graph,
          contextPack,
        })

        // --- Update Session State ---
        if (stateManager) {
          // Add findings
          if (result.findings) {
            for (const finding of result.findings) {
              stateManager.addFinding(finding)
            }
          }

          // Add hypotheses
          if (result.hypotheses) {
            for (const hypothesis of result.hypotheses) {
              stateManager.addHypothesis(hypothesis)
            }
          }

          // Add open questions
          if (result.openQuestions) {
            for (const question of result.openQuestions) {
              stateManager.addOpenQuestion(question)
            }
          }

          // Add risks
          if (result.risks) {
            for (const risk of result.risks) {
              stateManager.addRisk(risk)
            }
          }

          // Add next actions
          if (result.nextActions) {
            for (const action of result.nextActions) {
              stateManager.addNextAction(action)
            }
          }

          // Add trust signals
          if (result.trustDelta) {
            stateManager.addTrustSignal({
              source: task.id,
              delta: result.trustDelta.change,
              reason: result.trustDelta.reason,
            })
          }

          // Add emitted artifacts
          if (result.artifacts) {
            for (const artifact of result.artifacts) {
              stateManager.addEmittedArtifact({
                type: artifact.type,
                name: artifact.id,
                path: artifact.path,
                description: artifact.description,
                producedBy: artifact.producingOperator,
              })
            }
          }

          // Handle approval requests
          if (result.approvalRequest) {
            stateManager.addApprovalRequest(result.approvalRequest.reason)
          }

          // Save snapshot after every state update
          const graphStatus: GraphStatus = buildGraphStatus(graph)
          saveSnapshot(ctx.sessionId, stateManager.getState(), graphStatus)
        }

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

function buildGraphStatus(graph: TaskGraph): GraphStatus {
  const completedNodeIds: string[] = []
  const blockedNodeIds: string[] = []
  const failedNodeIds: string[] = []
  const pendingNodeIds: string[] = []
  let currentNodeId: string | undefined

  for (const [id, task] of graph.tasks) {
    switch (task.status) {
      case "completed":
        completedNodeIds.push(id)
        break
      case "blocked":
        blockedNodeIds.push(id)
        break
      case "failed":
        failedNodeIds.push(id)
        break
      case "pending":
        pendingNodeIds.push(id)
        break
      case "running":
        currentNodeId = id
        break
    }
  }

  return {
    completedNodeIds,
    blockedNodeIds,
    failedNodeIds,
    pendingNodeIds,
    currentNodeId,
  }
}
