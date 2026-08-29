import z from "zod"
import { Tool } from "./tool"
import { EditMetadataSchema, EditTool } from "./edit"
import DESCRIPTION from "./multiedit.txt"
import path from "path"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import {
  beginNativeInvocation,
  finalizeNativeResult,
  isNativeInvocationAuthorized,
  isNativeSettlementPending,
} from "@/execution/native-settlement"
import { computeCanonicalCommitment } from "@/execution/canonical-commitment"

export const MultiEditTool = Tool.define("multiedit", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    edits: z
      .array(
        z.object({
          filePath: z.string().describe("The absolute path to the file to modify"),
          oldString: z.string().describe("The text to replace"),
          newString: z.string().describe("The text to replace it with (must be different from oldString)"),
          replaceAll: z.boolean().optional().describe("Replace all occurrences of oldString (default false)"),
        }),
      )
      .describe("Array of edit operations to perform sequentially on the file"),
  }),
  result: Tool.result(
    z
      .object({
        results: z.array(EditMetadataSchema.extend({ truncated: z.boolean().optional(), outputPath: z.string().optional() }).strict()),
      })
      .strict(),
  ),
  async execute(params, ctx) {
    const tool = await EditTool.init()
    const results = []
    for (const [, edit] of params.edits.entries()) {
      const args = {
        filePath: params.filePath,
        oldString: edit.oldString,
        newString: edit.newString,
        replaceAll: edit.replaceAll,
      }
      const invocationId = Identifier.ascending("tool")
      const settlement = ctx.callID
        ? await beginNativeInvocation({
            sessionID: ctx.sessionID,
            invocationId,
            toolId: "edit",
            executor: { kind: "builtin", id: "edit" },
            args,
            originTurnId: ctx.messageID,
            parentInvocationId: isNativeSettlementPending(ctx.callID) ? ctx.callID : undefined,
          })
        : { status: "not_canonical" as const }
      const settled = settlement.status === "recorded"
      let canonicalResult: Tool.Result | undefined
      const leafCtx: Tool.Context = {
        ...ctx,
        callID: invocationId,
        captureValidatedResult(result) {
          canonicalResult = result
        },
      }

      let result: Awaited<ReturnType<typeof tool.execute>>
      try {
        result = await tool.execute(args, leafCtx)
        if (settled && !canonicalResult) {
          throw new Error(`Edit invocation ${invocationId} did not expose its validated pre-truncation result`)
        }
      } catch (error) {
        if (settled && isNativeInvocationAuthorized(invocationId)) {
          const message = error instanceof Error ? error.message : String(error)
          await finalizeNativeResult(
            invocationId,
            ctx.abort.aborted
              ? { status: "cancelled", cancellation: { code: "aborted", message } }
              : { status: "failed", failure: { code: "executor_failed", message, retryable: false } },
          )
        }
        throw error
      }

      if (settled) {
        const commitment = await computeCanonicalCommitment(canonicalResult!)
        await finalizeNativeResult(invocationId, {
          status: "completed",
          result: { basis: "validated_dax_result_pre_truncation", ...commitment },
        })
      }
      results.push(result)
    }
    return {
      title: path.relative(Instance.worktree, params.filePath),
      metadata: {
        results: results.map((r) => r.metadata),
      },
      output: results.at(-1)!.output,
    }
  },
})
