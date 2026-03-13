export interface PolicyEvaluation {
  policyId: string
  result: "pass" | "fail" | "warn"
  message?: string
  timestamp: string
}
