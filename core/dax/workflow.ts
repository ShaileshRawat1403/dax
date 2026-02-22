export const STREAM_STAGE = [
  "exploring",
  "thinking",
  "planning",
  "executing",
  "verifying",
  "waiting",
  "retrying",
  "done",
] as const;
export type StreamStage = (typeof STREAM_STAGE)[number];

export const HOME_STAGE = [
  "Explore",
  "Think",
  "Plan",
  "Execute",
  "Verify",
  "Done",
] as const;
export type HomeStage = (typeof HOME_STAGE)[number];

export const HOME_STAGE_ELI12 = [
  "Explore",
  "Think",
  "Plan",
  "Do",
  "Check",
  "Done",
] as const;
export type HomeStageEli12 = (typeof HOME_STAGE_ELI12)[number];

export function labelStage(stage: StreamStage, eli12: boolean): string {
  const labels = {
    exploring: "Explore",
    thinking: "Think",
    planning: "Plan",
    executing: "Do",
    verifying: "Check",
    waiting: "Need you",
    retrying: "Retry",
    done: "Done",
  };
  if (eli12) {
    return labels[stage];
  }
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}
