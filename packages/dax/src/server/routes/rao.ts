import { Hono } from "hono"
import { getProjectedRunState } from "@/state/events/run-event-store"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { lazy } from "@/util/lazy"
import { RunStore } from "@/state/run-store"
import { ApprovalStore } from "@/approval/approval-store"
import { RAOAdapter } from "@/rao/adapters"
import { RAOProtocol } from "@/rao/schema"
import { Storage } from "@/storage/storage"

export const RaoRoutes = lazy(() =>
  new Hono()
    .get(
      "/run/:runID",
      describeRoute({
        summary: "Get RAO Protocol Run State",
        description: "Returns the formal RAO Protocol representation of a run's state.",
        operationId: "rao.run.get",
        responses: {
          200: {
            description: "RAO Run State",
            content: {
              "application/json": {
                schema: resolver(RAOProtocol.RunState),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        const runId = c.req.valid("param").runID
        const runState = await getProjectedRunState(runId)
        if (!runState) {
          throw new Storage.NotFoundError({ message: `Run not found: ${runId}` })
        }
        return c.json(RAOAdapter.toRAORunState(runState))
      },
    )
    .get(
      "/run/:runID/approval/:approvalID",
      describeRoute({
        summary: "Get RAO Protocol Approval Request",
        description: "Returns the formal RAO Protocol representation of an approval request.",
        operationId: "rao.approval.get",
        responses: {
          200: {
            description: "RAO Approval Request",
            content: {
              "application/json": {
                schema: resolver(RAOProtocol.ApprovalRequest),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string(), approvalID: z.string() })),
      async (c) => {
        const { runID, approvalID } = c.req.valid("param")
        const approval = await ApprovalStore.get(runID, approvalID)
        if (!approval) {
          throw new Storage.NotFoundError({ message: `Approval not found: ${approvalID}` })
        }
        return c.json(RAOAdapter.toRAOApprovalRequest(approval))
      },
    ),
)
