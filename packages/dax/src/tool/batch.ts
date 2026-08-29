import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./batch.txt"
import { isToolAllowedByContract } from "@/execution/execution-contract"
import {
  beginNativeInvocation,
  finalizeNativeResult,
  isNativeInvocationAuthorized,
  isNativeSettlementPending,
  NativeSettlementAppendError,
  NativeSettlementStateError,
} from "@/execution/native-settlement"
import { NativeMutationObservationError } from "@/execution/native-mutation-observation"
import { permissionForToolId } from "./tool-class"

const DISALLOWED = new Set(["batch"])
const FILTERED_FROM_SUGGESTIONS = new Set(["invalid", "patch", ...DISALLOWED])

export const BatchTool = Tool.define("batch", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      tool_calls: z
        .array(
          z.object({
            tool: z.string().describe("The name of the tool to execute"),
            parameters: z.object({}).loose().describe("Parameters for the tool"),
          }),
        )
        .min(1, "Provide at least one tool call")
        .describe("Array of tool calls to execute in parallel"),
    }),
    result: Tool.result(
      z
        .object({
          totalCalls: z.number().int().nonnegative(),
          successful: z.number().int().nonnegative(),
          failed: z.number().int().nonnegative(),
          tools: z.array(z.string()),
          details: z.array(z.object({ tool: z.string(), success: z.boolean() }).strict()),
        })
        .strict(),
    ),
    formatValidationError(error) {
      const formattedErrors = error.issues
        .map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "root"
          return `  - ${path}: ${issue.message}`
        })
        .join("\n")

      return `Invalid parameters for tool 'batch':\n${formattedErrors}\n\nExpected payload format:\n  [{"tool": "tool_name", "parameters": {...}}, {...}]`
    },
    async execute(params, ctx) {
      const { Session } = await import("../session")
      const { Identifier } = await import("../id/id")

      const toolCalls = params.tool_calls.slice(0, 25)
      const discardedCalls = params.tool_calls.slice(25)

      const { ToolRegistry } = await import("./registry")
      const availableTools = await ToolRegistry.tools({ modelID: "", providerID: "" })
      const toolMap = new Map(availableTools.map((t) => [t.id, t]))
      const pluginToolIds = await ToolRegistry.pluginIds()

      const executeCall = async (call: (typeof toolCalls)[0]) => {
        const callStartTime = Date.now()
        const partID = Identifier.ascending("part")

        try {
          if (DISALLOWED.has(call.tool)) {
            throw new Error(
              `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`,
            )
          }

          const tool = toolMap.get(call.tool)
          if (!tool) {
            const availableToolsList = Array.from(toolMap.keys()).filter((name) => !FILTERED_FROM_SUGGESTIONS.has(name))
            throw new Error(
              `Tool '${call.tool}' not in registry. External tools (MCP, environment) cannot be batched - call them directly. Available tools: ${availableToolsList.join(", ")}`,
            )
          }

          // A batch wrapper is not authority for its leaves. Read the immutable
          // contract immediately before the nested executable boundary so a
          // registry entry alone cannot grant the nested tool permission.
          const session = await Session.get(ctx.sessionID)
          const { resolveExecutionAuthority } = await import("@/execution/contract-guardian")
          const { contract } = await resolveExecutionAuthority(session.id, session.governingRunId)
          if (!isToolAllowedByContract(contract, call.tool)) {
            throw new Error(`Tool '${call.tool}' is not permitted by the ExecutionContract`)
          }

          const validatedParams = tool.parameters.parse(call.parameters)

          const settlement = await beginNativeInvocation({
            sessionID: ctx.sessionID,
            invocationId: partID,
            toolId: call.tool,
            executor: { kind: pluginToolIds.has(call.tool) ? "plugin" : "builtin", id: call.tool },
            args: validatedParams,
            originTurnId: ctx.messageID,
            parentInvocationId: ctx.callID && isNativeSettlementPending(ctx.callID) ? ctx.callID : undefined,
          })
          const settled = settlement.status === "recorded"

          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "running",
              input: call.parameters,
              time: {
                start: callStartTime,
              },
            },
          })

          // A batch leaf is a distinct governed execution attempt from its
          // parent batch call. ctx.ask() (session/prompt.ts's context()) is a
          // genuine method that reads its identity off `this` at call time,
          // so handing the leaf a narrower ctx with its own callID is enough
          // for its authorization to settle under the leaf, not the batch
          // call — without this file needing to know how ask() is wired.
          let canonicalResult: Tool.Result | undefined
          const leafCtx: Tool.Context = {
            ...ctx,
            callID: partID,
            captureValidatedResult(result) {
              canonicalResult = result
            },
          }

          if (settled && tool.authorization !== "self") {
            await leafCtx.ask({
              permission: permissionForToolId(call.tool),
              patterns: ["*"],
              always: ["*"],
              metadata: {},
            })
            await leafCtx.authorize()
          }

          let result: Tool.Result
          try {
            result = Tool.parseResult(call.tool, await tool.execute(validatedParams, leafCtx))
            if (settled && !isNativeInvocationAuthorized(partID)) {
              throw new NativeSettlementStateError(partID, `${call.tool} returned before final authorization`)
            }
            if (settled && !canonicalResult) {
              throw new NativeSettlementStateError(
                partID,
                `${call.tool} did not expose its validated pre-truncation result`,
              )
            }
          } catch (error) {
            if (settled && isNativeInvocationAuthorized(partID)) {
              await finalizeNativeResult(
                partID,
                ctx.abort.aborted
                  ? {
                      status: "cancelled",
                      cancellation: { code: "aborted", message: error instanceof Error ? error.message : String(error) },
                    }
                  : {
                      status: "failed",
                      failure: {
                        code: "executor_failed",
                        message: error instanceof Error ? error.message : String(error),
                        retryable: false,
                      },
                    },
              )
            }
            throw error
          }

          if (settled) {
            const { computeCanonicalCommitment } = await import("@/execution/canonical-commitment")
            const commitment = await computeCanonicalCommitment(canonicalResult!)
            await finalizeNativeResult(partID, {
              status: "completed",
              result: { basis: "validated_dax_result_pre_truncation", ...commitment },
            })
          }

          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "completed",
              input: call.parameters,
              output: result.output,
              title: result.title,
              metadata: result.metadata,
              attachments: result.attachments,
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: true as const, tool: call.tool, result }
        } catch (error) {
          // Settlement uncertainty is not an ordinary child failure. Let it
          // fail the batch so the parent cannot be canonically completed over
          // an authorized child whose outcome is unknown.
          if (
            error instanceof NativeSettlementAppendError ||
            error instanceof NativeSettlementStateError ||
            error instanceof NativeMutationObservationError
          ) {
            throw error
          }
          await Session.updatePart({
            id: partID,
            messageID: ctx.messageID,
            sessionID: ctx.sessionID,
            type: "tool",
            tool: call.tool,
            callID: partID,
            state: {
              status: "error",
              input: call.parameters,
              error: error instanceof Error ? error.message : String(error),
              time: {
                start: callStartTime,
                end: Date.now(),
              },
            },
          })

          return { success: false as const, tool: call.tool, error }
        }
      }

      const results = await Promise.all(toolCalls.map((call) => executeCall(call)))

      // Add discarded calls as errors
      const now = Date.now()
      for (const call of discardedCalls) {
        const partID = Identifier.ascending("part")
        await Session.updatePart({
          id: partID,
          messageID: ctx.messageID,
          sessionID: ctx.sessionID,
          type: "tool",
          tool: call.tool,
          callID: partID,
          state: {
            status: "error",
            input: call.parameters,
            error: "Maximum of 25 tools allowed in batch",
            time: { start: now, end: now },
          },
        })
        results.push({
          success: false as const,
          tool: call.tool,
          error: new Error("Maximum of 25 tools allowed in batch"),
        })
      }

      const successfulCalls = results.filter((r) => r.success).length
      const failedCalls = results.length - successfulCalls

      const outputMessage =
        failedCalls > 0
          ? `Executed ${successfulCalls}/${results.length} tools successfully. ${failedCalls} failed.`
          : `All ${successfulCalls} tools executed successfully.\n\nKeep using the batch tool for optimal performance in your next response!`

      return {
        title: `Batch execution (${successfulCalls}/${results.length} successful)`,
        output: outputMessage,
        attachments: results.filter((result) => result.success).flatMap((r) => r.result.attachments ?? []),
        metadata: {
          totalCalls: results.length,
          successful: successfulCalls,
          failed: failedCalls,
          tools: params.tool_calls.map((c) => c.tool),
          details: results.map((r) => ({ tool: r.tool, success: r.success })),
        },
      }
    },
  }
})
