import { z } from "zod"

export const CheckKind = z.enum([
  "format",
  "lint",
  "typecheck",
  "test",
  "build",
  "schema",
  "security",
  "secrets",
  "eval",
  "release",
])
export type CheckKind = z.infer<typeof CheckKind>

export const RiskLevel = z.enum(["low", "medium", "high", "critical"])
export type RiskLevel = z.infer<typeof RiskLevel>

export const CheckStatus = z.enum(["passed", "failed", "skipped", "timed_out", "error"])
export type CheckStatus = z.infer<typeof CheckStatus>

export const CheckDefinition = z.object({
  id: z.string(),
  kind: CheckKind,
  label: z.string(),
  command: z.string(),
  args: z.array(z.string()).default([]),
  cwd: z.string().default("."),
  required: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(120_000),
  risk: RiskLevel.default("low"),
})
export type CheckDefinition = z.infer<typeof CheckDefinition>

export const CheckResult = z.object({
  id: z.string(),
  kind: CheckKind,
  label: z.string(),
  command: z.string(),
  cwd: z.string(),
  required: z.boolean(),
  risk: RiskLevel,
  exitCode: z.number().nullable(),
  status: CheckStatus,
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
  stdoutPreview: z.string(),
  stderrPreview: z.string(),
})
export type CheckResult = z.infer<typeof CheckResult>

export const VerificationPosture = z.enum(["verified", "guarded", "blocked", "failed"])
export type VerificationPosture = z.infer<typeof VerificationPosture>

export type VerificationReport = {
  schemaVersion: "dax.sdlc.verification.v1"
  source: "dax"
  runId: string
  repoRoot: string
  checks: CheckResult[]
  posture: VerificationPosture
  blockingReasons: string[]
  generatedAt: string
}
