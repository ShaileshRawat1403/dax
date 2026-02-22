import { validatePlan } from "../validation/plan";

// A single step in an execution plan
export interface Step {
  permission: string;
  pattern?: string;
  params: Record<string, any>;
}

export function validateStep(step: Step): string | null {
  // validatePlan returns an error string or null
  return validatePlan([step]);
}
