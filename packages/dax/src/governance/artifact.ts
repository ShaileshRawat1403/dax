export interface ArtifactRecord {
  id: string
  sessionId: string
  taskId: string
  producingOperator: string
  type:
    | "diff"
    | "generated_doc"
    | "audit_result"
    | "release_report"
    | "verification_report"
    | "explore_report"
    | "command_output"
  description: string
  path: string // Path to the artifact on disk
  timestamp: string
}
