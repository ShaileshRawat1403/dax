import { type TaskGraph, type PlannedTask, getRunnableTasks } from "../planner/task-graph"
import { OperatorRouter, defaultRouter } from "../operators/router"
import type { OperatorContext } from "../operators/base"
import type { ApprovalRequest } from "../governance/approval"
import type { ArtifactRecord } from "../governance/artifact"
import type { TrustDelta } from "../governance/trust"
import { SessionStateManager } from "../session/update-state"
import { saveSnapshot } from "../session/persist-state"
import type { GraphStatus } from "../session/snapshot-types"
import { buildContextPack, OPERATOR_TYPES, type OperatorType } from "../context/build-context-pack"
import { Bus } from "@/bus"
import { Lifecycle } from "@/bus/lifecycle"

function isOperatorType(value: string): value is OperatorType {
  return (OPERATOR_TYPES as readonly string[]).includes(value)
}

export interface GraphRunResult {
  success: boolean
  blockedTasks: string[]
  failedTasks: string[]
  warnings: string[]
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
  const warnings: string[] = []
  const skipTaskIds = new Set(options?.skipTaskIds || [])

  // Restore initial session state if provided (for resume)
  if (options?.initialSessionState && stateManager) {
    // We need a way to set the state directly, or just use it as the base
    // For now, we'll assume the stateManager is initialized with this state
    // or we pass it to the operators
    // State restore is handled by the stateManager initializer; nothing to do here yet.
  }

  const previousGraphStatus = graph.status
  graph.status = "running"
  
  await Bus.publish(Lifecycle.RunStateChanged, {
    runId: ctx.sessionId,
    previousStatus: previousGraphStatus as any,
    currentStatus: "running",
  })

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
      await Bus.publish(Lifecycle.PlanStepPromoted, {
        runId: ctx.sessionId,
        stepId: task.id,
        status: "running",
      })

      try {
        const operator = await router.route(task)

        // Build context pack if state manager exists. Narrowed rather than
        // cast: an unrecognised operator must not silently receive a pack
        // assembled for no one.
        const contextPack =
          stateManager && isOperatorType(operator.type)
            ? buildContextPack(stateManager.getState(), task.id, operator.type)
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
          await saveSnapshot(ctx.sessionId, stateManager.getState(), {
            cwd: ctx.cwd,
            graphStatus,
            workflowId: stateManager.getState().workflowId,
          })
        }

        // --- RAO Governance Boundary ---
        if (result.approvalRequest) {
          task.status = "blocked"
          await Bus.publish(Lifecycle.PlanStepPromoted, {
            runId: ctx.sessionId,
            stepId: task.id,
            status: "blocked",
          })
          blockedTasks.push(task.id)
          pendingApprovals.push(result.approvalRequest)
          if (ctx.reportApprovalRequest) {
            await ctx.reportApprovalRequest(result.approvalRequest)
          }
          continue
        }

        if (!result.success) {
          task.status = "failed"
          await Bus.publish(Lifecycle.PlanStepPromoted, {
            runId: ctx.sessionId,
            stepId: task.id,
            status: "failed",
          })
          await Bus.publish(Lifecycle.InterventionRequired, {
            runId: ctx.sessionId,
            reason: `Task ${task.id} failed: ${result.error?.message || "Unknown error"}`,
            type: "error_recovery",
          })
          task.error = result.error
          failedTasks.push(task.id)
          continue
        }

        // --- Execution Success ---
        task.result = result.output

        if (ctx.reportMilestone && milestoneLabels[task.id]) {
          await ctx.reportMilestone({ taskID: task.id, label: milestoneLabels[task.id]! })
        }

        // --- HITL Checkpoint ---
        if (task.is_hitl) {
          task.status = "awaiting_approval"
          await Bus.publish(Lifecycle.PlanStepPromoted, {
            runId: ctx.sessionId,
            stepId: task.id,
            status: "blocked", // HITL counts as blocked for step promotion status
          })
          blockedTasks.push(task.id)
          continue
        }

        // --- Verification Phase ---
        if (task.verification_criteria && task.verification_criteria.length > 0) {
          task.verification_status = "pending"
          task.status = "failed"
          await Bus.publish(Lifecycle.PlanStepPromoted, {
            runId: ctx.sessionId,
            stepId: task.id,
            status: "failed",
          })
          task.error = new Error(
            `Task ${task.id} requires verification criteria but no verification handoff is implemented`,
          )
          failedTasks.push(task.id)
          warnings.push(`verification unavailable for task ${task.id}`)
          continue
        }

        task.status = "completed"
        await Bus.publish(Lifecycle.PlanStepPromoted, {
          runId: ctx.sessionId,
          stepId: task.id,
          status: "completed",
        })
      } catch (err) {
        task.status = "failed"
        await Bus.publish(Lifecycle.PlanStepPromoted, {
          runId: ctx.sessionId,
          stepId: task.id,
          status: "failed",
        })
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

  const finalPreviousStatus = graph.status
  if (allTasksCompleted) {
    graph.status = "completed"
  } else if (failedTasks.length > 0) {
    graph.status = "failed"
  } else if (blockedTasks.length > 0) {
    graph.status = "blocked"
  }

  if (finalPreviousStatus !== graph.status) {
    await Bus.publish(Lifecycle.RunStateChanged, {
      runId: ctx.sessionId,
      previousStatus: finalPreviousStatus as any,
      currentStatus: graph.status as any,
    })
  }

  return {
    success: allTasksCompleted,
    blockedTasks,
    failedTasks,
    warnings,
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
