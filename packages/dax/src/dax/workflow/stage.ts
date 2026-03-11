import { ORCHESTRATION_FLOW, labelOrchestrationPhase, streamStageToOrchestrationPhase } from "@/dax/orchestration"

export const STREAM_STAGE = [
  "exploring",
  "thinking",
  "planning",
  "executing",
  "verifying",
  "waiting",
  "retrying",
  "done",
] as const

export type StreamStage = (typeof STREAM_STAGE)[number]

export const HOME_STAGE = ORCHESTRATION_FLOW.map((phase) => labelOrchestrationPhase(phase, false)) as readonly string[]
export const HOME_STAGE_ELI12 = ORCHESTRATION_FLOW.map((phase) => labelOrchestrationPhase(phase, true)) as readonly string[]

export function labelStage(stage: StreamStage, eli12: boolean) {
  return labelOrchestrationPhase(streamStageToOrchestrationPhase(stage), eli12)
}
