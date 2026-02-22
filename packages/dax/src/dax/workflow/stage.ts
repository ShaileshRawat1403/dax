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

export const HOME_STAGE = ["Explore", "Think", "Plan", "Execute", "Verify", "Done"] as const
export const HOME_STAGE_ELI12 = ["Explore", "Think", "Plan", "Do", "Check", "Done"] as const

export function labelStage(stage: StreamStage, eli12: boolean) {
  if (eli12) {
    return {
      exploring: "Explore",
      thinking: "Think",
      planning: "Plan",
      executing: "Do",
      verifying: "Check",
      waiting: "Need you",
      retrying: "Retry",
      done: "Done",
    }[stage]
  }

  return {
    exploring: "Exploring",
    thinking: "Thinking",
    planning: "Planning",
    executing: "Executing",
    verifying: "Verifying",
    waiting: "Waiting",
    retrying: "Retrying",
    done: "Done",
  }[stage]
}
