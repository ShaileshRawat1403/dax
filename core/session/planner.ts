import { getProviders } from "../providers";
import { parsePlan } from "./parser";
import { Step } from "../tools/schema";

export async function createPlanFromPrompt(
  projectDir: string,
  prompt: string
): Promise<Step[]> {
  const providers = getProviders(projectDir);
  const provider = providers[0];

  if (!provider || !provider.stream) {
    throw new Error("No provider available to generate a plan");
  }

  const PLANNER_SYSTEM_PROMPT = `You are a planning assistant. Given a user's request, generate a JSON array of steps to execute it.
Each step must have:
- permission: The tool to use (e.g., "tool.read", "tool.write", "tool.exec").
- params: The parameters for the tool (e.g., { "path": "file.txt" }).
- pattern: (Optional) A filter for the tool.

Respond ONLY with the JSON array. Do not include any other text or markdown.`;

  let fullResponse = "";

  for await (const chunk of provider.stream({ prompt: PLANNER_SYSTEM_PROMPT + "\n\nUser Request: " + prompt })) {
    if (chunk.type === "text") {
      fullResponse += chunk.delta;
    }
  }

  const plan = parsePlan(fullResponse);
  if (!plan) {
    throw new Error("Failed to parse a plan from the model's response");
  }

  return plan;
}
