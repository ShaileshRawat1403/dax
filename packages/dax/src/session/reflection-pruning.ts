import type { ExecutionReflection } from "./state-types"

export interface ModelReflectionSummary {
  goal: string
  decision: "proceed" | "ask" | "branch" | "stop"
  justification_summary?: string
  requiresApproval: boolean
}

export interface ReflectionHistorySummary extends ModelReflectionSummary {
  timestamp: string
  confidence: number
}

const MAX_GOAL_LENGTH = 200
const MAX_JUSTIFICATION_LENGTH = 220

function compressJustification(justification?: string): string | undefined {
  if (!justification) return undefined

  const normalized = justification
    .replace(/\s+/g, " ")
    .replace(/^[\s\n]+|[\s\n]+$/g, "")
    .trim()

  if (normalized.length <= MAX_JUSTIFICATION_LENGTH) {
    return normalized
  }

  const sentences = normalized.split(/[.!?]+/).filter((s) => s.trim().length > 0)

  if (sentences.length > 0) {
    let result = sentences[0].trim()
    if (result.length > MAX_JUSTIFICATION_LENGTH) {
      result = result.slice(0, MAX_JUSTIFICATION_LENGTH - 3) + "..."
    }
    return result
  }

  return normalized.slice(0, MAX_JUSTIFICATION_LENGTH - 3) + "..."
}

function compressGoal(goal: string): string {
  if (goal.length <= MAX_GOAL_LENGTH) {
    return goal
  }

  const normalized = goal.replace(/\s+/g, " ").trim()
  if (normalized.length <= MAX_GOAL_LENGTH) {
    return normalized
  }

  return normalized.slice(0, MAX_GOAL_LENGTH - 3) + "..."
}

export function createReflectionSummary(reflection?: ExecutionReflection): ModelReflectionSummary | undefined {
  if (!reflection) return undefined

  return {
    goal: compressGoal(reflection.goal),
    decision: reflection.decision,
    justification_summary: compressJustification(reflection.justification),
    requiresApproval: reflection.requiresApproval,
  }
}

export function createHistoricalReflectionSummary(reflections: ExecutionReflection[]): ReflectionHistorySummary[] {
  return reflections
    .slice(-5)
    .map((r) => {
      const summary = createReflectionSummary(r)
      if (!summary) return undefined
      return {
        ...summary,
        timestamp: r.timestamp,
        confidence: r.confidence,
      }
    })
    .filter((s): s is ReflectionHistorySummary => s !== undefined)
}
