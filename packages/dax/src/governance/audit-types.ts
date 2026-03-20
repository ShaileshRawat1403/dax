import z from "zod"

export namespace Audit {
  export const Trigger = z.enum([
    "manual",
    "before_release",
    "after_pr_review",
    "after_config_change",
    "after_docs_policy_change",
    "after_docs_qa",
  ])
  export type Trigger = z.infer<typeof Trigger>

  export const Profile = z.enum(["strict", "balanced", "advisory"])
  export type Profile = z.infer<typeof Profile>

  export const Severity = z.enum(["critical", "high", "medium", "low", "info"])
  export type Severity = z.infer<typeof Severity>

  export const Status = z.enum(["pass", "warn", "fail"])
  export type Status = z.infer<typeof Status>

  export const Finding = z.object({
    id: z.string(),
    severity: Severity,
    category: z.string(),
    title: z.string(),
    evidence: z.string(),
    impact: z.string(),
    fix: z.string(),
    owner_hint: z.string(),
    blocking: z.boolean(),
  })
  export type Finding = z.infer<typeof Finding>

  export const Summary = z.object({
    blocker_count: z.number().int().nonnegative(),
    warning_count: z.number().int().nonnegative(),
    info_count: z.number().int().nonnegative(),
  })
  export type Summary = z.infer<typeof Summary>

  export const Result = z.object({
    run_id: z.string(),
    timestamp: z.string(),
    profile: Profile,
    status: Status,
    findings: z.array(Finding),
    summary: Summary,
    next_actions: z.array(z.string()),
    metadata: z.object({
      trigger: Trigger,
      project_id: z.string(),
      github_enabled: z.boolean(),
      auto_triggers: z.array(z.string()),
    }),
  })
  export type Result = z.infer<typeof Result>
}
