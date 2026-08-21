import z from "zod"
import type { MessageV2 } from "../session/message-v2"
import type { Agent } from "../agent/agent"
import type { Permission } from "../governance"

export namespace Tool {
  const FilePartSourceText = z
    .object({
      value: z.string(),
      start: z.number().int(),
      end: z.number().int(),
    })
    .strict()
  const FilePartSource = z.discriminatedUnion("type", [
    z.object({ type: z.literal("file"), path: z.string(), text: FilePartSourceText }).strict(),
    z
      .object({
        type: z.literal("symbol"),
        path: z.string(),
        range: z
          .object({
            start: z.object({ line: z.number(), character: z.number() }).strict(),
            end: z.object({ line: z.number(), character: z.number() }).strict(),
          })
          .strict(),
        name: z.string(),
        kind: z.number().int(),
        text: FilePartSourceText,
      })
      .strict(),
    z
      .object({ type: z.literal("resource"), clientName: z.string(), uri: z.string(), text: FilePartSourceText })
      .strict(),
  ])
  export const FilePart = z
    .object({
      id: z.string(),
      sessionID: z.string(),
      messageID: z.string(),
      type: z.literal("file"),
      mime: z.string(),
      filename: z.string().optional(),
      url: z.string(),
      source: FilePartSource.optional(),
    })
    .strict()

  /**
   * The generic DAX transport contract consumed by the session/model layer.
   * Tool.domain schemas are intentionally separate and are parsed first.
   */
  export const Result = z
    .object({
      title: z.string(),
      metadata: z.record(z.string(), z.json()),
      output: z.string(),
      attachments: z.array(FilePart).optional(),
    })
    .passthrough()
  export type Result = z.infer<typeof Result>

  /**
   * Builds the complete domain result schema for one tool. The shared envelope
   * is deliberately separate from this: each caller supplies its own closed
   * metadata contract, then DAX validates model-facing transport separately.
   */
  export function result<Metadata extends z.ZodType>(metadata: Metadata) {
    return z
      .object({
        title: z.string(),
        metadata,
        output: z.string(),
        attachments: z.array(FilePart).optional(),
      })
      .strict()
  }

  export class ResultValidationError extends Error {
    constructor(
      public readonly toolID: string,
      cause: z.ZodError,
    ) {
      super(
        `The ${toolID} tool returned an invalid result: ${cause.issues.map((issue) => `${issue.path.join(".") || "<root>"} ${issue.message}`).join("; ")}`,
        {
          cause,
        },
      )
      this.name = "ToolResultValidationError"
    }
  }

  export function parseResult(toolID: string, result: unknown): Result {
    const parsed = Result.safeParse(result)
    if (!parsed.success) throw new ResultValidationError(toolID, parsed.error)
    return parsed.data
  }

  interface Metadata {
    [key: string]: any
  }

  export interface InitContext {
    agent?: Agent.Info
  }

  export type Context<M extends Metadata = Metadata> = {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    callID?: string
    extra?: { [key: string]: any }
    messages: MessageV2.WithParts[]
    metadata(input: { title?: string; metadata?: M }): void
    ask(input: Omit<Permission.AskInput, "id" | "createdAt" | "sessionID" | "tool" | "ruleset">): Promise<void>
  }
  export interface Info<Parameters extends z.ZodType = z.ZodType, ResultSchema extends z.ZodType = z.ZodType> {
    id: string
    init: (ctx?: InitContext) => Promise<{
      description: string
      parameters: Parameters
      result: ResultSchema
      execute(args: z.infer<Parameters>, ctx: Context): Promise<z.output<ResultSchema>>
      formatValidationError?(error: z.ZodError): string
    }>
  }

  export type InferParameters<T extends Info> = T extends Info<infer P> ? z.infer<P> : never
  export type InferResult<T extends Info> = T extends Info<any, infer R> ? z.output<R> : never
  export type InferMetadata<T extends Info> = InferResult<T> extends { metadata: infer M } ? M : never

  export function define<Parameters extends z.ZodType, ResultSchema extends z.ZodType>(
    id: string,
    init: Info<Parameters, ResultSchema>["init"] | Awaited<ReturnType<Info<Parameters, ResultSchema>["init"]>>,
  ): Info<Parameters, ResultSchema> {
    return {
      id,
      init: async (initCtx) => {
        const toolInfo = init instanceof Function ? await init(initCtx) : init
        const execute = toolInfo.execute
        return {
          ...toolInfo,
          execute: async (args, ctx) => {
            try {
              toolInfo.parameters.parse(args)
            } catch (error) {
              if (error instanceof z.ZodError && toolInfo.formatValidationError) {
                throw new Error(toolInfo.formatValidationError(error), { cause: error })
              }
              throw new Error(
                `The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
                { cause: error },
              )
            }
            // Domain truth crosses from arbitrary tool-body code into the
            // session/model boundary here. Validate before truncation, because a
            // truncator can only safely operate on a successful domain result.
            let executionResult: z.output<ResultSchema>
            try {
              executionResult = toolInfo.result.parse(await execute(args, ctx))
            } catch (error) {
              if (error instanceof z.ZodError) throw new ResultValidationError(id, error)
              throw error
            }
            const result = parseResult(id, executionResult)
            // skip truncation for tools that handle it themselves
            if (result.metadata.truncated !== undefined) {
              return result as typeof executionResult
            }
            // Loading truncation only when a result is ready keeps the core tool
            // contract free of the session/registry initialization cycle.
            const { Truncate } = await import("./truncation")
            const truncated = await Truncate.output(result.output, {}, initCtx?.agent)
            return parseResult(id, {
              ...result,
              output: truncated.content,
              metadata: {
                ...result.metadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath }),
              },
            }) as typeof executionResult
          },
        }
      },
    }
  }
}
