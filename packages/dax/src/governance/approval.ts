export interface ApprovalRequest {
  id: string
  sessionId: string
  taskId: string
  requestingOperator: string
  reason: string
  timestamp: string
}

export interface ApprovalDecision {
  requestId: string
  isApproved: boolean
  approver: string // User ID
  timestamp: string
  justification?: string
}
