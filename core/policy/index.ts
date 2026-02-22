import { join } from "node:path";
import { readJson, writeJson } from "../storage/json";

export type PolicyAction = "ask" | "allow" | "deny";

export interface PolicyRule {
  permission: string;
  pattern: string;
  action: PolicyAction;
}

export interface Policy {
  rules: PolicyRule[];
}

const DEFAULT_RULES: PolicyRule[] = [
  { permission: "*", pattern: "*", action: "ask" },
];

export function policyPath(projectDir: string): string {
  return join(projectDir, ".dax", "policy.json");
}

export function loadPolicy(projectDir: string): Policy {
  return readJson<Policy>(policyPath(projectDir), { rules: DEFAULT_RULES });
}

export function savePolicy(projectDir: string, policy: Policy): void {
  writeJson(policyPath(projectDir), policy);
}

export function addRule(projectDir: string, rule: PolicyRule): Policy {
  const current = loadPolicy(projectDir);
  const next = { ...current, rules: [...current.rules, rule] };
  savePolicy(projectDir, next);
  return next;
}

export function evaluate(
  rules: PolicyRule[],
  permission: string,
  pattern: string,
): PolicyAction {
  const matched = rules.filter(
    (r) => match(permission, r.permission) && match(pattern, r.pattern),
  );
  // The last matched rule wins
  const rule = matched.length
    ? matched[matched.length - 1]
    : { action: "ask" as PolicyAction };
  return rule.action;
}

function match(value: string, rule: string): boolean {
  if (rule === "*") return true;
  if (rule.endsWith("*")) return value.startsWith(rule.slice(0, -1));
  return value === rule;
}
