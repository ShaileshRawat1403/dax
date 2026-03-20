import z from "zod"

export const AuditTrigger = z.enum([
  "manual",
  "before_release",
  "after_pr_review",
  "after_config_change",
  "after_docs_policy_change",
  "after_docs_qa",
])
export type AuditTrigger = z.infer<typeof AuditTrigger>

export const AuditProfile = z.enum(["strict", "balanced", "advisory"])
export type AuditProfile = z.infer<typeof AuditProfile>

export const AuditSeverity = z.enum(["critical", "high", "medium", "low", "info"])
export type AuditSeverity = z.infer<typeof AuditSeverity>

export const AuditStatus = z.enum(["pass", "warn", "fail"])
export type AuditStatus = z.infer<typeof AuditStatus>

export const AuditFinding = z.object({
  id: z.string(),
  severity: AuditSeverity,
  category: z.string(),
  title: z.string(),
  evidence: z.string(),
  impact: z.string(),
  fix: z.string(),
  owner_hint: z.string(),
  blocking: z.boolean(),
})
export type AuditFinding = z.infer<typeof AuditFinding>

export const AuditSummary = z.object({
  blocker_count: z.number().int().nonnegative(),
  warning_count: z.number().int().nonnegative(),
  info_count: z.number().int().nonnegative(),
})
export type AuditSummary = z.infer<typeof AuditSummary>

export const AuditResult = z.object({
  run_id: z.string(),
  timestamp: z.string(),
  profile: AuditProfile,
  status: AuditStatus,
  findings: z.array(AuditFinding),
  summary: AuditSummary,
  next_actions: z.array(z.string()),
  metadata: z.object({
    trigger: AuditTrigger,
    project_id: z.string(),
    github_enabled: z.boolean(),
    auto_triggers: z.array(z.string()),
  }),
})
export type AuditResult = z.infer<typeof AuditResult>
