import z from "zod"

/**
 * Boundary types shared with Rook (and any other external host that wants
 * DAX governance decisions). Versioned independently of internal RAO types.
 *
 * Keep this file in sync with the schemas in
 * rook/docs/integrations/dax-agent-and-sentinel.md (Section 6).
 */
export namespace RookBridge {
  export const SCHEMA_VERSION = "0.1.0" as const

  export const RiskLevel = z.enum(["low", "medium", "high", "critical"])
  export type RiskLevel = z.infer<typeof RiskLevel>

  export const Decision = z.enum([
    "allow",
    "deny",
    "modify",
    "needs_approval",
    "persist_rule",
  ])
  export type Decision = z.infer<typeof Decision>

  export const ProposedAction = z.object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().min(1),
    runId: z.string().min(1),
    source: z.literal("rook"),
    sourceAgent: z.string().min(1),
    tool: z.string().min(1),
    target: z.string().optional(),
    command: z.string().optional(),
    reason: z.string().optional(),
    diffPreview: z.string().optional(),
    riskHint: RiskLevel.optional(),
  })
  export type ProposedAction = z.infer<typeof ProposedAction>

  export const GovernanceDecision = z.object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    actionId: z.string().min(1),
    source: z.literal("dax"),
    decision: Decision,
    risk: RiskLevel,
    reason: z.string(),
    requiredEvidence: z.array(z.string()).optional(),
    modifiedAction: ProposedAction.optional(),
    reversible: z.boolean(),
  })
  export type GovernanceDecision = z.infer<typeof GovernanceDecision>
}
