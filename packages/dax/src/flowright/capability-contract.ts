import z from "zod"

export const CAPABILITY_CONTRACT_VERSION = "flowright.capability.v0"

export const CapabilityTerminalState = z.enum(["succeeded", "failed", "cancelled", "needs_approval"])
export type CapabilityTerminalState = z.infer<typeof CapabilityTerminalState>

export const CapabilityFailureCode = z.enum([
  "authority_unavailable",
  "invocation_rejected",
  "policy_denied",
  "verification_failed",
  "approval_rejected",
  "capability_timeout",
  "receipt_invalid",
])
export type CapabilityFailureCode = z.infer<typeof CapabilityFailureCode>

export const CapabilityApproval = z.object({
  gateId: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  summary: z.string().optional(),
})
export type CapabilityApproval = z.infer<typeof CapabilityApproval>

export const CapabilityArtifactRef = z.object({
  ref: z.string(),
  type: z.string(),
  digest: z.string().optional(),
  title: z.string().optional(),
})
export type CapabilityArtifactRef = z.infer<typeof CapabilityArtifactRef>

export const CapabilityFailure = z.object({
  code: CapabilityFailureCode,
  reason: z.string(),
  retryable: z.boolean(),
})
export type CapabilityFailure = z.infer<typeof CapabilityFailure>

export const CapabilityRunReceipt = z.object({
  contractVersion: z.literal(CAPABILITY_CONTRACT_VERSION),
  capability: z.string(),
  invocationId: z.string(),
  externalRunId: z.string(),
  authority: z.string(),
  terminalState: CapabilityTerminalState,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  evidenceDigest: z.string().optional(),
  artifacts: CapabilityArtifactRef.array(),
  approvals: CapabilityApproval.array(),
  failure: CapabilityFailure.optional(),
  deepLink: z.string().optional(),
})
export type CapabilityRunReceipt = z.infer<typeof CapabilityRunReceipt>

export const CapabilityInvokeRequest = z.object({
  invocationId: z.string().optional(),
  input: z.object({
    prompt: z.string().optional(),
    repoPath: z.string().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  }),
  flowright: z
    .object({
      runId: z.string().optional(),
      stepId: z.string().optional(),
      attemptNumber: z.number().optional(),
    })
    .optional(),
  timeoutMs: z.number().min(0).max(30000).optional(),
})
export type CapabilityInvokeRequest = z.infer<typeof CapabilityInvokeRequest>

export const CapabilityInvokeResponse = z.object({
  invocationId: z.string(),
  externalRunId: z.string(),
  receipt: CapabilityRunReceipt,
})
export type CapabilityInvokeResponse = z.infer<typeof CapabilityInvokeResponse>

export const CapabilityApprovalDecisionRequest = z.object({
  decision: z.enum(["approve", "deny"]),
  actorId: z.string(),
  comment: z.string().optional(),
})
export type CapabilityApprovalDecisionRequest = z.infer<typeof CapabilityApprovalDecisionRequest>
