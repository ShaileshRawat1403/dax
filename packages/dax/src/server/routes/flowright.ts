import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import { errors } from "../error"
import {
  CapabilityApprovalDecisionRequest,
  CapabilityInvokeRequest,
  CapabilityInvokeResponse,
  CapabilityRunReceipt,
} from "@/flowright/capability-contract"
import { FlowrightCapabilityService } from "@/flowright/capability-service"

export const FlowrightRoutes = lazy(() =>
  new Hono()
    .post(
      "/capabilities/:capability/invocations",
      describeRoute({
        summary: "Invoke a Flowright capability",
        description: "Start a DAX-owned capability run and return a Flowright capability receipt.",
        operationId: "flowright.capability.invoke",
        responses: {
          200: {
            description: "Capability invocation receipt",
            content: {
              "application/json": {
                schema: resolver(CapabilityInvokeResponse),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ capability: z.string() })),
      validator("json", CapabilityInvokeRequest),
      async (c) => {
        const capability = c.req.valid("param").capability
        return c.json(await FlowrightCapabilityService.invoke(capability, c.req.valid("json")))
      },
    )
    .get(
      "/capabilities/invocations/:invocationId/receipt",
      describeRoute({
        summary: "Get Flowright capability receipt",
        description: "Return the current DAX-owned receipt for a Flowright capability invocation.",
        operationId: "flowright.capability.receipt",
        responses: {
          200: {
            description: "Capability run receipt",
            content: {
              "application/json": {
                schema: resolver(CapabilityRunReceipt),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ invocationId: z.string() })),
      async (c) => c.json(await FlowrightCapabilityService.getReceipt(c.req.valid("param").invocationId)),
    )
    .post(
      "/capabilities/invocations/:invocationId/approvals/:gateId",
      describeRoute({
        summary: "Forward Flowright approval decision",
        description: "Forward a delegated Flowright approval decision into DAX and return the updated receipt.",
        operationId: "flowright.capability.approval.decide",
        responses: {
          200: {
            description: "Updated capability run receipt",
            content: {
              "application/json": {
                schema: resolver(CapabilityRunReceipt),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ invocationId: z.string(), gateId: z.string() })),
      validator("json", CapabilityApprovalDecisionRequest),
      async (c) => {
        const params = c.req.valid("param")
        return c.json(
          await FlowrightCapabilityService.decideApproval(params.invocationId, params.gateId, c.req.valid("json")),
        )
      },
    ),
)
