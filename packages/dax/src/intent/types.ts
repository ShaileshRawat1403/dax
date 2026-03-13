export type IntentType =
  | "explore_repo"
  | "git_review"
  | "verify_session"
  | "release_readiness"
  | "artifact_inspect"
  | "docs_generate"
  | "code_change"
  | "general_query"

export interface IntentEnvelope {
  intentType: IntentType
  confidence: number // A value between 0 and 1
  activeMode: string // e.g., 'explore', 'execute'
  suggestedOperator: string
  requiredSkills: string[]
  requestedOutput: string // e.g., 'report', 'diff', 'console'
  riskLevel: "low" | "medium" | "high"
  scope: string // e.g., 'file', 'directory', 'repo'
  constraints: string[]
}
