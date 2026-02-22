import { readFileSync, existsSync } from "node:fs";
import { runSession } from "../../core/session";
import { validatePlan } from "../../core/validation";
import { Step } from "../../core/tools/schema";
import { createPlanFromPrompt } from "../../core/session/planner";

export async function runDax(args: string[], cwd: string): Promise<void> {
  // Check for flags
  const isPrompt = args.includes("--prompt");
  const planArg = args[0];

  if (!planArg) {
    console.error("Usage: dax run <plan.json> OR dax run --prompt '<description>'");
    process.exit(1);
  }

  let plan: Step[];

  if (isPrompt) {
    // If --prompt flag is present, treat arguments as a prompt
    const prompt = args.slice(1).join(" ");
    if (!prompt) {
      console.error("Error: No prompt provided.");
      process.exit(1);
    }
    console.log("Generating plan...");
    plan = await createPlanFromPrompt(cwd, prompt);
  } else {
    // Otherwise, treat it as a file path
    if (!existsSync(planArg)) {
      console.error(`Error: File not found: ${planArg}`);
      process.exit(1);
    }
    try {
      const raw = readFileSync(planArg, "utf8");
      plan = JSON.parse(raw);
    } catch (e: any) {
      console.error(`Error reading or parsing plan file: ${e.message}`);
      process.exit(1);
    }
  }

  const err = validatePlan(plan);
  if (err) {
    console.error(`Invalid plan: ${err}`);
    process.exit(1);
  }

  console.log("Executing plan:", JSON.stringify(plan, null, 2));
  const result = await runSession({ projectDir: cwd, plan });
  console.log(JSON.stringify(result, null, 2));
}
