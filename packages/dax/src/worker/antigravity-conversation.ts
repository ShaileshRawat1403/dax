import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionStatus } from "@/session/status"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { ContractGuardian } from "@/execution/contract-guardian"
import { getProjectedRunState } from "@/state/events/run-event-store"
import { acquireRunLock, tryAcquireRunLock } from "@/util/fs-lock"
import { startAntigravityProcess } from "./antigravity-process"
import { buildWorkerSandboxPlan } from "./worker-sandbox"
import { startEgressProxy } from "./egress-proxy"
import { redactEvidenceText } from "./evidence-redaction"
import {
  AntigravityStop,
  antigravityUserMessage,
  describeAntigravityStop,
  emptyAntigravityActivity,
  formatAntigravityActivity,
  recordAntigravityDenied,
  recordAntigravityTool,
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
  cancel: (reason?: string) => void
  done: Promise<unknown>
}
const unsettled = ["compiled", "queued", "running"]
const active = Instance.state(
  () => new Map<string, Handle>(),
  async (sessions) => {
    // Instance disposal (backend shutdown, reload, provider reconnect) ends DAX
    // ownership of these processes. Record that reason, then give each owning
    // workflow a bounded chance to seal canonical state, so a stopping backend
    // does not leave a running canonical run behind with no process.
    const owned = [...sessions.entries()]
    for (const [, handle] of owned) handle.cancel(AntigravityStop.released)
    await Promise.allSettled(
      owned.map(async ([runID, handle]) => {
        await handle.done.catch(() => {})
        const deadline = Date.now() + 5_000
        while (Date.now() < deadline && unsettled.includes((await getProjectedRunState(runID))?.status ?? ""))
          await Bun.sleep(25)
      }),
    )
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

/**
 * An open AGY generation that no live DAX process owns can never continue: its
 * process group died with its owner through the ownership pipe. Seal it once,
 * under the attempt lock, rather than leave canonical state running forever.
 */
async function sealUnowned(sessionID: string): Promise<void> {
  const session = await Session.get(sessionID)
  const runID = session.governingRunId ?? session.id
  const phase = session.externalAgent?.phase
  if (!phase || phase === "closed" || phase === "failed" || active().has(runID)) return
  // run() holds this lock from before its durable generation until it records a
  // terminal phase, so a held lock means a live DAX process still owns AGY.
  const lock = await tryAcquireRunLock(`agy-${runID}`)
  if (!lock) return
  try {
    const canonical = await getProjectedRunState(runID)
    if (canonical && unsettled.includes(canonical.status)) {
      const { RunLifecycle } = await import("@/state/run-lifecycle")
      await RunLifecycle.transition(runID, "failed", "run_failed", {
        error: { code: "execution_error", message: AntigravityStop.lost, retryable: false },
      })
    } else if (canonical && canonical.status !== "failed" && canonical.status !== "cancelled") return
    await Session.update(sessionID, (draft) => {
      if (draft.externalAgent) draft.externalAgent = { ...draft.externalAgent, phase: "failed" }
    })
  } finally {
    await lock.dispose()
  }
}

/** Explain from canonical authority why this backend has no live AGY process for a session. */
async function notLive(sessionID: string): Promise<string> {
  await sealUnowned(sessionID)
  const session = await Session.get(sessionID)
  const phase = session.externalAgent?.phase
  const canonical = await getProjectedRunState(session.governingRunId ?? session.id)
  const running = !!canonical && unsettled.includes(canonical.status)
  if (phase === "closed")
    return `AGY conversation is not live: it finished for review and DAX verification and approval continue (canonical status: ${canonical?.status ?? "unknown"}). Start a new AGY conversation to keep chatting.`
  if (running && phase !== "failed")
    return `AGY conversation is not live in this DAX backend (${phase ?? "preparing"}): it is still starting or another DAX process owns it. Wait, or stop the attempt.`
  const sealed =
    "This governed attempt is sealed because DAX cannot safely replay an uncertain external-agent turn. Start a new AGY conversation."
  if (running)
    return `AGY conversation is not live. The AGY process ended and DAX has not recorded the canonical outcome yet; if its backend stopped first, review it with \`dax recover\`. ${sealed}`
  const reason = canonical?.error?.message.split("\n")[0]
  return `AGY conversation is not live. ${reason ? `Attempt ended: ${reason}` : "The attempt ended."} ${sealed}`
}

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
    await sealUnowned(sessionID)
    const session = await Session.get(sessionID)
    const runID = session.governingRunId ?? session.id
    const canonical = await getProjectedRunState(runID)
    if (canonical && unsettled.includes(canonical.status)) {
      const { RunLifecycle } = await import("@/state/run-lifecycle")
      await RunLifecycle.transition(runID, "failed", "run_failed", {
        error: {
          code: "worker_cancelled",
          message: session.externalAgent ? AntigravityStop.operator : AntigravityStop.beforeStart,
          retryable: false,
        },
      })
    }
    return true
  }

  export async function finish(sessionID: string): Promise<void> {
    const handle = active().get(sessionID)
    if (!handle) throw new Error(await notLive(sessionID))
    handle.finish()
    await handle.done
  }

  /** Operator view of an attempt: the canonical outcome, and whether this backend owns a live AGY process. */
  export async function status(sessionID: string) {
    const session = await Session.get(sessionID)
    const canonical = await getProjectedRunState(session.governingRunId ?? session.id)
    return {
      live: active().has(sessionID),
      phase: session.externalAgent?.phase,
      canonicalStatus: canonical?.status,
      stop: canonical?.error ? describeAntigravityStop(canonical.error.message) : undefined,
    }
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
    if (!handle) throw new Error(await notLive(input.sessionID))
    const text = input.parts.map((part) => part.text ?? "").join("\n\n")
    antigravityUserMessage(text)
    return handle.send(input.system ? `${input.system}\n\n${text}` : text, input.messageID)
  }

  export async function run(input: {
    invocation: WorkerInvocation
    cwd: string
    contract: WorkerContract
    effort?: "low" | "medium" | "high"
    /** Sandbox binary resolution, injectable exactly as in buildWorkerSandboxPlan; production uses PATH. */
    which?: Parameters<typeof buildWorkerSandboxPlan>[0]["which"]
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
    let activity: MessageV2.TextPart | undefined
    let activityID = ""
    let observed = emptyAntigravityActivity()
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
    // AGY tool reports collapse into one bounded part per turn: an inspectable
    // external-agent observation, never repeated chat prose or DAX evidence.
    const report = async (settled: boolean) => {
      if (!assistant) return
      activity = {
        id: activityID,
        sessionID: runID,
        messageID: assistant.id,
        type: "text",
        text: formatAntigravityActivity(observed, settled),
        metadata: { origin: "external-agent-report", generationID: state.generationID, activity: observed },
      }
      await Session.updatePart(activity)
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
          observed = recordAntigravityTool(observed, {
            index: step.step_index,
            tool: clean(step.tool_name ?? step.tool_info?.name ?? "tool"),
            failed: step.state === "ERROR",
          })
          await report(false)
        }
      } else if (record.event === "result" && assistant && part) {
        const denied = (record.result.denied_actions ?? []).map(
          (action) => `${clean(action.display_name)} (${clean(action.action)})`,
        )
        observed = recordAntigravityDenied(observed, denied)
        if (activity || denied.length) await report(true)
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
        which: input.which,
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
          activity = undefined
          observed = emptyAntigravityActivity()
          // Allocated before the reply part so the activity line sorts above the reply.
          activityID = Identifier.ascending("part")
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
          // An uncertain turn ends the attempt; record why rather than an operator stop.
          worker.cancel(clean(error instanceof Error ? error.message : String(error)))
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
        cancel: (reason) => worker.cancel(reason),
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
        if (activity) await report(true).catch(() => {})
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
