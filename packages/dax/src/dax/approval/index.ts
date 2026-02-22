export const POLICY_PROFILE = ["balanced", "strict"] as const

export type PolicyProfile = (typeof POLICY_PROFILE)[number]

export function parsePolicyProfile(value: string): PolicyProfile {
  return value === "strict" ? "strict" : "balanced"
}
