import { Flag } from "@/flag/flag"

export type GuardEnforcementMode = "warn" | "enforce"

export function resolveGuardEnforcementMode(explicit?: string): GuardEnforcementMode {
  const productionEnabled = Flag.DAX_PRODUCTION || process.env.DAX_PRODUCTION === "true"
  const fallback = productionEnabled ? "enforce" : "warn"
  const envMode = process.env.DAX_TRUST_GUARD_MODE
  const candidate = (explicit ?? envMode ?? Flag.DAX_TRUST_GUARD_MODE ?? fallback).trim().toLowerCase()
  if (candidate === "enforce") return "enforce"
  return "warn"
}

export function shouldBlockViolation(mode: GuardEnforcementMode, risk: "medium" | "high" | "critical"): boolean {
  if (risk === "critical") return true
  return mode === "enforce"
}
