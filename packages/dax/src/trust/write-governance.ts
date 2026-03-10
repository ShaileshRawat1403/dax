export type WriteGovernanceStatus = "none" | "governed" | "blocked" | "ungated"

export type WriteGovernanceSignals = {
  workspace_write_artifact_count: number
  pending_approval_count: number
  override_count: number
  policy_evaluated: boolean
}

export function deriveWriteGovernanceStatus(input: WriteGovernanceSignals): WriteGovernanceStatus {
  if (input.workspace_write_artifact_count <= 0) return "none"
  if (input.pending_approval_count > 0) return "blocked"
  if (input.policy_evaluated || input.override_count > 0) return "governed"
  return "ungated"
}
