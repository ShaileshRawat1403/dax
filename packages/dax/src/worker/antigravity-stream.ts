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

/**
 * Canonical failure messages for AGY stops. DAX records the reason once, in the
 * canonical run failure; the UI classifies that record instead of keeping a
 * second failure authority. Keep them stable: durable runs carry them.
 */
export const AntigravityStop = {
  operator: "AGY attempt cancelled by the operator.",
  beforeStart: "AGY attempt cancelled before process start.",
  released:
    "AGY attempt ended because DAX released process ownership (backend shutdown, reload, or instance disposal).",
  lost: "AGY attempt ended because DAX lost process ownership (the backend that owned it stopped before sealing it).",
  exit: "AGY process exited unexpectedly",
  initialization: "AGY initialization timed out.",
  idle: "AGY conversation idle timeout.",
  deadline: "AGY governed attempt timed out.",
  protocol: "AGY protocol failure",
} as const

export type AntigravityStopReason =
  | "operator_cancelled"
  | "ownership_released"
  | "ownership_lost"
  | "unexpected_exit"
  | "initialization_timeout"
  | "idle_timeout"
  | "attempt_timeout"
  | "protocol_failure"
  | "execution_failed"

const stopReasons: [prefix: string, reason: AntigravityStopReason, label: string][] = [
  [AntigravityStop.operator, "operator_cancelled", "stopped by the operator"],
  [AntigravityStop.beforeStart, "operator_cancelled", "stopped by the operator before AGY started"],
  [AntigravityStop.released, "ownership_released", "DAX backend shut down, reloaded, or was reconfigured"],
  [AntigravityStop.lost, "ownership_lost", "DAX backend that owned AGY stopped"],
  [AntigravityStop.exit, "unexpected_exit", "AGY process exited unexpectedly"],
  [AntigravityStop.initialization, "initialization_timeout", "AGY did not initialize in time"],
  // Retained for durable runs from builds that killed AGY after 5 idle minutes.
  [AntigravityStop.idle, "idle_timeout", "idle timeout"],
  [AntigravityStop.deadline, "attempt_timeout", "attempt reached its contract timeout"],
  [AntigravityStop.protocol, "protocol_failure", "AGY protocol or turn failure"],
]

/** Classify a canonical failure message; anything else is a DAX execution failure. */
export function describeAntigravityStop(message: string | undefined) {
  const text = message ?? ""
  const match = stopReasons.find(([prefix]) => text.startsWith(prefix))
  return { reason: match?.[1] ?? "execution_failed", label: match?.[2] ?? "DAX execution failed", message: text }
}

/** Bounded per-turn summary of AGY-reported tool activity. An observation, never DAX evidence. */
export type AntigravityActivity = {
  actions: number
  failures: number
  latest?: string
  failed: string[]
  denied: string[]
  steps: { index: number; tool: string; state: "DONE" | "ERROR" }[]
}

export const emptyAntigravityActivity = (): AntigravityActivity => ({
  actions: 0,
  failures: 0,
  failed: [],
  denied: [],
  steps: [],
})

export function recordAntigravityTool(
  activity: AntigravityActivity,
  step: { index: number; tool: string; failed: boolean },
): AntigravityActivity {
  return {
    ...activity,
    actions: activity.actions + 1,
    failures: activity.failures + (step.failed ? 1 : 0),
    latest: step.tool,
    failed:
      step.failed && !activity.failed.includes(step.tool) ? [...activity.failed, step.tool].slice(-5) : activity.failed,
    steps: [...activity.steps, { index: step.index, tool: step.tool, state: step.failed ? "ERROR" : "DONE" } as const].slice(
      -50,
    ),
  }
}

export function recordAntigravityDenied(activity: AntigravityActivity, denied: string[]): AntigravityActivity {
  return denied.length ? { ...activity, denied: [...activity.denied, ...denied].slice(0, 20) } : activity
}

export function formatAntigravityActivity(activity: AntigravityActivity, settled: boolean): string {
  const actions = `${activity.actions} action${activity.actions === 1 ? "" : "s"}`
  return [
    settled ? `AGY reported ${actions}` : `AGY working · ${actions}`,
    activity.latest && `latest: ${activity.latest}`,
    activity.failures > 0 && `${activity.failures} failed (${activity.failed.join(", ")})`,
    activity.denied.length > 0 && `denied: ${activity.denied.join(", ")}; DAX permissions were not expanded`,
    settled && "observation only, not DAX verification evidence",
  ]
    .filter(Boolean)
    .join(" · ")
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
