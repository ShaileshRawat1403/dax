import z from "zod"
import { CapabilityDescriptor } from "./capability-types"

/**
 * Contract-owned authority. A descriptor never supplies one of these grants.
 * `run` is intentionally not a filesystem confinement claim; existing runtime
 * guards and permission checks still apply to every allowed invocation.
 */
export const CapabilityGrantScope = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("run"),
      /**
       * Required before run scope can cover a filesystem-capable capability. Run
       * scope confines nothing to a path; only an operator states that it accepts
       * this, and the proposal never sets it.
       */
      acknowledgesNoFilesystemConfinement: z.literal(true).optional(),
    })
    .strict(),
  z.object({ kind: z.literal("filesystem"), roots: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal("delegation"), agents: z.array(z.string().min(1)).min(1) }).strict(),
])
export type CapabilityGrantScope = z.infer<typeof CapabilityGrantScope>

/**
 * What a grant is for. Most capabilities are named by their ID.
 *
 * An MCP capability's ID is minted from the server and the item name, and for
 * a resource or prompt it is minted at the moment of the read, so it cannot be
 * listed in advance. A grant selects those by their source: the server as
 * configured and one capability family. It never selects by the sanitized
 * alias a model sees, which is not an identity.
 */
export const CapabilityGrantSubject = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("capability"), capabilityId: CapabilityDescriptor.shape.id }).strict(),
  z
    .object({
      kind: z.literal("mcp_source"),
      server: z.string().min(1),
      family: z.enum(["tool", "resource", "prompt"]),
    })
    .strict(),
])
export type CapabilityGrantSubject = z.infer<typeof CapabilityGrantSubject>

export const CapabilityGrant = z
  .object({
    subject: CapabilityGrantSubject,
    // There is no "deny" grant: the absence of a grant is the denial.
    decision: z.enum(["allow", "ask"]),
    scope: CapabilityGrantScope,
  })
  .strict()
export type CapabilityGrant = z.infer<typeof CapabilityGrant>

function subjectKey(subject: CapabilityGrantSubject) {
  return subject.kind === "capability"
    ? `capability\0${subject.capabilityId}`
    : `mcp_source\0${subject.family}\0${subject.server}`
}

/** No duplicate authority for one subject in one immutable contract. */
export const CapabilityGrants = z.array(CapabilityGrant).superRefine((grants, ctx) => {
  const seen = new Set<string>()
  for (const [index, grant] of grants.entries()) {
    const key = subjectKey(grant.subject)
    if (seen.has(key)) {
      ctx.addIssue({ code: "custom", path: [index, "subject"], message: "Duplicate capability grant" })
    }
    seen.add(key)
    // A source selector cannot prove a filesystem target or a delegation agent.
    if (grant.subject.kind === "mcp_source" && grant.scope.kind !== "run") {
      ctx.addIssue({ code: "custom", path: [index, "scope"], message: "An MCP source grant has run scope" })
    }
    if (grant.scope.kind === "filesystem" && new Set(grant.scope.roots).size !== grant.scope.roots.length) {
      ctx.addIssue({ code: "custom", path: [index, "scope", "roots"], message: "Duplicate filesystem root" })
    }
    if (grant.scope.kind === "delegation" && new Set(grant.scope.agents).size !== grant.scope.agents.length) {
      ctx.addIssue({ code: "custom", path: [index, "scope", "agents"], message: "Duplicate delegation agent" })
    }
  }
})
export type CapabilityGrants = z.infer<typeof CapabilityGrants>
