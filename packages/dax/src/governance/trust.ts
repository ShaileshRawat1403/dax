export interface TrustDelta {
  taskId: string
  change: number // A positive or negative number indicating the change in trust
  reason: string
  timestamp: string
}
