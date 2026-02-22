import { evaluate, addRule, loadPolicy, PolicyAction } from "../policy";
import { recordEvent } from "../ledger";
import { createInterface } from "node:readline";
import { addPending, resolvePending, PendingItem } from "./pending";

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

interface RequireApprovalParams {
  projectDir: string;
  permission: string;
  pattern: string;
  reason: string;
}

export async function requireApproval({
  projectDir,
  permission,
  pattern,
  reason,
}: RequireApprovalParams): Promise<"allow"> {
  const policy = loadPolicy(projectDir);
  const action: PolicyAction = evaluate(policy.rules, permission, pattern);

  recordEvent(projectDir, {
    type: "audit",
    payload: { permission, pattern, action, reason },
  });

  if (action === "allow") {
    return "allow";
  }

  if (action === "deny") {
    recordEvent(projectDir, {
      type: "override",
      payload: { decision: "deny", permission, pattern },
    });
    throw new Error(`Denied by policy: ${permission} ${pattern}`);
  }

  // Action is "ask"
  const pending: PendingItem = {
    id: Date.now().toString(36),
    ts: new Date().toISOString(),
    permission,
    pattern,
    reason,
  };
  addPending(projectDir, pending);

  // If we are in a TUI or non-interactive environment, don't block with readline.
  // The TUI will pick up the 'pending' item and resolve it.
  if (!process.stdin.isTTY || process.stdin.isRaw) {
    throw new Error(
      `PENDING_APPROVAL: ${permission} ${pattern}. Resolve via TUI/CLI.`,
    );
  }

  const answer = await prompt(
    `Approve ${permission} ${pattern}? (y=once, a=always, n=deny): `,
  );
  resolvePending(projectDir, pending.id);

  if (answer === "a") {
    addRule(projectDir, { permission, pattern, action: "allow" });
    recordEvent(projectDir, {
      type: "override",
      payload: { decision: "allow_always", permission, pattern },
    });
    return "allow";
  }

  if (answer === "y") {
    recordEvent(projectDir, {
      type: "override",
      payload: { decision: "allow_once", permission, pattern },
    });
    return "allow";
  }

  recordEvent(projectDir, {
    type: "override",
    payload: { decision: "deny", permission, pattern },
  });
  throw new Error("User denied approval");
}
