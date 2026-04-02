import { readEnv } from "@/flag/flag"

export type GuardEnforcementMode = "warn" | "enforce"

export function resolveGuardEnforcementMode(explicit?: string): GuardEnforcementMode {
  const candidate = (explicit ?? readEnv("DAX_TRUST_GUARD_MODE") ?? "warn").trim().toLowerCase()
  if (candidate === "enforce") return "enforce"
  return "warn"
}

export function shouldBlockViolation(mode: GuardEnforcementMode, risk: "medium" | "high" | "critical"): boolean {
  if (risk === "critical") return true
  return mode === "enforce"
}

