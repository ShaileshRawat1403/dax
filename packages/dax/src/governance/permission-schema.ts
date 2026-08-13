import { Identifier } from "@/id/id"
import z from "zod"

export const PermissionRequest = z
  .object({
    id: Identifier.schema("permission"),
    createdAt: z.number().int().nonnegative(),
    sessionID: Identifier.schema("session"),
    permission: z.string(),
    patterns: z.string().array(),
    metadata: z.record(z.string(), z.any()),
    always: z.string().array(),
    tool: z
      .object({
        messageID: z.string(),
        callID: z.string(),
      })
      .optional(),
  })
  .meta({
    ref: "PermissionRequest",
  })

export type PermissionRequest = z.infer<typeof PermissionRequest>
