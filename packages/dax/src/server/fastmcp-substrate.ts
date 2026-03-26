import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { RunGateway } from "./run-gateway"
import { CreateRunRequest, ResolveApprovalRequest } from "./run-contract"
import { z } from "zod"
import { Flag } from "@/flag/flag"
import { Installation } from "@/installation"
import { validateActorToken, type ActorClaims } from "@/identity/zitadel"
import { AsyncLocalStorage } from "node:async_hooks"

export interface SubstrateAuth {
  token: string
  mode: "token" | "dev-unsafe" | "zitadel"
  actor?: ActorClaims
}

export async function extractAuth(request: Request): Promise<SubstrateAuth | undefined> {
  const authHeader = request.headers.get("authorization")
  if (!authHeader) return undefined
  const [scheme, token] = authHeader.split(" ")
  if (scheme.toLowerCase() === "bearer" && token) {
    if (Flag.ZITADEL_DOMAIN) {
      const actor = await validateActorToken(token)
      if (actor) {
        return { token, mode: "zitadel", actor }
      }
    }
    return { token, mode: "token" }
  }
  if (scheme.toLowerCase() === "dev-unsafe" && token === "dev-unsafe") {
    return { token, mode: "dev-unsafe" }
  }
  return undefined
}

export function validateAuth(auth: SubstrateAuth | undefined, expectedToken: string | undefined): boolean {
  if (!expectedToken && !Flag.ZITADEL_DOMAIN) return true
  if (!auth) return false
  if (auth.mode === "dev-unsafe") return true
  if (auth.mode === "zitadel") return true
  return auth.token === expectedToken
}

const actorStorage = new AsyncLocalStorage<ActorClaims>()

export function setActorContext(actor: ActorClaims | undefined) {
  if (actor) {
    actorStorage.enterWith(actor)
  }
}

export function getActorContext(): ActorClaims | undefined {
  return actorStorage.getStore()
}

export function clearActorContext() {
  // AsyncLocalStorage context exits automatically when the async scope ends
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
      version: Installation.VERSION,
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
      inputSchema: undefined,
    },
    async () => {
      return jsonResult({
        status: "ok",
        service: "dax-substrate",
        version: Installation.VERSION,
        timestamp: new Date().toISOString(),
      })
    },
  )

  server.registerTool(
    "run.create",
    {
      title: "Create Run",
      description: "Create a governed DAX run. Returns runId and initial status. The run begins execution immediately.",
      inputSchema: z
        .object({
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
        })
        .omit({})
        .strict() as any,
    },
    async (args: Record<string, unknown>) => {
      const intent = args.intent as Record<string, unknown>
      const actor = getActorContext()
      const initiatedBy = actor?.email ?? actor?.name ?? actor?.sub
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
          initiatedBy: initiatedBy ?? undefined,
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
      inputSchema: z
        .object({
          runId: z.string().describe("The run ID returned from run.create"),
        })
        .omit({})
        .strict() as any,
    },
    async (args: Record<string, unknown>) => {
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
      inputSchema: z
        .object({
          runId: z.string().describe("The run ID"),
        })
        .omit({})
        .strict() as any,
    },
    async (args: Record<string, unknown>) => {
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
      inputSchema: z
        .object({
          runId: z.string().describe("The run ID"),
          approvalId: z.string().describe("The approval ID to resolve"),
          decision: z.enum(["approve", "deny"]).describe("The approval decision"),
          actorId: z.string().describe("Identity of the actor resolving the approval"),
          comment: z.string().optional().describe("Optional comment explaining the decision"),
        })
        .omit({})
        .strict() as any,
    },
    async (args: Record<string, unknown>) => {
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
      inputSchema: z
        .object({
          runId: z.string().describe("The run ID"),
        })
        .omit({})
        .strict() as any,
    },
    async (args: Record<string, unknown>) => {
      const runId = args.runId as string
      const summary = await RunGateway.getSummary(runId)
      const terminalStatuses = ["completed", "failed", "cancelled"]
      const isTerminal = terminalStatuses.includes(summary.status)
      return jsonResult({
        runId,
        status: summary.status,
        terminalReason: summary.terminalReason,
        outcome: summary.outcome,
        trust: summary.trust,
        workflow: summary.workflow,
        isTerminal,
        recoveryAvailable: !isTerminal,
        recoveryHint: isTerminal
          ? "Run is terminal. Use run.create to start a new run with the same intent."
          : "Run can be recovered via run.recovery.execute.",
      })
    },
  )

  server.registerTool(
    "run.recovery.execute",
    {
      title: "Execute Recovery",
      description:
        "Recover a run from its event log. Terminal runs (failed/completed/cancelled) cannot be recovered — create a new run instead. Non-terminal runs (running, waiting_approval) can be recovered to reconnect to an interrupted session.",
      inputSchema: z
        .object({
          runId: z.string().describe("The run ID to recover"),
          actorId: z.string().optional().describe("Identity of the actor triggering recovery (defaults to MCP caller)"),
        })
        .omit({})
        .strict() as any,
    },
    async (args: Record<string, unknown>) => {
      const runId = args.runId as string
      const actor = getActorContext()
      const resolvedActorId =
        (args.actorId as string | undefined) ?? actor?.email ?? actor?.name ?? actor?.sub ?? "unknown"

      const snapshot = await RunGateway.getSnapshot(runId).catch(() => null)

      if (!snapshot) {
        return errorResult(`Run not found: ${runId}`)
      }

      const terminalStatuses = ["completed", "failed", "cancelled"]
      if (terminalStatuses.includes(snapshot.status)) {
        return jsonResult({
          success: false,
          reason: "terminal",
          message: `Run is ${snapshot.status} and cannot be recovered. Create a new run to retry.`,
          terminalReason: snapshot.terminalReason,
          suggestion: "Use run.create with the same intent to start a new run.",
          runId,
          status: snapshot.status,
        })
      }

      const { recoverRun } = await import("@/state/recovery")
      const result = await recoverRun(runId)

      if (!result.success) {
        return errorResult(`Recovery failed: ${result.error}`)
      }

      return jsonResult({
        success: true,
        reason: "recovered",
        message: `Run ${runId} recovered successfully.`,
        recoveredStatus: result.recoveredRunState?.status,
        recoveredSteps: result.recoveredRunState?.steps.length ?? 0,
        recoveredApprovals: result.recoveredApprovals ?? 0,
        actorId: resolvedActorId,
        runId,
      })
    },
  )

  return server
}

export interface SubstrateSession {
  transport: WebStandardStreamableHTTPServerTransport
  serverId: string
  actor?: ActorClaims
}
