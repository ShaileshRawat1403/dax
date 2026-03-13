import type { SessionState, SessionSummary, Risk, NextAction, OpenQuestion } from "./state-types"

export function generateSessionSummary(state: SessionState): SessionSummary {
  const narrative = buildNarrative(state)
  const topRisks = getTopRisks(state.risks)
  const nextBestActions = getNextBestActions(state.nextActions)
  const openQuestions = state.openQuestions.filter((q) => q.status === "unanswered")

  return {
    sessionId: state.id,
    status: state.status,
    narrative,
    findingsCount: state.findings.length,
    artifactsCount: state.emittedArtifacts.length,
    trustScore: state.trustState.score,
    topRisks,
    nextBestActions,
    openQuestions,
  }
}

function buildNarrative(state: SessionState): string {
  const parts: string[] = []

  if (state.currentGoal) {
    parts.push(`Goal: ${state.currentGoal}`)
  }

  if (state.workflowId) {
    parts.push(`Running workflow: ${state.workflowId}`)
  }

  if (state.findings.length > 0) {
    const critical = state.findings.filter((f) => f.severity === "critical").length
    const major = state.findings.filter((f) => f.severity === "major").length
    parts.push(`Found ${state.findings.length} findings (${critical} critical, ${major} major).`)
  }

  if (state.emittedArtifacts.length > 0) {
    parts.push(`Generated ${state.emittedArtifacts.length} artifacts.`)
  }

  if (state.risks.length > 0) {
    parts.push(`Identified ${state.risks.length} risks.`)
  }

  if (state.approvalState.pending.length > 0) {
    parts.push(`${state.approvalState.pending.length} approvals pending.`)
  }

  parts.push(`Trust score: ${Math.round(state.trustState.score * 100)}% (${state.trustState.posture}).`)

  return parts.join(" ")
}

function getTopRisks(risks: Risk[]): Risk[] {
  // Sort by impact (high > medium > low)
  const impactOrder = { high: 0, medium: 1, low: 2 }
  return [...risks].sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]).slice(0, 3)
}

function getNextBestActions(actions: NextAction[]): NextAction[] {
  return actions.filter((a) => a.status === "pending").slice(0, 3)
}
