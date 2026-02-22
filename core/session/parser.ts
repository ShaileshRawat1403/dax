import { Step } from "../tools/schema";

/**
 * Extracts a JSON plan from markdown code blocks.
 * Looks for ```json ... ``` blocks containing an array of steps.
 */
export function parsePlan(text: string): Step[] | null {
  const regex = /```json\s*([\s\S]*?)\s*```/g;
  const matches = [...text.matchAll(regex)];

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);
      // A simple check to see if it looks like a plan
      if (Array.isArray(parsed) && parsed.every((p) => p.permission)) {
        return parsed as Step[];
      }
    } catch (e) {
      // Continue to next block if JSON is invalid
    }
  }
  return null;
}
