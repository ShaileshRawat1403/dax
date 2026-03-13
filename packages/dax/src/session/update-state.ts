import type {
  SessionState,
  Finding,
  Hypothesis,
  OpenQuestion,
  Risk,
  NextAction,
  EmittedArtifact,
  TrustSignal,
  ApprovalRequest,
} from "./state-types"

// Simple UUID generator if you don't have a library
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

export class SessionStateManager {
  private state: SessionState

  constructor(initialState: SessionState) {
    this.state = initialState
  }

  getState(): SessionState {
    return this.state
  }

  updateGoal(goal: string) {
    this.state.currentGoal = goal
    this.state.updatedAt = new Date().toISOString()
  }

  updateWorkflow(workflowId: string) {
    this.state.workflowId = workflowId
    this.state.updatedAt = new Date().toISOString()
  }

  addFinding(finding: Omit<Finding, "id" | "timestamp">) {
    const newFinding: Finding = {
      ...finding,
      id: generateId(),
      timestamp: new Date().toISOString(),
    }
    this.state.findings.push(newFinding)
    this.state.updatedAt = new Date().toISOString()
    return newFinding
  }

  updateHypothesis(id: string, update: Partial<Hypothesis>) {
    const index = this.state.hypotheses.findIndex((h) => h.id === id)
    if (index !== -1) {
      this.state.hypotheses[index] = { ...this.state.hypotheses[index], ...update }
      this.state.updatedAt = new Date().toISOString()
    }
  }

  addHypothesis(hypothesis: Omit<Hypothesis, "id" | "timestamp">) {
    const newHypothesis: Hypothesis = {
      ...hypothesis,
      id: generateId(),
      timestamp: new Date().toISOString(),
    }
    this.state.hypotheses.push(newHypothesis)
    this.state.updatedAt = new Date().toISOString()
    return newHypothesis
  }

  addOpenQuestion(question: Omit<OpenQuestion, "id" | "timestamp" | "status">) {
    const newQuestion: OpenQuestion = {
      ...question,
      id: generateId(),
      status: "unanswered",
      timestamp: new Date().toISOString(),
    }
    this.state.openQuestions.push(newQuestion)
    this.state.updatedAt = new Date().toISOString()
    return newQuestion
  }

  answerQuestion(id: string, answer: string) {
    const index = this.state.openQuestions.findIndex((q) => q.id === id)
    if (index !== -1) {
      this.state.openQuestions[index].status = "answered"
      this.state.openQuestions[index].answer = answer
      this.state.updatedAt = new Date().toISOString()
    }
  }

  addRisk(risk: Omit<Risk, "id" | "timestamp" | "status">) {
    const newRisk: Risk = {
      ...risk,
      id: generateId(),
      status: "identified",
      timestamp: new Date().toISOString(),
    }
    this.state.risks.push(newRisk)
    this.state.updatedAt = new Date().toISOString()
    return newRisk
  }

  addNextAction(action: Omit<NextAction, "id" | "timestamp" | "status">) {
    const newAction: NextAction = {
      ...action,
      id: generateId(),
      status: "pending",
      timestamp: new Date().toISOString(),
    }
    this.state.nextActions.push(newAction)
    this.state.updatedAt = new Date().toISOString()
    return newAction
  }

  completeAction(id: string) {
    const index = this.state.nextActions.findIndex((a) => a.id === id)
    if (index !== -1) {
      this.state.nextActions[index].status = "completed"
      this.state.completedSteps.push(this.state.nextActions[index].description)
      this.state.updatedAt = new Date().toISOString()
    }
  }

  addEmittedArtifact(artifact: Omit<EmittedArtifact, "id" | "timestamp">) {
    const newArtifact: EmittedArtifact = {
      ...artifact,
      id: generateId(),
      timestamp: new Date().toISOString(),
    }
    this.state.emittedArtifacts.push(newArtifact)
    this.state.updatedAt = new Date().toISOString()
    return newArtifact
  }

  addTrustSignal(signal: Omit<TrustSignal, "timestamp">) {
    const newSignal: TrustSignal = {
      ...signal,
    }
    this.state.trustState.signals.push(newSignal)

    // Recalculate trust score
    const totalDelta = this.state.trustState.signals.reduce((sum, s) => sum + s.delta, 0)
    this.state.trustState.score = Math.max(0, Math.min(1, 0.5 + totalDelta)) // Base score 0.5

    // Update posture
    if (this.state.trustState.score >= 0.8) {
      this.state.trustState.posture = "trusted"
    } else if (this.state.trustState.score <= 0.3) {
      this.state.trustState.posture = "untrusted"
    } else {
      this.state.trustState.posture = "neutral"
    }

    this.state.trustState.lastUpdated = new Date().toISOString()
    this.state.updatedAt = new Date().toISOString()
  }

  addApprovalRequest(reason: string) {
    const request: ApprovalRequest = {
      requestId: generateId(),
      reason,
      requestedAt: new Date().toISOString(),
    }
    this.state.approvalState.pending.push(request)
    this.state.updatedAt = new Date().toISOString()
    return request
  }

  grantApproval(requestId: string, grantedBy: string) {
    const index = this.state.approvalState.pending.findIndex((r) => r.requestId === requestId)
    if (index !== -1) {
      const request = this.state.approvalState.pending[index]
      this.state.approvalState.pending.splice(index, 1)
      this.state.approvalState.granted.push({
        requestId,
        grantedBy,
        grantedAt: new Date().toISOString(),
      })
      this.state.updatedAt = new Date().toISOString()
    }
  }

  complete(status: "completed" | "abandoned") {
    this.state.status = status
    this.state.completedAt = new Date().toISOString()
    this.state.updatedAt = new Date().toISOString()
  }
}
