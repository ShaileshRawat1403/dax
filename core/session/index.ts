import { recordEvent } from "../ledger";
import { loadPolicy, evaluate } from "../policy";
import { validateStep, Step } from "../tools/schema";
import { getTool, registerBuiltinTools } from "../tools";
import { saveSession, Session } from "./store";

interface RunSessionParams {
  projectDir: string;
  plan: Step[];
}

type RunResult =
  | { status: "error"; error: string }
  | { status: "pending"; step: Step }
  | { status: "denied"; step: Step }
  | { status: "ok" };

export async function runSession({
  projectDir,
  plan,
}: RunSessionParams): Promise<RunResult> {
  registerBuiltinTools();
  const policy = loadPolicy(projectDir);

  const session: Session = {
    id: Date.now().toString(36),
    ts: new Date().toISOString(),
    plan,
    status: "running",
    results: [],
  };
  recordEvent(projectDir, { type: "run", payload: { plan } });

  // Audit Phase
  for (const step of plan) {
    const err = validateStep(step);
    if (err) {
      recordEvent(projectDir, {
        type: "audit",
        payload: { step, action: "error", error: err },
      });
      session.status = "error";
      session.error = err;
      saveSession(projectDir, session);
      return { status: "error", error: err };
    }

    const tool = getTool(step.permission);
    if (!tool) {
      const error = "unknown_tool";
      recordEvent(projectDir, {
        type: "audit",
        payload: { step, action: "error", error },
      });
      session.status = "error";
      session.error = error;
      saveSession(projectDir, session);
      return { status: "error", error };
    }

    const action = evaluate(policy.rules, step.permission, step.pattern || "*");
    recordEvent(projectDir, { type: "audit", payload: { step, action } });

    if (action === "ask") {
      session.status = "pending";
      saveSession(projectDir, session);
      return { status: "pending", step };
    }

    if (action === "deny") {
      recordEvent(projectDir, {
        type: "override",
        payload: { step, decision: "deny" },
      });
      session.status = "denied";
      saveSession(projectDir, session);
      return { status: "denied", step };
    }
  }

  // Execution Phase
  for (const step of plan) {
    const tool = getTool(step.permission)!; // We know the tool exists from the audit phase
    try {
      const result = await tool({ projectDir, ...step.params });
      session.results.push({
        step: step.permission,
        status: "success",
        result,
      });
    } catch (err: any) {
      session.status = "error";
      session.error = err.message;
      saveSession(projectDir, session);
      return { status: "error", error: err.message };
    }
  }

  recordEvent(projectDir, { type: "override", payload: { decision: "allow" } });
  session.status = "ok";
  saveSession(projectDir, session);
  return { status: "ok" };
}
