import type { StreamStage } from "@/dax/workflow/stage"
import type { IntentEnvelope } from "@/intent/types"
import { OperatorRouter, defaultRouter } from "@/operators/router"
import { createPlan } from "@/planner/planner"
import { runGraph } from "@/execution/run-graph"

export const ORCHESTRATION_PHASE = ["understand", "plan", "execute", "verify", "waiting", "complete"] as const

export type OrchestrationPhase = (typeof ORCHESTRATION_PHASE)[number]

export const ORCHESTRATION_FLOW: OrchestrationPhase[] = ["understand", "plan", "execute", "verify", "complete"]

export function streamStageToOrchestrationPhase(stage: StreamStage): OrchestrationPhase {
  switch (stage) {
    case "exploring":
    case "thinking":
      return "understand"
    case "planning":
      return "plan"
    case "executing":
      return "execute"
    case "verifying":
      return "verify"
    case "waiting":
    case "retrying":
      return "waiting"
    case "done":
      return "complete"
  }
}

// FIELD word set — tactical ops, mission-flavored, punchy operator energy
export function labelOrchestrationPhase(phase: OrchestrationPhase, _eli12: boolean) {
  return {
    understand: "Intel",
    plan: "Briefing",
    execute: "Engaged",
    verify: "Debrief",
    waiting: "Hold",
    complete: "Complete",
  }[phase]
}

/**
 * High-level control flow for DAX execution.
 * Coordinates intent interpretation, planning, and execution using the Operator Router.
 */
export class Orchestrator {
  constructor(
    private readonly router: OperatorRouter = defaultRouter
  ) {}

  /**
   * Orchestrates a single execution cycle from an interpreted intent.
   */
  async orchestrate(intent: IntentEnvelope, context: { sessionId: string; cwd: string }) {
    // 1. Generate execution plan based on intent
    const graph = await createPlan(intent, {})

    // 2. Dispatch to execution engine
    return runGraph(graph, {
      sessionId: context.sessionId,
      cwd: context.cwd
    }, this.router)
  }
}
