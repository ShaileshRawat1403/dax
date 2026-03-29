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
  executionProfile?: {
    mode: "fast" | "balanced" | "safe" | "audit-heavy"
    riskLevel: "low" | "medium" | "high"
    writeScope: "none" | "single_file" | "multi_file" | "unknown"
    approvalLikelihood: "low" | "medium" | "high"
  }
  contractDelta?: {
    inferredScope?: string[]
    inferredTargets?: string[]
    addedValidation?: string[]
    unresolvedUnknowns?: string[]
  }
  validationPlan?: {
    preflight?: string[]
    postChange?: string[]
    shipReadiness?: string[]
  }
  governanceHints?: {
    likelyTriggers?: string[]
    lowerRiskAlternatives?: string[]
    operatorDecisionsNeeded?: string[]
  }
  repoImpact?: {
    targetFiles?: string[]
    targetSubsystems?: string[]
    docsImpact?: boolean
    testImpact?: boolean
    avoidAreas?: string[]
  }
  executionPlan?: string[]
  contextSignals?: string[]
  operatorWatchouts?: string[]
  targetFiles?: string[]
  validationCommands?: string[]
  executionMode?: "fast" | "balanced" | "safe" | "audit-heavy"
  riskLevel?: "low" | "medium" | "high"
  likelyWrites?: string[]
  approvalForecast?: string[]
  unknowns?: string[]
  rollbackPlan?: string[]
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
