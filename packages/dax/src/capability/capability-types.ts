import z from "zod"

/** Descriptive only. No paths, grants, policy overrides, or permission defaults. */
export const CapabilityDescriptor = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$/),
    riskClass: z.enum(["low", "medium", "high"]),
    // Support classification, NOT a promise that an executor is confined.
    scopeSupport: z.enum(["none", "filesystem", "delegation", "opaque"]),
    requiresVerification: z.boolean(),
  })
  .strict()

export type CapabilityDescriptor = Readonly<z.infer<typeof CapabilityDescriptor>>
