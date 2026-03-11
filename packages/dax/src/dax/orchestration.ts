import type { StreamStage } from "@/dax/workflow/stage"

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

export function labelOrchestrationPhase(phase: OrchestrationPhase, eli12: boolean) {
  if (eli12) {
    return {
      understand: "Understand",
      plan: "Plan",
      execute: "Do",
      verify: "Check",
      waiting: "Need you",
      complete: "Done",
    }[phase]
  }

  return {
    understand: "Understanding",
    plan: "Planning",
    execute: "Executing",
    verify: "Verifying",
    waiting: "Waiting for approval",
    complete: "Complete",
  }[phase]
}
