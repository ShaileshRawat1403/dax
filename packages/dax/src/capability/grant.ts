import z from "zod"
import { CapabilityDescriptor } from "./capability-types"

/**
 * Contract-owned authority. A descriptor never supplies one of these grants.
 * `run` is intentionally not a filesystem confinement claim; existing runtime
 * guards and permission checks still apply to every allowed invocation.
 */
export const CapabilityGrantScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run") }).strict(),
  z.object({ kind: z.literal("filesystem"), roots: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal("delegation"), agents: z.array(z.string().min(1)).min(1) }).strict(),
])
export type CapabilityGrantScope = z.infer<typeof CapabilityGrantScope>

export const CapabilityGrant = z
  .object({
    capabilityId: CapabilityDescriptor.shape.id,
    decision: z.enum(["allow", "ask"]),
    scope: CapabilityGrantScope,
  })
  .strict()
export type CapabilityGrant = z.infer<typeof CapabilityGrant>

/** No duplicate authority for one capability in one immutable contract. */
export const CapabilityGrants = z.array(CapabilityGrant).superRefine((grants, ctx) => {
  const seen = new Set<string>()
  for (const [index, grant] of grants.entries()) {
    if (seen.has(grant.capabilityId)) {
      ctx.addIssue({ code: "custom", path: [index, "capabilityId"], message: "Duplicate capability grant" })
    }
    seen.add(grant.capabilityId)
    if (grant.scope.kind === "filesystem" && new Set(grant.scope.roots).size !== grant.scope.roots.length) {
      ctx.addIssue({ code: "custom", path: [index, "scope", "roots"], message: "Duplicate filesystem root" })
    }
    if (grant.scope.kind === "delegation" && new Set(grant.scope.agents).size !== grant.scope.agents.length) {
      ctx.addIssue({ code: "custom", path: [index, "scope", "agents"], message: "Duplicate delegation agent" })
    }
  }
})
export type CapabilityGrants = z.infer<typeof CapabilityGrants>
