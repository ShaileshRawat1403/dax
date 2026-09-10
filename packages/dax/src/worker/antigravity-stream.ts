import z from "zod"
import { AntigravityHeadlessResultSchema, AntigravityUsageSchema } from "./worker-adapter"

/** Official CLI transport only. These records are observations, never DAX evidence. */
export const AntigravityConversationOptions = z
  .object({
    effort: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict()

export const AntigravitySessionState = z
  .object({
    kind: z.literal("antigravity"),
    model: z.string(),
    effort: z.enum(["low", "medium", "high"]).optional(),
    generationID: z.string(),
    conversationID: z.string().optional(),
    phase: z.enum(["starting", "responding", "ready", "sealing", "closed", "failed"]),
  })
  .strict()
export type AntigravitySessionState = z.infer<typeof AntigravitySessionState>

/** Runtime narrowing also works with older SDK clients carrying additive session fields. */
export function antigravitySession(value: unknown): AntigravitySessionState | undefined {
  if (!value || typeof value !== "object" || !("externalAgent" in value)) return undefined
  const parsed = AntigravitySessionState.safeParse(value.externalAgent)
  return parsed.success ? parsed.data : undefined
}

const Step = z
  .object({
    conversation_id: z.string().min(1),
    step_index: z.number().int().nonnegative().safe(),
    // ERROR + tool_info.error is emitted by the official CLI 1.1.27 for a
    // recoverable tool failure. It does not settle the conversational turn.
    state: z.enum(["ACTIVE", "DONE", "ERROR"]),
    step_type: z.enum(["user_input", "agent_response", "tool", "checkpoint"]),
    text_delta: z.string().optional(),
    duration_seconds: z.number().finite().nonnegative().optional(),
    usage: AntigravityUsageSchema.optional(),
    tool_name: z.string().optional(),
    tool_info: z
      .object({
        name: z.string(),
        parameters: z.record(z.string(), z.json()).optional(),
        output: z.json().optional(),
        error: z.object({ type: z.string(), message: z.string() }).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    if (step.state === "ERROR" && (step.step_type !== "tool" || !step.tool_info?.error)) {
      ctx.addIssue({ code: "custom", message: "An ERROR step requires a typed tool failure." })
    }
  })

export const AntigravityStreamRecord = z.discriminatedUnion("event", [
  z
    .object({
      event: z.literal("init"),
      conversation_id: z.string().min(1),
      init: z
        .object({
          cwd: z.string().min(1),
          tools: z.array(z.string()),
          permission_mode: z.string(),
          model: z.string().optional(),
          agent: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ event: z.literal("step_update"), step_update: Step }).strict(),
  z.object({ event: z.literal("result"), result: AntigravityHeadlessResultSchema }).strict(),
])
export type AntigravityStreamRecord = z.infer<typeof AntigravityStreamRecord>
export type AntigravityStreamResult = z.infer<typeof AntigravityHeadlessResultSchema>

export function antigravityUserMessage(content: string): string {
  if (!content.trim() || Buffer.byteLength(content) > 256 * 1024)
    throw new Error("AGY requires bounded, non-empty text.")
  if (content.trimStart().startsWith("/")) throw new Error("AGY streaming conversations do not accept slash commands.")
  return JSON.stringify({ event: "user", message: { content } }) + "\n"
}

/** Bounded framing; never truncate a protocol stream into an apparently valid result. */
export class AntigravityDecoder {
  private buffer = ""
  private decoder = new TextDecoder("utf-8", { fatal: true })
  private bytes = 0
  private records = 0

  push(chunk: Uint8Array): AntigravityStreamRecord[] {
    this.bytes += chunk.byteLength
    if (this.bytes > 32 * 1024 * 1024) throw new Error("AGY stream exceeded the attempt output limit.")
    this.buffer += this.decoder.decode(chunk, { stream: true })
    const result: AntigravityStreamRecord[] = []
    for (;;) {
      const end = this.buffer.indexOf("\n")
      if (end < 0) break
      const line = this.buffer.slice(0, end).replace(/\r$/, "")
      this.buffer = this.buffer.slice(end + 1)
      if (Buffer.byteLength(line) > 1024 * 1024 || ++this.records > 100_000)
        throw new Error("AGY record limit exceeded.")
      if (!line.trim()) throw new Error("AGY returned an empty NDJSON record.")
      // Bound nesting before recursive JSON/schema validation.
      let depth = 0,
        quoted = false,
        escaped = false
      for (const c of line) {
        if (quoted) {
          if (escaped) escaped = false
          else if (c === "\\") escaped = true
          else if (c === '"') quoted = false
        } else if (c === '"') quoted = true
        else if (c === "{" || c === "[") {
          if (++depth > 32) throw new Error("AGY JSON nesting limit exceeded.")
        } else if (c === "}" || c === "]") depth--
      }
      const value = JSON.parse(line)
      const parsed = AntigravityStreamRecord.safeParse(value)
      if (!parsed.success) {
        const shape = JSON.stringify({
          event: value?.event,
          step_type: value?.step_update?.step_type,
          state: value?.step_update?.state,
          status: value?.result?.status,
          denied_actions: value?.result?.denied_actions,
          error: value?.step_update?.tool_info?.error,
        }).slice(0, 2000)
        throw new Error(`Unsupported AGY record ${shape}: ${parsed.error.message}`)
      }
      result.push(parsed.data)
    }
    if (Buffer.byteLength(this.buffer) > 1024 * 1024) throw new Error("AGY record limit exceeded.")
    return result
  }

  end(): void {
    this.buffer += this.decoder.decode()
    if (this.buffer.length) throw new Error("AGY ended with an incomplete NDJSON record.")
  }
}

/** A single outstanding DAX turn gives unambiguous attribution without invented wire IDs. */
export class AntigravityProtocol {
  conversationID?: string
  private pending = false
  private turns = 0
  private completedSteps = new Set<number>()
  private stepTypes = new Map<number, string>()
  private previous?: AntigravityStreamResult

  constructor(private expected: { cwd: string; model: string }) {}

  beginTurn(): void {
    if (this.pending) throw new Error("An AGY turn is already active.")
    this.pending = true
  }

  accept(record: AntigravityStreamRecord): void {
    if (record.event === "init") {
      if (this.conversationID) throw new Error("AGY returned duplicate initialization.")
      if (record.init.cwd !== this.expected.cwd || record.init.model !== this.expected.model) {
        throw new Error("AGY initialization differs from the governed checkout or selected model.")
      }
      if (record.init.permission_mode === "always-proceed")
        throw new Error("AGY unrestricted permissions are not supported.")
      this.conversationID = record.conversation_id
      return
    }
    const data = record.event === "result" ? record.result : record.step_update
    if (record.event === "result" && record.result.status !== "SUCCESS") {
      throw new Error(`AGY ended with ${record.result.status}: ${record.result.error ?? "no successful result"}`)
    }
    if (!this.conversationID || data.conversation_id !== this.conversationID || !this.pending) {
      throw new Error("AGY returned an unsolicited record or changed conversation identity.")
    }
    if (record.event === "step_update") {
      const step = record.step_update
      if (this.completedSteps.has(step.step_index)) throw new Error("AGY updated a completed step.")
      const kind = this.stepTypes.get(step.step_index)
      if (kind && kind !== step.step_type) throw new Error("AGY changed step type.")
      this.stepTypes.set(step.step_index, step.step_type)
      if (step.state === "DONE" || step.state === "ERROR") this.completedSteps.add(step.step_index)
      return
    }
    const result = record.result
    if (result.num_turns !== this.turns + 1) throw new Error("AGY returned an unexpected turn counter.")
    if (
      this.previous &&
      (result.duration_seconds < this.previous.duration_seconds ||
        Object.keys(result.usage).some(
          (key) =>
            result.usage[key as keyof typeof result.usage] < this.previous!.usage[key as keyof typeof result.usage],
        ))
    ) {
      throw new Error("AGY cumulative counters regressed.")
    }
    this.previous = result
    this.turns++
    this.pending = false
  }

  end(): void {
    if (this.pending || !this.turns) throw new Error("AGY exited without a terminal result for every submitted turn.")
  }
}
