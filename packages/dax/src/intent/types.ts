export type IntentType =
  | "explore_repo"
  | "git_review"
  | "verify_session"
  | "release_readiness"
  | "artifact_inspect"
  | "docs_generate"
  | "code_change"
  | "general_query"

export interface ExecutionContract {
  goal: string
  successCriteria: string[]
  explicitConstraints: string[]
  executionPlan?: string[]
  contextSignals?: string[]
  operatorWatchouts?: string[]
  targetFiles?: string[]
  validationCommands?: string[]
  formattedPrompt?: string // The polished markdown version
  requiredFramework?: string // e.g., 'agile', 'lean'
}

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
  contract?: ExecutionContract
}
