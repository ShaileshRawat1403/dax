import z from "zod"

export namespace RAOProtocol {
  // Layer 3: Execution Governance Protocol Schemas

  export const Scope = z.object({
    projectId: z.string(),
    directories: z.array(z.string()).optional(),
  })
  export type Scope = z.infer<typeof Scope>

  export const Actor = z.object({
    id: z.string(),
    type: z.enum(["user", "agent", "system"]),
    name: z.string().optional(),
  })
  export type Actor = z.infer<typeof Actor>

  export const RiskLevel = z.enum(["low", "medium", "high", "critical"])
  export type RiskLevel = z.infer<typeof RiskLevel>

  export const RiskProfile = z.object({
    level: RiskLevel,
    factors: z.array(z.string()),
  })
  export type RiskProfile = z.infer<typeof RiskProfile>

  export const ToolCapability = z.object({
    name: z.string(),
    description: z.string().optional(),
    provider: z.string().optional(),
  })
  export type ToolCapability = z.infer<typeof ToolCapability>

  export const RunRequest = z.object({
    intent: z.string(),
    scope: Scope,
    actor: Actor,
    riskProfile: RiskProfile,
    allowedTools: z.array(ToolCapability),
  })
  export type RunRequest = z.infer<typeof RunRequest>

  export const Step = z.object({
    stepId: z.string(),
    description: z.string(),
    status: z.enum(["pending", "running", "completed", "failed"]),
  })
  export type Step = z.infer<typeof Step>

  export const EvidenceReceipt = z.object({
    receiptId: z.string(),
    runId: z.string(),
    claim: z.string(),
    proof: z.string(),
    source: z.string(),
    verifiedAt: z.string().datetime(),
  })
  export type EvidenceReceipt = z.infer<typeof EvidenceReceipt>

  export const RunState = z.object({
    runId: z.string(),
    status: z.enum(["planned", "waiting_approval", "running", "blocked", "verified", "failed"]),
    currentStep: Step.optional(),
    evidence: z.array(EvidenceReceipt),
  })
  export type RunState = z.infer<typeof RunState>

  export const Action = z.object({
    tool: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  })
  export type Action = z.infer<typeof Action>

  export const Diff = z.object({
    filesChanged: z.number(),
    additions: z.number(),
    deletions: z.number(),
    patch: z.string(),
  })
  export type Diff = z.infer<typeof Diff>

  export const ApprovalRequest = z.object({
    approvalId: z.string(),
    runId: z.string(),
    reason: z.string(),
    proposedAction: Action,
    risk: RiskLevel,
    diffPreview: Diff.optional(),
  })
  export type ApprovalRequest = z.infer<typeof ApprovalRequest>

  export const OverrideDecision = z.object({
    approvalId: z.string(),
    decision: z.enum(["allow", "deny", "modify", "persist_rule"]),
    operator: Actor,
    reason: z.string().optional(),
  })
  export type OverrideDecision = z.infer<typeof OverrideDecision>
}
