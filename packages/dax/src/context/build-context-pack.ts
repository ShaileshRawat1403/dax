import type { SessionState } from "../session/state-types"
import type { ContextPack } from "./context-types"
import { generateSessionSummary } from "../session/summarize-state"

export type OperatorType = "ExploreOperator" | "VerifyOperator" | "ReleaseOperator" | "ArtifactOperator" | "GitOperator"

export function buildContextPack(sessionState: SessionState, taskId: string, operator: OperatorType): ContextPack {
  const summary = generateSessionSummary(sessionState)

  // Select context based on operator type
  const findings = selectFindings(sessionState, operator)
  const hypotheses = selectHypotheses(sessionState, operator)
  const questions = selectQuestions(sessionState, operator)
  const risks = selectRisks(sessionState, operator)
  const artifacts = selectArtifacts(sessionState, operator)
  const nextActions = selectNextActions(sessionState, operator)

  return {
    sessionId: sessionState.id,
    workflowId: sessionState.workflowId,
    taskId,
    operator,
    goal: sessionState.currentGoal,
    repoTarget: sessionState.workspace.repo,
    validatedFindings: findings,
    activeHypotheses: hypotheses,
    openQuestions: questions,
    risks,
    importantFiles: [], // Will be populated by operators or specific selectors
    artifacts,
    trustState: sessionState.trustState,
    approvalState: sessionState.approvalState,
    nextActions,
    summary: summary.narrative,
  }
}

function selectFindings(sessionState: SessionState, operator: OperatorType): any[] {
  // For now, return all findings. In the future, filter by relevance.
  return sessionState.findings
}

function selectHypotheses(sessionState: SessionState, operator: OperatorType): any[] {
  // Prioritize active (testing) hypotheses
  return sessionState.hypotheses.filter((h) => h.status === "testing" || h.status === "pending")
}

function selectQuestions(sessionState: SessionState, operator: OperatorType): any[] {
  // Return all open questions
  return sessionState.openQuestions.filter((q) => q.status === "unanswered")
}

function selectRisks(sessionState: SessionState, operator: OperatorType): any[] {
  // Prioritize unresolved risks
  return sessionState.risks.filter((r) => r.status === "identified")
}

function selectArtifacts(sessionState: SessionState, operator: OperatorType): any[] {
  // Select relevant artifacts based on operator
  switch (operator) {
    case "ExploreOperator":
      // Return explore-related artifacts
      return sessionState.emittedArtifacts.filter((a) => a.type === "explore_report" || a.type === "map")
    case "VerifyOperator":
      // Return verification-related artifacts
      return sessionState.emittedArtifacts.filter((a) => a.type === "verification_report")
    case "ReleaseOperator":
      // Return all artifacts as evidence
      return sessionState.emittedArtifacts
    case "ArtifactOperator":
      // Return all artifacts
      return sessionState.emittedArtifacts
    default:
      return sessionState.emittedArtifacts
  }
}

function selectNextActions(sessionState: SessionState, operator: OperatorType): any[] {
  // Return pending actions relevant to this operator or the overall workflow
  return sessionState.nextActions.filter((a) => a.status === "pending")
}
