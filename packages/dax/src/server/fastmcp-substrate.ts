import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { RunGateway } from "./run-gateway"
import { CreateRunRequest, ResolveApprovalRequest } from "./run-contract"
import { z } from "zod"

export interface SubstrateAuth {
  token: string
  mode: "token" | "dev-unsafe"
}

export function validateAuth(auth: SubstrateAuth | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken) return true
  if (!auth) return false
  if (auth.mode === "dev-unsafe") return true
  return auth.token === expectedToken
}

export function extractAuth(request: Request): SubstrateAuth | undefined {
  const authHeader = request.headers.get("authorization")
  if (!authHeader) return undefined
  const [scheme, token] = authHeader.split(" ")
  if (scheme.toLowerCase() === "bearer" && token) {
    return { token, mode: "token" }
  }
  if (scheme.toLowerCase() === "dev-unsafe" && token === "dev-unsafe") {
    return { token, mode: "dev-unsafe" }
  }
  return undefined
}

function toolResult(content: Array<{ type: "text"; text: string }>, isError = false): CallToolResult {
  return {
    content,
    isError,
  }
}

function jsonResult(data: unknown): CallToolResult {
  return toolResult([{ type: "text" as const, text: JSON.stringify(data, null, 2) }])
}

function errorResult(message: string): CallToolResult {
  return toolResult([{ type: "text" as const, text: JSON.stringify({ error: message }) }], true)
}

export function createSubstrateServer(): McpServer {
  const server = new McpServer(
    {
      name: "dax-substrate",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.registerTool(
    "health",
    {
      title: "Health Check",
      description: "Check DAX substrate health and version info.",
      inputSchema: z.object({}),
    },
    async () => {
      return jsonResult({
        status: "ok",
        service: "dax-substrate",
        version: "1.0.0",
        timestamp: new Date().toISOString(),
      })
    },
  )

  server.registerTool(
    "run.create",
    {
      title: "Create Run",
      description: "Create a governed DAX run. Returns runId and initial status. The run begins execution immediately.",
      inputSchema: z.object({
        intent: z.object({
          input: z.string().describe("Natural language intent for the run"),
          kind: z.enum(["general", "analysis", "edit", "workflow_step"]).optional(),
          repoPath: z.string().optional(),
          branch: z.string().optional(),
        }),
        workflowHint: z.enum(["draft_and_approve", "repo_analyze", "review_and_signoff"]).optional(),
        personaPreset: z
          .object({
            riskLevel: z.enum(["low", "medium", "high", "critical"]).optional(),
            approvalMode: z.enum(["strict", "balanced", "relaxed"]).optional(),
          })
          .optional(),
      }),
    },
    async (args) => {
      const intent = args.intent as Record<string, unknown>
      const request: CreateRunRequest = {
        intent: {
          input: intent.input as string,
          kind: intent.kind as CreateRunRequest["intent"]["kind"],
          repoPath: intent.repoPath as string | undefined,
          branch: intent.branch as string | undefined,
        },
        workflowHint: args.workflowHint as CreateRunRequest["workflowHint"],
        personaPreset: args.personaPreset as CreateRunRequest["personaPreset"],
        metadata: {
          source: "api",
        },
      }
      const response = await RunGateway.createRun(request)
      return jsonResult({
        runId: response.runId,
        status: response.status,
        createdAt: response.createdAt,
        workflowClass: response.workflowClass,
      })
    },
  )

  server.registerTool(
    "run.get",
    {
      title: "Get Run Snapshot",
      description:
        "Get the current snapshot of a run including status, step progress, trust state, and governance info.",
      inputSchema: z.object({
        runId: z.string().describe("The run ID returned from run.create"),
      }),
    },
    async (args) => {
      const runId = args.runId as string
      const snapshot = await RunGateway.getSnapshot(runId)
      return jsonResult({
        runId: snapshot.runId,
        status: snapshot.status,
        title: snapshot.title,
        currentStep: snapshot.currentStep,
        pendingApprovalCount: snapshot.pendingApprovalCount,
        trust: snapshot.trust,
        workflow: snapshot.workflow,
        terminalReason: snapshot.terminalReason,
        authority: snapshot.authority,
        createdAt: snapshot.createdAt,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        artifactSummary: snapshot.artifactSummary,
      })
    },
  )

  server.registerTool(
    "run.approvals.list",
    {
      title: "List Run Approvals",
      description: "List all pending approvals for a run. Returns empty array if no approvals are pending.",
      inputSchema: z.object({
        runId: z.string().describe("The run ID"),
      }),
    },
    async (args) => {
      const runId = args.runId as string
      const approvals = await RunGateway.getApprovals(runId)
      return jsonResult({
        runId,
        approvals: approvals.map((a) => ({
          approvalId: a.approvalId,
          type: a.type,
          status: a.status,
          risk: a.risk,
          title: a.title,
          reason: a.reason,
          context: a.context,
          createdAt: a.createdAt,
        })),
      })
    },
  )

  server.registerTool(
    "run.approvals.resolve",
    {
      title: "Resolve Approval",
      description: "Approve or deny a pending approval. Returns updated approval status.",
      inputSchema: z.object({
        runId: z.string().describe("The run ID"),
        approvalId: z.string().describe("The approval ID to resolve"),
        decision: z.enum(["approve", "deny"]).describe("The approval decision"),
        actorId: z.string().describe("Identity of the actor resolving the approval"),
        comment: z.string().optional().describe("Optional comment explaining the decision"),
      }),
    },
    async (args) => {
      const request: ResolveApprovalRequest = {
        decision: args.decision as "approve" | "deny",
        actorId: args.actorId as string,
        source: "api",
        comment: args.comment as string | undefined,
      }
      const response = await RunGateway.resolveApproval(args.runId as string, args.approvalId as string, request)
      return jsonResult({
        approvalId: response.approvalId,
        status: response.status,
        resolvedAt: response.resolvedAt,
      })
    },
  )

  server.registerTool(
    "run.recovery.get",
    {
      title: "Get Recovery Summary",
      description: "Get the recovery summary for a failed or blocked run, including error codes and recovery options.",
      inputSchema: z.object({
        runId: z.string().describe("The run ID"),
      }),
    },
    async (args) => {
      const runId = args.runId as string
      const summary = await RunGateway.getSummary(runId)
      return jsonResult({
        runId,
        status: summary.status,
        terminalReason: summary.terminalReason,
        outcome: summary.outcome,
        trust: summary.trust,
        workflow: summary.workflow,
        recoveryAvailable:
          summary.status === "failed" || summary.status === "cancelled" || summary.status === "waiting_approval",
      })
    },
  )

  server.registerTool(
    "run.recovery.execute",
    {
      title: "Execute Recovery",
      description: "Retry a failed or blocked run from its last known checkpoint.",
      inputSchema: z.object({
        runId: z.string().describe("The run ID to retry"),
        actorId: z.string().describe("Identity of the actor triggering recovery"),
      }),
    },
    async () => {
      return errorResult(
        "recovery.execute not yet implemented - create a new run with workflowHint: 'repo_analyze' instead",
      )
    },
  )

  return server
}

export interface SubstrateSession {
  transport: WebStandardStreamableHTTPServerTransport
  serverId: string
}
