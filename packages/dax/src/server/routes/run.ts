import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { lazy } from "@/util/lazy"
import {
  ApprovalRecord,
  ArtifactRecord,
  CreateRunRequest,
  CreateRunResponse,
  GetApprovalsResponse,
  RunOverviewResponse,
  ResolveApprovalRequest,
  ResolveApprovalResponse,
  RunEvent,
  RunSnapshot,
  RunSummary,
  ProjectedRun,
} from "../run-contract"
import { RunGateway } from "../run-gateway"

export const RunRoutes = lazy(() =>
  new Hono()
    .get(
      "/overview",
      describeRoute({
        summary: "Get run overview",
        description: "Return list-oriented operator views for active runs, pending approvals, and recent runs.",
        operationId: "run.overview",
        responses: {
          200: {
            description: "Run overview",
            content: {
              "application/json": {
                schema: resolver(RunOverviewResponse),
              },
            },
          },
        },
      }),
      validator("query", z.object({ limit: z.coerce.number().optional() })),
      async (c) => {
        return c.json(await RunGateway.getOverview(c.req.valid("query").limit))
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Create run",
        description: "Create a DAX-backed external run and start execution against the current workspace.",
        operationId: "run.create",
        responses: {
          200: {
            description: "Run created",
            content: {
              "application/json": {
                schema: resolver(CreateRunResponse),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", CreateRunRequest),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(await RunGateway.createRun(body))
      },
    )
    .get(
      "/:runID",
      describeRoute({
        summary: "Get run snapshot",
        description: "Return the durable run snapshot used for reconnect and recovery.",
        operationId: "run.get",
        responses: {
          200: {
            description: "Run snapshot",
            content: {
              "application/json": {
                schema: resolver(RunSnapshot),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        return c.json(await RunGateway.getSnapshot(c.req.valid("param").runID))
      },
    )
    .get(
      "/:runID/events",
      describeRoute({
        summary: "Stream run events",
        description: "Subscribe to the run event stream using cursor-based SSE replay.",
        operationId: "run.events",
        responses: {
          200: {
            description: "Run event stream",
            content: {
              "text/event-stream": {
                schema: resolver(RunEvent),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      validator("query", z.object({ cursor: z.string().optional() })),
      async (c) => {
        const runID = c.req.valid("param").runID
        const cursor = c.req.valid("query").cursor
        return streamSSE(c, async (stream) => {
          const replay = await RunGateway.replayEvents(runID, cursor)
          for (const event of replay) {
            await stream.writeSSE({
              event: event.type,
              id: event.cursor,
              data: JSON.stringify(event),
            })
          }

          const unsubscribe = RunGateway.subscribe(runID, (event) => {
            stream.writeSSE({
              event: event.type,
              id: event.cursor,
              data: JSON.stringify(event),
            })
          })

          const heartbeat = setInterval(() => {
            stream.writeSSE({
              event: "server.heartbeat",
              data: JSON.stringify({ runId: runID }),
            })
          }, 30000)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              unsubscribe()
              resolve()
            })
          })
        })
      },
    )
    .get(
      "/:runID/approvals",
      describeRoute({
        summary: "Get run approvals",
        description: "Return the current approval queue for a run.",
        operationId: "run.approvals.list",
        responses: {
          200: {
            description: "Run approvals",
            content: {
              "application/json": {
                schema: resolver(GetApprovalsResponse),
              },
            },
          },
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        const runID = c.req.valid("param").runID
        return c.json({
          runId: runID,
          approvals: await RunGateway.getApprovals(runID),
        })
      },
    )
    .post(
      "/:runID/approvals/:approvalID",
      describeRoute({
        summary: "Resolve approval",
        description: "Approve or deny a pending run approval through the external run API.",
        operationId: "run.approvals.resolve",
        responses: {
          200: {
            description: "Approval resolved",
            content: {
              "application/json": {
                schema: resolver(ResolveApprovalResponse),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string(), approvalID: z.string() })),
      validator("json", ResolveApprovalRequest),
      async (c) => {
        const params = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await RunGateway.resolveApproval(params.runID, params.approvalID, body))
      },
    )
    .get(
      "/:runID/artifacts",
      describeRoute({
        summary: "List run artifacts",
        description: "Return the currently known artifacts for a run.",
        operationId: "run.artifacts.list",
        responses: {
          200: {
            description: "Run artifacts",
            content: {
              "application/json": {
                schema: resolver(ArtifactRecord.array()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        return c.json(await RunGateway.listArtifacts(c.req.valid("param").runID))
      },
    )
    .get(
      "/:runID/summary",
      describeRoute({
        summary: "Get run summary",
        description: "Return the external summary view for a DAX-backed run.",
        operationId: "run.summary",
        responses: {
          200: {
            description: "Run summary",
            content: {
              "application/json": {
                schema: resolver(RunSummary),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        return c.json(await RunGateway.getSummary(c.req.valid("param").runID))
      },
    )
    .get(
      "/:runID/projections",
      describeRoute({
        summary: "Get run projections",
        description: "Return the canonical workstation projections for a DAX-backed run.",
        operationId: "run.projections",
        responses: {
          200: {
            description: "Run projections",
            content: {
              "application/json": {
                schema: resolver(ProjectedRun),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        return c.json(await RunGateway.getProjections(c.req.valid("param").runID))
      },
    ),
)
