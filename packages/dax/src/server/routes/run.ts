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
import { RunInspectorReadResultV1 } from "../run-inspector-projection"
import { discoverAntigravityModels } from "@/worker/antigravity-models"
import { AntigravityConversation } from "@/worker/antigravity-conversation"
import { inspectReviewedRun, reviseReviewedRun, startReviewedRun } from "@/capability/reviewed-run"
import {
  ReviewedRunError,
  ReviewedRunRefusal,
  RunGrantReview,
  ReviseGrantReviewRequest,
  StartGrantReviewRequest,
  StartGrantReviewResponse,
} from "@/capability/reviewed-run-contract"

export const RunRoutes = lazy(() =>
  new Hono()
    .get("/agy/models", async (c) => {
      try {
        return c.json({ models: await discoverAntigravityModels() })
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 503)
      }
    })
    .post("/:runID/agy/finish", async (c) => {
      try {
        await AntigravityConversation.finish(c.req.param("runID"))
        return c.json({ accepted: true })
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 409)
      }
    })
    .get("/:runID/agy/status", async (c) => {
      try {
        return c.json(await AntigravityConversation.status(c.req.param("runID")))
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 404)
      }
    })
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
        description: "Create a DAX-backed run. Reviewed generic opt-in waits for explicit operator approval and start.",
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
          409: {
            description: "Reviewed creation authority refused",
            content: { "application/json": { schema: resolver(ReviewedRunRefusal) } },
          },
        },
      }),
      validator("json", CreateRunRequest),
      async (c) => {
        const body = c.req.valid("json")
        try {
          return c.json(await RunGateway.createRun(body))
        } catch (error) {
          if (error instanceof ReviewedRunError)
            return c.json({ code: error.code, message: error.message, runId: error.runId }, error.status)
          throw error
        }
      },
    )
    .get(
      "/:runID/grant-review",
      describeRoute({
        summary: "Inspect reviewed capability grants",
        operationId: "run.grantReview.get",
        responses: {
          200: {
            description: "Current review and complete pins",
            content: { "application/json": { schema: resolver(RunGrantReview) } },
          },
          404: {
            description: "Review missing",
            content: { "application/json": { schema: resolver(ReviewedRunRefusal) } },
          },
          409: {
            description: "Authority unreadable",
            content: { "application/json": { schema: resolver(ReviewedRunRefusal) } },
          },
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        try {
          return c.json(await inspectReviewedRun(c.req.valid("param").runID))
        } catch (error) {
          if (error instanceof ReviewedRunError)
            return c.json({ code: error.code, message: error.message, runId: error.runId }, error.status)
          throw error
        }
      },
    )
    .post(
      "/:runID/grant-review/revisions",
      describeRoute({
        summary: "Revise reviewed capability grants",
        operationId: "run.grantReview.revise",
        responses: {
          200: {
            description: "Fresh revision awaiting fresh approval",
            content: { "application/json": { schema: resolver(RunGrantReview) } },
          },
          400: {
            description: "Invalid operator input",
            content: { "application/json": { schema: resolver(ReviewedRunRefusal) } },
          },
          409: {
            description: "Stale pins or immutable publication",
            content: { "application/json": { schema: resolver(ReviewedRunRefusal) } },
          },
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      validator("json", ReviseGrantReviewRequest),
      async (c) => {
        try {
          return c.json(await reviseReviewedRun(c.req.valid("param").runID, c.req.valid("json")))
        } catch (error) {
          if (error instanceof ReviewedRunError)
            return c.json({ code: error.code, message: error.message, runId: error.runId }, error.status)
          throw error
        }
      },
    )
    .post(
      "/:runID/grant-review/start",
      describeRoute({
        summary: "Claim initial reviewed run dispatch",
        operationId: "run.grantReview.start",
        description:
          "Checks exact approval, proposal, contract and ordered binding pins; claims initial dispatch once in the canonical journal.",
        responses: {
          200: {
            description: "Initial dispatch claimed",
            content: { "application/json": { schema: resolver(StartGrantReviewResponse) } },
          },
          400: {
            description: "Invalid start input",
            content: { "application/json": { schema: resolver(ReviewedRunRefusal) } },
          },
          409: {
            description: "Not startable or authority refused",
            content: { "application/json": { schema: resolver(ReviewedRunRefusal) } },
          },
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      validator("json", StartGrantReviewRequest),
      async (c) => {
        try {
          return c.json(await startReviewedRun(c.req.valid("param").runID, c.req.valid("json")))
        } catch (error) {
          if (error instanceof ReviewedRunError)
            return c.json({ code: error.code, message: error.message, runId: error.runId }, error.status)
          throw error
        }
      },
    )
    .get(
      "/:runID/inspector",
      describeRoute({
        summary: "Get canonical run inspector",
        description:
          "Return the canonical-authority inspector projection, or an explicit authority status when it cannot be read.",
        operationId: "run.inspector",
        responses: {
          200: {
            description: "Canonical inspector projection or typed authority status",
            content: {
              "application/json": {
                schema: resolver(RunInspectorReadResultV1),
              },
            },
          },
        },
      }),
      validator("param", z.object({ runID: z.string() })),
      async (c) => {
        return c.json(await RunGateway.getInspectorProjection(c.req.valid("param").runID))
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
        try {
          return c.json(await RunGateway.resolveApproval(params.runID, params.approvalID, body))
        } catch (error) {
          if (error instanceof ReviewedRunError)
            return c.json({ code: error.code, message: error.message, runId: error.runId }, error.status)
          throw error
        }
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
