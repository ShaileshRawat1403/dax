import {
  loadPolicy,
  addRule,
  savePolicy,
  PolicyAction,
} from "../../core/policy";

export function runPolicy(args: string[], cwd: string): void {
  const sub = args[0];
  if (!sub || sub === "show" || sub === "list") {
    const policy = loadPolicy(cwd);
    console.log(JSON.stringify(policy, null, 2));
    return;
  }

  if (sub === "allow" || sub === "deny" || sub === "ask") {
    const permission = args[1];
    const pattern = args[2] || "*";
    if (!permission) {
      console.error(
        "Usage: dax policy <allow|deny|ask> <permission> [pattern]",
      );
      process.exit(1);
    }
    const next = addRule(cwd, {
      permission,
      pattern,
      action: sub as PolicyAction,
    });
    console.log(JSON.stringify(next, null, 2));
    return;
  }

  if (sub === "remove") {
    const index = Number(args[1]);
    if (!Number.isInteger(index)) {
      console.error("Usage: dax policy remove <index>");
      process.exit(1);
    }
    const current = loadPolicy(cwd);
    const next = {
      ...current,
      rules: current.rules.filter((_, i) => i !== index),
    };
    savePolicy(cwd, next);
    console.log(JSON.stringify(next, null, 2));
    return;
  }

  if (sub === "reset") {
    savePolicy(cwd, {
      rules: [{ permission: "*", pattern: "*", action: "ask" }],
    });
    console.log(JSON.stringify(loadPolicy(cwd), null, 2));
    return;
  }

  console.error(
    "Usage: dax policy [show|list] | <allow|deny|ask> <permission> [pattern] | remove <index> | reset",
  );
  process.exit(1);
}
