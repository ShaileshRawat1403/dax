import type { IntentEnvelope } from "../intent/types"
import { type TaskGraph, createTaskGraph, addTask } from "./task-graph"
import { Bus } from "@/bus"
import { Lifecycle } from "@/bus/lifecycle"

export interface PlannerContext {
  session_id?: string
  // Add relevant context here (workspace info, etc.)
}

/**
 * Creates an execution graph based on the interpreted intent.
 */
export async function createPlan(intent: IntentEnvelope, context: PlannerContext): Promise<TaskGraph> {
  const graph = createTaskGraph(`plan_${Date.now()}`)

  if (intent.intentType === "explore_repo") {
    addTask(graph, {
      id: "task_detect_boundaries",
      name: "Detect Boundaries",
      description: "Identify the project root and primary module boundaries.",
      operator_type: "explore",
      dependencies: [],
      context: { intent },
    })

    addTask(graph, {
      id: "task_detect_entrypoints",
      name: "Detect Entry Points",
      description: "Find runtime and execution entry points.",
      operator_type: "explore",
      dependencies: ["task_detect_boundaries"],
      context: { intent },
    })

    addTask(graph, {
      id: "task_trace_execution_flow",
      name: "Trace Execution Flow",
      description: "Trace execution flow and map architecture.",
      operator_type: "explore",
      dependencies: ["task_detect_entrypoints"],
      context: { intent },
    })

    addTask(graph, {
      id: "task_detect_integrations",
      name: "Detect Integrations",
      description: "Find and map external integrations.",
      operator_type: "explore",
      dependencies: ["task_detect_entrypoints"],
      context: { intent },
    })

    addTask(graph, {
      id: "task_generate_report",
      name: "Generate Report",
      description: "Synthesize findings into an execution-oriented report.",
      operator_type: "explore",
      dependencies: ["task_trace_execution_flow", "task_detect_integrations"],
      context: { intent },
    })
  } else {
    // Default fallback
    addTask(graph, {
      id: "task_general_execution",
      name: "Execute Request",
      description: "Process the general request.",
      operator_type: "general",
      dependencies: [],
      context: { intent },
    })
  }

  if (context.session_id) {
    const tasks = Array.from(graph.tasks.values()).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      dependencies: t.dependencies,
    }))

    await Bus.publish(Lifecycle.PlanCompiled, {
      runId: context.session_id,
      planId: graph.id,
      tasks,
    })
  }

  return graph
}
