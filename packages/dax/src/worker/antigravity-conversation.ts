import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionStatus } from "@/session/status"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { ContractGuardian } from "@/execution/contract-guardian"
import { getProjectedRunState } from "@/state/events/run-event-store"
import { acquireRunLock } from "@/util/fs-lock"
import { startAntigravityProcess } from "./antigravity-process"
import { buildWorkerSandboxPlan } from "./worker-sandbox"
import { startEgressProxy } from "./egress-proxy"
import { redactEvidenceText } from "./evidence-redaction"
import {
  antigravityUserMessage,
  type AntigravitySessionState,
  type AntigravityStreamRecord,
} from "./antigravity-stream"
import { renderWorkerPrompt, type WorkerContract, type WorkerInvocation } from "./worker-adapter"
import stripAnsi from "strip-ansi"
import path from "node:path"
import { realpath } from "node:fs/promises"

type Handle = {
  send: (text: string, messageID?: string) => Promise<MessageV2.WithParts>
  finish: () => void
  cancel: () => void
  done: Promise<unknown>
}
const active = Instance.state(
  () => new Map<string, Handle>(),
  async (sessions) => {
    for (const handle of sessions.values()) handle.cancel()
    await Promise.allSettled([...sessions.values()].map((handle) => handle.done))
  },
)
const firstTurns = Instance.state(
  () =>
    new Map<
      string,
      {
        messageID?: string
        resolve: (reply: MessageV2.WithParts) => void
        reject: (error: Error) => void
      }
    >(),
)
// Remove terminal control bytes from untrusted external-agent output.
// eslint-disable-next-line no-control-regex
const clean = (text: string) => redactEvidenceText(stripAnsi(text)).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")

// Match the Session/SessionPrompt service API used by the existing runtime.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace AntigravityConversation {
  /** Selecting a model is inert. The first ordinary chat message starts its
   * governed attempt in the same session, without a separate task wizard. */
  export async function startChat(input: {
    sessionID: string
    messageID?: string
    parts: { type: string; text?: string }[]
    noReply?: boolean
    model?: { providerID: string; modelID: string }
    variant?: string
  }): Promise<MessageV2.WithParts> {
    if (input.noReply || input.parts.some((part) => part.type !== "text"))
      throw new Error("AGY conversations accept text messages only.")
    if (input.model?.providerID !== "worker:antigravity") throw new Error("Select an AGY account model first.")
    const text = input.parts.map((part) => part.text ?? "").join("\n\n")
    antigravityUserMessage(text)
    if (firstTurns().has(input.sessionID))
      throw new Error("The first AGY reply is still starting. Wait before sending another message.")
    const reply = Promise.withResolvers<MessageV2.WithParts>()
    void reply.promise.catch(() => {})
    firstTurns().set(input.sessionID, { messageID: input.messageID, resolve: reply.resolve, reject: reply.reject })
    try {
      const session = await Session.get(input.sessionID)
      if (session.governingRunId || (await ContractGuardian.get(input.sessionID))) {
        throw new Error("This session already has an execution contract. Start a new chat with the AGY model selected.")
      }
      const { discoverAntigravityModels, requireAntigravityModel } = await import("./antigravity-models")
      requireAntigravityModel(input.model.modelID, await discoverAntigravityModels({ forceRefresh: true }))
      const { compileWithRunId } = await import("@/execution/compiler")
      const { deriveDefaultValidationCommands } = await import("@/execution/default-validation-commands")
      const { createEventAuthorityRun, transitionEventAuthority } = await import("@/state/events/event-transitions")
      const { WorkerRunWorkflow } = await import("@/workflows/worker-run")
      const { AntigravityConversationOptions } = await import("./antigravity-stream")
      const conversation = AntigravityConversationOptions.parse({ effort: input.variant })
      const repository = Instance.worktree
      const { contract } = compileWithRunId(
        {
          request: {
            intent: { input: text, repoPath: repository },
            workflowHint: "worker_run",
            personaPreset: {
              personaId: "governed-worker",
              providerHint: "worker:antigravity",
              modelHint: input.model.modelID,
            },
            workerConstraints: {
              conversation,
              writeScope: ["**"],
              verification: deriveDefaultValidationCommands(repository).slice(0, 1),
              egress: { filter: true, allowHosts: [] },
            },
          },
        },
        input.sessionID,
      )
      await ContractGuardian.create(input.sessionID, contract)
      await createEventAuthorityRun(input.sessionID, contract.contractId, true)
      await transitionEventAuthority(input.sessionID, "queued", "execution_queued", {})
      await transitionEventAuthority(input.sessionID, "running", "workflow_started", {})
      await Session.bindGoverningRun(input.sessionID, input.sessionID)
      const execution = new WorkerRunWorkflow({ runId: input.sessionID, contract }).execute()
      void execution.then((result) => {
        if (!result.success) reply.reject(new Error(result.error ?? "AGY conversation could not start."))
      }, reply.reject)
      return await reply.promise
    } finally {
      firstTurns().delete(input.sessionID)
    }
  }
  export async function isBound(sessionID: string): Promise<boolean> {
    const session = await Session.get(sessionID)
    const contract = await ContractGuardian.get(session.governingRunId ?? session.id)
    return session.externalAgent?.kind === "antigravity" || !!contract?.runtimePolicy?.workerConversation
  }

  export function cancel(sessionID: string): boolean {
    const handle = active().get(sessionID)
    if (!handle) return false
    handle.cancel()
    return true
  }

  export async function cancelSession(sessionID: string): Promise<boolean> {
    if (cancel(sessionID)) return true
    if (!(await isBound(sessionID))) return false
    if (cancel(sessionID)) return true
    const session = await Session.get(sessionID)
    const runID = session.governingRunId ?? session.id
    const canonical = await getProjectedRunState(runID)
    if (canonical && ["compiled", "queued", "running"].includes(canonical.status)) {
      const { RunLifecycle } = await import("@/state/run-lifecycle")
      await RunLifecycle.transition(runID, "failed", "run_failed", {
        error: { code: "worker_cancelled", message: "AGY attempt cancelled before process start.", retryable: false },
      })
    }
    return true
  }

  export async function finish(sessionID: string): Promise<void> {
    const handle = active().get(sessionID)
    if (!handle)
      throw new Error("No live AGY process. Start a new governed conversation; uncertain prompts are never replayed.")
    handle.finish()
    await handle.done
  }

  export async function prompt(input: {
    sessionID: string
    messageID?: string
    parts: { type: string; text?: string }[]
    system?: string
    noReply?: boolean
    model?: { providerID: string; modelID: string }
  }): Promise<MessageV2.WithParts> {
    if (input.noReply || input.parts.some((part) => part.type !== "text"))
      throw new Error("AGY conversations accept text messages only.")
    const session = await Session.get(input.sessionID)
    if (firstTurns().has(input.sessionID)) {
      throw new Error("AGY is starting its first reply. Wait for it to finish before sending another message.")
    }
    if (
      input.model &&
      (input.model.providerID !== "worker:antigravity" || input.model.modelID !== session.externalAgent?.model)
    ) {
      throw new Error("The AGY model is fixed for this governed attempt. Start a new conversation to change it.")
    }
    const handle = active().get(input.sessionID)
    if (!handle)
      throw new Error("AGY conversation is not live. Start a new governed conversation; automatic resume is disabled.")
    const text = input.parts.map((part) => part.text ?? "").join("\n\n")
    antigravityUserMessage(text)
    return handle.send(input.system ? `${input.system}\n\n${text}` : text, input.messageID)
  }

  export async function run(input: {
    invocation: WorkerInvocation
    cwd: string
    contract: WorkerContract
    effort?: "low" | "medium" | "high"
  }) {
    const runID = input.contract.runId
    const existing = await Session.get(runID)
    if (existing.externalAgent)
      throw new Error("AGY attempt was already started. Refusing to replay an uncertain conversation.")
    const lock = await acquireRunLock(`agy-${runID}`)
    let proxy: Awaited<ReturnType<typeof startEgressProxy>> | undefined
    let process: ReturnType<typeof startAntigravityProcess> | undefined
    let assistant: MessageV2.Assistant | undefined
    let part: MessageV2.TextPart | undefined
    let rawText = ""
    let sending = false
    let previousUsage = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 }
    const state: AntigravitySessionState = {
      kind: "antigravity",
      model: input.contract.modelHint!,
      effort: input.effort,
      generationID: crypto.randomUUID(),
      phase: "starting",
    }
    const update = async (phase: AntigravitySessionState["phase"]) => {
      state.phase = phase
      await Session.update(runID, (draft) => {
        draft.externalAgent = { ...state }
      })
      SessionStatus.set(runID, {
        type: phase === "ready" || phase === "closed" || phase === "failed" ? "idle" : "busy",
      })
    }
    const onRecord = async (record: AntigravityStreamRecord) => {
      if (record.event === "init") {
        state.conversationID = record.conversation_id
        await update("responding")
      } else if (record.event === "step_update" && assistant) {
        const step = record.step_update
        if (step.step_type === "agent_response" && step.text_delta !== undefined && part) {
          rawText += step.text_delta
          const next = clean(rawText)
          const delta = next.startsWith(part.text) ? next.slice(part.text.length) : undefined
          part.text = next
          await Session.updatePart(delta !== undefined ? { part, delta } : part)
        } else if ((step.state === "DONE" || step.state === "ERROR") && step.step_type === "tool") {
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: assistant.id,
            sessionID: runID,
            type: "text",
            text: `AGY reported activity: ${clean(step.tool_name ?? step.tool_info?.name ?? "tool")}${step.state === "ERROR" ? " failed" : ""} (not DAX verification evidence).`,
            metadata: { origin: "external-agent-report", generationID: state.generationID, stepIndex: step.step_index },
          })
        }
      } else if (record.event === "result" && assistant && part) {
        for (const denied of record.result.denied_actions ?? []) {
          await Session.updatePart({
            id: Identifier.ascending("part"),
            messageID: assistant.id,
            sessionID: runID,
            type: "text",
            text: `AGY denied activity: ${clean(denied.display_name)} (${clean(denied.action)}). DAX permissions were not expanded.`,
            metadata: { origin: "external-agent-report", generationID: state.generationID },
          })
        }
        // The result is the authoritative AGY turn text, never proof of DAX completion.
        part.text = clean(record.result.response)
        part.time = { start: assistant.time.created, end: Date.now() }
        await Session.updatePart(part)
        const usage = record.result.usage
        assistant.tokens = {
          input: usage.input_tokens - previousUsage.input_tokens,
          output: usage.output_tokens - previousUsage.output_tokens,
          reasoning: usage.thinking_tokens - previousUsage.thinking_tokens,
          cache: { read: usage.cache_read_tokens - previousUsage.cache_read_tokens, write: 0 },
        }
        previousUsage = usage
        assistant.time.completed = Date.now()
        assistant.finish = "stop"
        await Session.updateMessage(assistant)
      }
    }
    try {
      // A second launcher that waited for this lock must still see the durable
      // generation written by the first launcher; never replay a prior attempt.
      if ((await Session.get(runID)).externalAgent)
        throw new Error("AGY attempt was already started; replay is disabled.")
      const executionContract = await ContractGuardian.get(runID)
      if (!executionContract?.repoPath) throw new Error("AGY requires its canonical repository binding.")
      const repository = await realpath(executionContract.repoPath)
      const checkout = await realpath(input.cwd)
      input = { ...input, cwd: checkout }
      const within = (child: string, parent: string) => {
        const relative = path.relative(parent, child)
        return (
          relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
        )
      }
      if (repository === checkout || !within(checkout, repository))
        throw new Error("AGY requires a separate DAX-owned checkout.")
      // Existing sandbox profiles permit these auxiliary writes. Refuse a
      // repository overlapping them instead of overstating checkout isolation.
      for (const writable of [
        "/tmp",
        "/private/tmp",
        globalThis.process.env.TMPDIR,
        ...input.invocation.writableStatePaths,
      ]) {
        if (!writable) continue
        const resolved = await realpath(writable).catch(() => path.resolve(writable))
        if (within(repository, resolved) || within(resolved, repository))
          throw new Error(
            "Repository overlaps AGY writable temporary/state storage; use a separate repository directory.",
          )
      }
      await update("starting") // Durable before process spawn: a restart must never replay it.
      if (input.invocation.egress.mode === "filtered")
        proxy = await startEgressProxy({ allowHosts: input.invocation.egress.allowHosts })
      if ((await getProjectedRunState(runID))?.status !== "running")
        throw new Error("DAX stopped this attempt before AGY process start.")
      const command = [
        input.invocation.command[0],
        "--new-project",
        "--add-dir",
        input.cwd,
        "--mode",
        "accept-edits",
        "--model",
        state.model,
        ...(input.effort ? ["--effort", input.effort] : []),
        "--disable-slash-commands",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--print-timeout",
        `${Math.max(1, Math.ceil(input.invocation.timeoutMs / 1000))}s`,
      ]
      const plan = buildWorkerSandboxPlan({
        command,
        cwd: input.cwd,
        network: "full",
        writableStatePaths: input.invocation.writableStatePaths,
      })
      process = startAntigravityProcess({
        command: plan.command,
        cwd: input.cwd,
        model: state.model,
        env: { ...input.invocation.env, PATH: globalThis.process.env.PATH ?? "", ...proxy?.proxyEnv },
        timeoutMs: input.invocation.timeoutMs,
        onRecord,
      })
      const worker = process
      const send = async (
        text: string,
        messageID = Identifier.ascending("message"),
        first = false,
      ): Promise<MessageV2.WithParts> => {
        antigravityUserMessage(text)
        if (sending || (!first && state.phase !== "ready"))
          throw new Error("Wait for the active AGY response; this attempt cannot accept a message now.")
        sending = true
        try {
          const canonical = await getProjectedRunState(runID)
          if (canonical?.status !== "running") throw new Error("DAX run is not authorized to continue execution.")
          const prior = await Session.messages({ sessionID: runID })
          if (prior.some((message) => message.info.id === messageID))
            throw new Error("This message was already submitted. AGY turns are never replayed.")
          await update("responding")
          await Session.updateMessage({
            id: messageID,
            sessionID: runID,
            role: "user",
            time: { created: Date.now() },
            agent: "agy",
            model: { providerID: "worker:antigravity", modelID: state.model },
          })
          await Session.updatePart({
            id: Identifier.ascending("part"),
            sessionID: runID,
            messageID,
            type: "text",
            text,
          })
          assistant = (await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: runID,
            parentID: messageID,
            role: "assistant",
            time: { created: Date.now() },
            agent: "agy",
            mode: "agy",
            providerID: "worker:antigravity",
            modelID: state.model,
            variant: input.effort,
            path: { cwd: input.cwd, root: input.cwd },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          })) as MessageV2.Assistant
          rawText = ""
          part = {
            id: Identifier.ascending("part"),
            sessionID: runID,
            messageID: assistant.id,
            type: "text",
            text: "",
            metadata: { origin: "external-agent", generationID: state.generationID, cost: "unavailable" },
          }
          await Session.updatePart(part)
          await worker.send(
            first
              ? renderWorkerPrompt(input.contract)
              : `Follow-up within the unchanged DAX execution contract:\n\n${text}`,
          )
          await update("ready")
          return { info: assistant, parts: [part] }
        } catch (error) {
          worker.cancel()
          throw error
        } finally {
          sending = false
        }
      }
      active().set(runID, {
        send,
        done: worker.done,
        finish() {
          if (sending || state.phase !== "ready")
            throw new Error("Wait for the AGY response before finishing for review.")
          state.phase = "sealing"
          worker.finish()
          void update("sealing").catch(() => worker.cancel())
        },
        cancel: () => worker.cancel(),
      })
      const first = firstTurns().get(runID)
      const firstReply = await send(input.contract.task, first?.messageID, true)
      first?.resolve(firstReply)
      const result = await worker.done
      await update("closed")
      return { ...result, sandboxProvider: plan.provider, deniedEgress: proxy?.deniedHosts() ?? [] }
    } catch (error) {
      process?.cancel()
      await process?.done.catch(() => {})
      if (assistant && !assistant.time.completed) {
        assistant.time.completed = Date.now()
        assistant.error = {
          name: "UnknownError",
          data: { message: clean(error instanceof Error ? error.message : String(error)) },
        }
        await Session.updateMessage(assistant)
      }
      await update("failed")
      throw new Error(clean(error instanceof Error ? error.message : String(error)), { cause: error })
    } finally {
      active().delete(runID)
      await proxy?.close()
      await lock.dispose()
    }
  }
}
