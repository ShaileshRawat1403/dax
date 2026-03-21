import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { lazy } from "@/util/lazy"
import {
  SoothsayerAPI,
  type SoothsayerOverview,
  type SoothsayerRunDetail,
  type SoothsayerApprovalDetail,
} from "@/soothsayer/soothsayer-api"
import { CreateRunRequest, CreateRunResponse, ResolveApprovalRequest, ResolveApprovalResponse } from "../run-contract"
import { RunGateway } from "../run-gateway"

export const SoothsayerRoutes = lazy(() =>
  new Hono()
    .get(
      "/overview",
      describeRoute({
        summary: "Get Soothsayer overview",
        description:
          "Return presentation-safe overview with human-readable labels for active runs, pending approvals, and authority metrics.",
        operationId: "soothsayer.overview",
        responses: {
          200: {
            description: "Soothsayer overview",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    activeRuns: z.array(
                      z.object({
                        runId: z.string(),
                        title: z.string().optional(),
                        workflowClass: z.string(),
                        workflowClassLabel: z.string().optional(),
                        workflowClassDescription: z.string().optional(),
                        status: z.string(),
                        trustPosture: z.string(),
                        trustPostureLabel: z.string().optional(),
                        progress: z.object({
                          currentStep: z.string(),
                          currentStepLabel: z.string().optional(),
                          currentStepDescription: z.string().optional(),
                          currentStepIndex: z.number(),
                          totalSteps: z.number(),
                          percentage: z.number(),
                        }),
                        terminalReason: z.string().optional(),
                        terminalReasonLabel: z.string().optional(),
                        terminalReasonSeverity: z.string().optional(),
                        createdAt: z.string(),
                        completedAt: z.string().optional(),
                      }),
                    ),
                    recentRuns: z.array(
                      z.object({
                        runId: z.string(),
                        title: z.string().optional(),
                        workflowClass: z.string(),
                        workflowClassLabel: z.string().optional(),
                        workflowClassDescription: z.string().optional(),
                        status: z.string(),
                        trustPosture: z.string(),
                        trustPostureLabel: z.string().optional(),
                        progress: z.object({
                          currentStep: z.string(),
                          currentStepLabel: z.string().optional(),
                          currentStepDescription: z.string().optional(),
                          currentStepIndex: z.number(),
                          totalSteps: z.number(),
                          percentage: z.number(),
                        }),
                        terminalReason: z.string().optional(),
                        terminalReasonLabel: z.string().optional(),
                        terminalReasonSeverity: z.string().optional(),
                        createdAt: z.string(),
                        completedAt: z.string().optional(),
                      }),
                    ),
                    pendingApprovals: z.array(
                      z.object({
                        approvalId: z.string(),
                        runId: z.string(),
                        type: z.string(),
                        typeLabel: z.string().optional(),
                        typeDescription: z.string().optional(),
                        typeIcon: z.string().optional(),
                        status: z.string(),
                        risk: z.string(),
                        riskLabel: z.string().optional(),
                        riskDescription: z.string().optional(),
                        riskSeverity: z.number().optional(),
                        riskColor: z.string().optional(),
                        title: z.string(),
                        titleEnriched: z.string().optional(),
                        reason: z.string(),
                        context: z.object({
                          stepId: z.string().optional(),
                          filePath: z.string().optional(),
                          command: z.string().optional(),
                          toolName: z.string().optional(),
                          diffPreview: z.string().optional(),
                          notes: z.array(z.string()).optional(),
                        }),
                        createdAt: z.string(),
                        updatedAt: z.string(),
                        whatHappensNext: z
                          .object({
                            afterApprove: z.string(),
                            afterDeny: z.string().optional(),
                          })
                          .optional(),
                      }),
                    ),
                    authorityMetrics: z.object({
                      dax_state_machine: z.number(),
                      dax_legacy: z.number(),
                      total: z.number(),
                    }),
                  }),
                ),
              },
            },
          },
        },
      }),
      async () => {
        const overview = await SoothsayerAPI.getOverview()
        return new Response(JSON.stringify(overview, null, 2), {
          headers: { "Content-Type": "application/json" },
        })
      },
    )
    .post(
      "/runs",
      describeRoute({
        summary: "Create Soothsayer run",
        description: "Create a DAX run with presentation metadata for Picobot/WhatsApp ingress.",
        operationId: "soothsayer.runs.create",
        responses: {
          200: {
            description: "Run created",
            content: {
              "application/json": {
                schema: resolver(CreateRunResponse),
              },
            },
          },
        },
      }),
      async (c) => {
        const body = await c.req.json<CreateRunRequest>()
        const result = await RunGateway.createRun({
          ...body,
          metadata: {
            ...body.metadata,
            source: "soothsayer" as const,
            channel: body.metadata?.channel ?? "whatsapp",
            sessionId: body.metadata?.sessionId ?? body.metadata?.chatId,
          },
        })
        return c.json(result)
      },
    )
    .get(
      "/runs/:runID",
      describeRoute({
        summary: "Get Soothsayer run detail",
        description: "Return presentation-safe run detail with human-readable labels.",
        operationId: "soothsayer.runs.get",
        responses: {
          200: {
            description: "Run detail",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    runId: z.string(),
                    status: z.string(),
                    authority: z.string(),
                    sourceSystem: z.string().optional(),
                    title: z.string().optional(),
                    createdAt: z.string(),
                    updatedAt: z.string(),
                    startedAt: z.string().optional(),
                    completedAt: z.string().optional(),
                    progress: z.object({
                      currentStep: z.string(),
                      currentStepLabel: z.string().optional(),
                      currentStepDescription: z.string().optional(),
                      totalSteps: z.number(),
                      percentage: z.number(),
                    }),
                    trust: z.object({
                      posture: z.string(),
                      postureLabel: z.string().optional(),
                      postureDescription: z.string().optional(),
                      blocked: z.boolean(),
                    }),
                    workflow: z
                      .object({
                        class: z.string(),
                        classLabel: z.string().optional(),
                        classDescription: z.string().optional(),
                        stepGraph: z.array(z.string()),
                        currentStepIndex: z.number(),
                        trustPosture: z.string(),
                        trustPostureLabel: z.string().optional(),
                      })
                      .nullable(),
                    terminalReason: z.string().optional(),
                    terminalReasonLabel: z.string().optional(),
                    terminalReasonDescription: z.string().optional(),
                    terminalReasonSeverity: z.string().optional(),
                    approvals: z.object({
                      pending: z.number(),
                      approved: z.number(),
                      denied: z.number(),
                    }),
                    artifacts: z.object({
                      total: z.number(),
                      latestIds: z.array(z.string()),
                    }),
                    lastEvent: z
                      .object({
                        eventId: z.string(),
                        sequence: z.number(),
                        cursor: z.string(),
                        timestamp: z.string(),
                      })
                      .optional(),
                  }),
                ),
              },
            },
          },
          404: {
            description: "Run not found",
          },
        },
      }),
      async (c) => {
        const runID = c.req.param("runID")
        const detail = await SoothsayerAPI.getRunDetail(runID)
        if (!detail) {
          return c.json({ error: "Run not found" }, 404)
        }
        return c.json(detail)
      },
    )
    .get(
      "/runs/:runID/approvals",
      describeRoute({
        summary: "Get Soothsayer approval queue",
        description: "Return presentation-safe approval queue with human-readable labels and whatHappensNext.",
        operationId: "soothsayer.runs.approvals",
        responses: {
          200: {
            description: "Approval queue",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      approvalId: z.string(),
                      runId: z.string(),
                      type: z.string(),
                      typeLabel: z.string().optional(),
                      typeDescription: z.string().optional(),
                      typeIcon: z.string().optional(),
                      status: z.string(),
                      risk: z.string(),
                      riskLabel: z.string().optional(),
                      riskDescription: z.string().optional(),
                      riskSeverity: z.number().optional(),
                      riskColor: z.string().optional(),
                      title: z.string(),
                      titleEnriched: z.string().optional(),
                      reason: z.string(),
                      context: z.object({
                        stepId: z.string().optional(),
                        filePath: z.string().optional(),
                        command: z.string().optional(),
                        toolName: z.string().optional(),
                        diffPreview: z.string().optional(),
                        notes: z.array(z.string()).optional(),
                      }),
                      createdAt: z.string(),
                      updatedAt: z.string(),
                      whatHappensNext: z
                        .object({
                          afterApprove: z.string(),
                          afterDeny: z.string().optional(),
                        })
                        .optional(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const runID = c.req.param("runID")
        const approvals = await SoothsayerAPI.getApprovalQueue(runID)
        return c.json(approvals)
      },
    )
    .post(
      "/runs/:runID/approvals/:approvalID",
      describeRoute({
        summary: "Resolve Soothsayer approval",
        description: "Approve or deny a pending approval.",
        operationId: "soothsayer.runs.approvals.resolve",
        responses: {
          200: {
            description: "Approval resolved",
            content: {
              "application/json": {
                schema: resolver(ResolveApprovalResponse),
              },
            },
          },
          404: {
            description: "Approval not found",
          },
        },
      }),
      async (c) => {
        const { runID, approvalID } = c.req.param()
        const body = await c.req.json<ResolveApprovalRequest>()
        try {
          const result = await SoothsayerAPI.resolveApproval(
            runID,
            approvalID,
            body.decision,
            body.actorId,
            body.comment,
          )
          return c.json(result)
        } catch {
          return c.json({ error: "Approval not found" }, 404)
        }
      },
    )
    .get(
      "/approvals",
      describeRoute({
        summary: "Get global approval queue",
        description: "Return all pending approvals across all active runs.",
        operationId: "soothsayer.approvals",
        responses: {
          200: {
            description: "Global approval queue",
          },
        },
      }),
      async () => {
        const approvals = await SoothsayerAPI.getApprovalQueue()
        return new Response(JSON.stringify(approvals, null, 2), {
          headers: { "Content-Type": "application/json" },
        })
      },
    ),
)
