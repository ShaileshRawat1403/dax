import { Step } from "../tools/schema";

/**
 * Validates the structure of a proposed execution plan.
 * @param plan The plan to validate.
 * @returns An error message string if invalid, otherwise null.
 */
export function validatePlan(plan: any): string | null {
  if (!Array.isArray(plan)) {
    return "Plan must be an array of steps.";
  }
  for (const step of plan as Step[]) {
    if (typeof step !== "object" || step === null) {
      return "Each step must be an object.";
    }
    if (!step.permission) {
      return "Each step must specify a permission (e.g., tool.read).";
    }
    if (typeof step.permission !== "string") {
      return "Step permission must be a string.";
    }
    if (
      step.params !== undefined &&
      (typeof step.params !== "object" || step.params === null)
    ) {
      return `Step ${step.permission} has invalid params. 'params' must be an object.`;
    }
  }
  return null;
}
