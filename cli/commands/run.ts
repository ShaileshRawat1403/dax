import { readFileSync } from "node:fs";
import { runSession } from "../../core/session";
import { validatePlan } from "../../core/validation";
import { Step } from "../../core/tools/schema";

export function runDax(args: string[], cwd: string): void {
  const planPath = args[0];
  if (!planPath) {
    console.error("Usage: dax run <plan.json>");
    process.exit(1);
  }
  let plan: Step[];
  try {
    const raw = readFileSync(planPath, "utf8");
    plan = JSON.parse(raw);
  } catch (e: any) {
    console.error(`Error reading or parsing plan file: ${e.message}`);
    process.exit(1);
  }

  const err = validatePlan(plan);
  if (err) {
    console.error(`Invalid plan: ${err}`);
    process.exit(1);
  }
  runSession({ projectDir: cwd, plan }).then((result) => {
    console.log(JSON.stringify(result, null, 2));
  });
}
