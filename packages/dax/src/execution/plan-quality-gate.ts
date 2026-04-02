import type { ExecutionContract } from "./execution-contract"

export type PlanQualityDecision = "proceed" | "pause"

export type PlanQualityCheck =
  | "goal_specificity"
  | "scope_declared"
  | "validation_declared"
  | "rollback_declared"
  | "objective_clarity"

export type PlanQualitySummary = {
  score: number
  decision: PlanQualityDecision
  failedChecks: PlanQualityCheck[]
  guidance: string[]
  checkedAt: string
}

function looksAmbiguousGoal(input: string) {
  const text = input.trim().toLowerCase()
  if (!text) return true
  if (text.length < 24) return true
  return /\b(fix|improve|update|help|do it|make it better|handle this)\b/.test(text) && !/\b(file|test|run|workflow|module|component|api|contract|scope)\b/.test(text)
}

function hasMutatingIntent(contract: ExecutionContract) {
  const policy = contract.runtimePolicy
  if (!policy) return true
  if (policy.postconditions.verificationRequired) return true
  return policy.scope.targetFiles.length > 0
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

export function evaluatePlanQuality(contract: ExecutionContract): PlanQualitySummary {
  if (!contract.intent.trim()) {
    return {
      score: 100,
      decision: "proceed",
      failedChecks: [],
      guidance: [],
      checkedAt: new Date().toISOString(),
    }
  }

  const failedChecks: PlanQualityCheck[] = []
  const guidance: string[] = []
  const scopeTargets = unique([
    ...(contract.runtimePolicy?.scope.targetFiles ?? []),
    ...(contract.runtimePolicy?.scope.targetSubsystems ?? []),
  ]).filter(Boolean)
  const validation = unique([
    ...(contract.runtimePolicy?.postconditions.validationPlan ?? []),
    ...(contract.runtimePolicy?.postconditions.validationCommands ?? []),
  ]).filter(Boolean)
  const rollbackHints = unique([
    ...(contract.runtimePolicy?.scope.avoidAreas ?? []),
    ...(contract.intent.match(/\brollback|revert|checkpoint|undo\b/gi) ? ["intent_mentions_rollback"] : []),
  ])
  const mutatingIntent = hasMutatingIntent(contract)

  if (mutatingIntent && looksAmbiguousGoal(contract.intent)) {
    failedChecks.push("goal_specificity", "objective_clarity")
    guidance.push("State one concrete objective (what should change and where) before execution.")
  }

  if (scopeTargets.length === 0 && mutatingIntent) {
    failedChecks.push("scope_declared")
    guidance.push("Declare target files or subsystems so DAX can enforce scope boundaries.")
  }

  if (validation.length === 0 && mutatingIntent) {
    failedChecks.push("validation_declared")
    guidance.push("Add at least one validation command or post-change verification step.")
  }

  if (mutatingIntent && rollbackHints.length === 0) {
    failedChecks.push("rollback_declared")
    guidance.push("Capture a rollback path (baseline ref, checkpoint, or explicit revert plan).")
  }

  const dedupedFailures = unique(failedChecks)
  const maxChecks = 5
  const passed = Math.max(0, maxChecks - dedupedFailures.length)
  const score = Math.round((passed / maxChecks) * 100)
  const decision: PlanQualityDecision = dedupedFailures.length > 0 ? "pause" : "proceed"

  return {
    score,
    decision,
    failedChecks: dedupedFailures,
    guidance: unique(guidance),
    checkedAt: new Date().toISOString(),
  }
}
