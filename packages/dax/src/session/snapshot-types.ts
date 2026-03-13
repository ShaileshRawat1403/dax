import type { SessionState } from "./state-types"

export interface SessionSnapshot {
  sessionId: string
  workflowId?: string
  savedAt: string
  state: SessionState
  graphStatus?: GraphStatus
}

export interface GraphStatus {
  completedNodeIds: string[]
  blockedNodeIds: string[]
  failedNodeIds: string[]
  pendingNodeIds: string[]
  currentNodeId?: string
}
