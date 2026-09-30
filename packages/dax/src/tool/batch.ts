import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./batch.txt"
import { decideContractTool } from "@/execution/execution-contract"
import {
  beginNativeInvocation,
  finalizeNativeResult,
  isNativeInvocationAuthorized,
  isNativeSettlementPending,
  NativeSettlementAppendError,
  NativeSettlementStateError,
} from "@/execution/native-settlement"
import { NativeMutationObservationError } from "@/execution/native-mutation-observation"
import { permissionForExecutor } from "@/capability/native-alias"

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
      // Several executors can share an alias. The last registered is the one
      // named when no contract covers any of them; see selection below.
      const toolMap = new Map(availableTools.map((t) => [t.id, t]))

      const executeCall = async (call: (typeof toolCalls)[0]) => {
        const callStartTime = Date.now()
        const partID = Identifier.ascending("part")

        try {
          if (DISALLOWED.has(call.tool)) {
            throw new Error(
              `Tool '${call.tool}' is not allowed in batch. Disallowed tools: ${Array.from(DISALLOWED).join(", ")}`,
            )
          }

          const named = toolMap.get(call.tool)
          if (!named) {
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

          // Select the executor the same way direct dispatch does: the last one
          // under this alias that the contract covers. A plugin holding a
          // built-in's alias is passed over and the built-in is used. When the
          // contract covers none, the named executor is kept so the denial is
          // recorded against what would have run.
          const covered = availableTools.filter(
            (candidate) =>
              candidate.id === call.tool &&
              decideContractTool(contract, call.tool, { kind: ToolRegistry.executorKind(candidate) }).allowed,
          )
          const tool = covered.at(-1) ?? named
          const executor = ToolRegistry.executionIdentity(tool)
          const contractDecision = decideContractTool(contract, call.tool, executor)

          const validatedParams = tool.parameters.parse(call.parameters)

          const settlement = await beginNativeInvocation({
            sessionID: ctx.sessionID,
            invocationId: partID,
            toolId: call.tool,
            executor: { kind: executor.kind, id: executor.id },
            args: validatedParams,
            originTurnId: ctx.messageID,
            parentInvocationId: ctx.callID && isNativeSettlementPending(ctx.callID) ? ctx.callID : undefined,
          })
          const settled = settlement.status === "recorded"
          // A canonical run records the denial itself in beginNativeInvocation
          // and does not reach here. Outside one there is no journal to record
          // it in, and the leaf is refused as before.
          if (!contractDecision.allowed) {
            throw new Error(`Tool '${call.tool}' is not permitted by the ExecutionContract`)
          }

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
              permission: permissionForExecutor(call.tool, executor.kind),
              patterns: ["*"],
              always: ["*"],
              metadata: {},
            })
            await leafCtx.authorize()
          }

          let result: Tool.Result
          try {
            result = Tool.parseResult(
              call.tool,
              await executor.execute.call(executor.receiver, validatedParams, leafCtx),
            )
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
                      cancellation: {
                        code: "aborted",
                        message: error instanceof Error ? error.message : String(error),
                      },
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
