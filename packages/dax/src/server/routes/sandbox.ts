import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Sandbox } from "@/shell/sandbox"
import { SandboxCapability } from "@/shell/sandbox/types"

const SandboxStatusResponse = z.object({
  enabled: z.boolean(),
  provider: z.string(),
  capability: SandboxCapability.nullable(),
})

export const SandboxRoutes = new Hono().get(
  "/status",
  describeRoute({
    summary: "Sandbox status",
    description: "Returns the current sandbox provider, capability, and enabled state.",
    operationId: "sandbox.status",
    responses: {
      200: {
        description: "Sandbox status",
        content: {
          "application/json": {
            schema: resolver(SandboxStatusResponse),
          },
        },
      },
    },
  }),
  async (c) => {
    const [enabled, provider, capability] = await Promise.all([
      Sandbox.isEnabled(),
      Sandbox.getProvider(),
      Sandbox.getCapability(),
    ])
    return c.json({ enabled, provider, capability })
  },
)
