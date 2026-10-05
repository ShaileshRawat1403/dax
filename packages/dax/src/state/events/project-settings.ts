import z from "zod"

export const ProjectSettingsSnapshotSchema = z.object({
  riskMode: z.enum(["conservative", "balanced", "aggressive"]),
  preferences: z.array(z.object({ key: z.string().min(1).max(128), value: z.string().max(16_384) }).strict()).max(256),
  constraints: z.array(z.object({
    id: z.string().min(1).max(128),
    ruleType: z.enum(["never_touch", "require_approval", "deny_tool", "allow_tool"]),
    pattern: z.string().min(1).max(4_096),
    action: z.enum(["allow", "deny", "ask"]),
    source: z.enum(["default", "user", "override"]),
    createdAt: z.number().int().nonnegative(),
  }).strict()).max(1_000),
}).strict().superRefine((snapshot, ctx) => {
  if (new Set(snapshot.preferences.map((item) => item.key)).size !== snapshot.preferences.length)
    ctx.addIssue({ code: "custom", path: ["preferences"], message: "preference keys must be unique" })
  if (new Set(snapshot.constraints.map((item) => item.id)).size !== snapshot.constraints.length)
    ctx.addIssue({ code: "custom", path: ["constraints"], message: "constraint IDs must be unique" })
})

export type ProjectSettingsSnapshot = z.infer<typeof ProjectSettingsSnapshotSchema>
