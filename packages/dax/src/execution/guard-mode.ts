import { Flag } from "@/flag/flag"

export type GuardEnforcementMode = "warn" | "enforce"

export function resolveGuardEnforcementMode(explicit?: string): GuardEnforcementMode {
  const fallback = Flag.DAX_PRODUCTION ? "enforce" : "warn"
  const candidate = (explicit ?? Flag.DAX_TRUST_GUARD_MODE ?? fallback).trim().toLowerCase()
  if (candidate === "enforce") return "enforce"
  return "warn"
}

export function shouldBlockViolation(mode: GuardEnforcementMode, risk: "medium" | "high" | "critical"): boolean {
  if (risk === "critical") return true
  return mode === "enforce"
}

