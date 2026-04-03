import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"
import { Session } from "."
import { Agent } from "@/agent/agent"
import { Snapshot } from "@/snapshot"
import { SessionSummary } from "./summary"
import { Bus } from "@/bus"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { Plugin } from "@/plugin"
import type { Provider } from "@/provider/provider"
import { LLM } from "./llm"
import { Config } from "@/config/config"
import { SessionCompaction } from "./compaction"
import { Permission } from "@/governance"
import { Question } from "@/question"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const PROVIDER_DELAY_THRESHOLD_MS = 12_000
  const PROVIDER_STALL_TIMEOUT_MS = Math.max(30_000, Number(process.env.DAX_PROVIDER_STALL_TIMEOUT_MS ?? 180_000))
  const log = Log.create({ service: "session.processor" })

  export type Info = Awaited<ReturnType<typeof create>>
  export type Result = Awaited<ReturnType<Info["process"]>>

  export function create(input: {
    assistantMessage: MessageV2.Assistant
    sessionID: string
    model: Provider.Model
    abort: AbortSignal
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {}
    let snapshot: string | undefined
    let blocked = false
    let attempt = 0
    let needsCompaction = false

    const result = {
      get message() {
        return input.assistantMessage
      },
      partFromToolCall(toolCallID: string) {
        return toolcalls[toolCallID]
      },
      async process(streamInput: LLM.StreamInput) {
        log.info("process")
        needsCompaction = false
        const shouldBreak = (await Config.get()).experimental?.continue_loop_on_deny !== true
        while (true) {
          try {
            let currentText: MessageV2.TextPart | undefined
            const reasoningMap: Record<string, MessageV2.ReasoningPart> = {}
            const shouldTrackDelayedProvider = input.model.providerID === "google"
            let lastProgressAt = Date.now()
            let delayedRaised = false
            const touchProgress = () => {
              lastProgressAt = Date.now()
              if (delayedRaised) {
                delayedRaised = false
                SessionStatus.set(input.sessionID, { type: "busy" })
              }
            }
            const delayedMessage =
              input.model.providerID === "google"
                ? "Gemini is slow right now. The run is still alive and waiting on the provider."
                : "Provider response is delayed. The run is still alive and waiting."
            const delayedMonitor =
              shouldTrackDelayedProvider &&
              setInterval(() => {
                if (delayedRaised) return
                if (Date.now() - lastProgressAt < PROVIDER_DELAY_THRESHOLD_MS) return
                delayedRaised = true
                SessionStatus.set(input.sessionID, {
                  type: "delayed",
                  message: delayedMessage,
                  since: lastProgressAt,
                })
              }, 1000)
            const timeoutSignal = AbortSignal.timeout(PROVIDER_STALL_TIMEOUT_MS)
            const combinedAbort = AbortSignal.any([input.abort, timeoutSignal])
            const stream = await LLM.stream({
              ...streamInput,
              abort: combinedAbort,
            })

            try {
              const iterator = stream.fullStream[Symbol.asyncIterator]()
              const nextEvent = async () => {
                const remaining = PROVIDER_STALL_TIMEOUT_MS - (Date.now() - lastProgressAt)
                if (remaining <= 0) {
                  throw new Error(
                    `Provider stream timed out after ${Math.round(PROVIDER_STALL_TIMEOUT_MS / 1000)}s with no completion signal.`,
                  )
                }
                return Promise.race([
                  iterator.next(),
                  new Promise<IteratorResult<any, any>>((_, reject) => {
                    const timer = setTimeout(() => {
                      clearTimeout(timer)
                      reject(
                        new Error(
                          `Provider stream timed out after ${Math.round(PROVIDER_STALL_TIMEOUT_MS / 1000)}s with no completion signal.`,
                        ),
                      )
                    }, remaining)
                  }),
                ])
              }
              while (true) {
                const next = await nextEvent()
                if (next.done) break
                const value = next.value
                input.abort.throwIfAborted()
                if (value.type !== "finish") touchProgress()
                switch (value.type) {
                  case "start":
                    SessionStatus.set(input.sessionID, { type: "busy" })
                    break

                  case "reasoning-start":
                    if (value.id in reasoningMap) {
                      continue
                    }
                    reasoningMap[value.id] = {
                      id: Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "reasoning",
                      text: "",
                      time: {
                        start: Date.now(),
                      },
                      metadata: value.providerMetadata,
                    }
                    break

                  case "reasoning-delta":
                    if (value.id in reasoningMap) {
                      const part = reasoningMap[value.id]
                      part.text += value.text
                      if (value.providerMetadata) part.metadata = value.providerMetadata
                      if (part.text) await Session.updatePart({ part, delta: value.text })
                    }
                    break

                  case "reasoning-end":
                    if (value.id in reasoningMap) {
                      const part = reasoningMap[value.id]
                      part.text = part.text.trimEnd()

                      part.time = {
                        ...part.time,
                        end: Date.now(),
                      }
                      if (value.providerMetadata) part.metadata = value.providerMetadata
                      await Session.updatePart(part)
                      delete reasoningMap[value.id]
                    }
                    break

                  case "tool-input-start":
                    const part = await Session.updatePart({
                      id: toolcalls[value.id]?.id ?? Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "tool",
                      tool: value.toolName,
                      callID: value.id,
                      state: {
                        status: "pending",
                        input: {},
                        raw: "",
                      },
                    })
                    toolcalls[value.id] = part as MessageV2.ToolPart
                    break

                  case "tool-input-delta":
                    break

                  case "tool-input-end":
                    break

                  case "tool-call": {
                    const match = toolcalls[value.toolCallId]
                    if (match) {
                      const part = await Session.updatePart({
                        ...match,
                        tool: value.toolName,
                        state: {
                          status: "running",
                          input: value.input,
                          time: {
                            start: Date.now(),
                          },
                        },
                        metadata: value.providerMetadata,
                      })
                      toolcalls[value.toolCallId] = part as MessageV2.ToolPart
                    }
                    break
                  }
                  case "tool-result": {
                    const match = toolcalls[value.toolCallId]
                    if (match && match.state.status === "running") {
                      await Session.updatePart({
                        ...match,
                        state: {
                          status: "completed",
                          input: value.input ?? match.state.input,
                          output: value.output.output,
                          metadata: value.output.metadata,
                          title: value.output.title,
                          time: {
                            start: match.state.time.start,
                            end: Date.now(),
                          },
                          attachments: value.output.attachments,
                        },
                      })

                      delete toolcalls[value.toolCallId]
                    }
                    break
                  }

                  case "tool-error": {
                    const match = toolcalls[value.toolCallId]
                    if (match && match.state.status === "running") {
                      await Session.updatePart({
                        ...match,
                        state: {
                          status: "error",
                          input: value.input ?? match.state.input,
                          error: (value.error as any).toString(),
                          time: {
                            start: match.state.time.start,
                            end: Date.now(),
                          },
                        },
                      })

                      if (
                        value.error instanceof Permission.RejectedError ||
                        value.error instanceof Question.RejectedError
                      ) {
                        input.assistantMessage.error = MessageV2.fromError(value.error, {
                          providerID: input.model.providerID,
                        })
                        blocked = shouldBreak
                      }
                      delete toolcalls[value.toolCallId]
                    }
                    break
                  }
                  case "error":
                    throw value.error

                  case "start-step":
                    snapshot = await Snapshot.track()
                    await Session.updatePart({
                      id: Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.sessionID,
                      snapshot,
                      type: "step-start",
                    })
                    break

                  case "finish-step":
                    const usage = Session.getUsage({
                      model: input.model,
                      usage: value.usage,
                      metadata: value.providerMetadata,
                    })
                    input.assistantMessage.finish = value.finishReason
                    input.assistantMessage.cost += usage.cost
                    input.assistantMessage.tokens = usage.tokens
                    await Session.updatePart({
                      id: Identifier.ascending("part"),
                      reason: value.finishReason,
                      snapshot: await Snapshot.track(),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "step-finish",
                      tokens: usage.tokens,
                      cost: usage.cost,
                    })
                    await Session.updateMessage(input.assistantMessage)
                    if (snapshot) {
                      const patch = await Snapshot.patch(snapshot)
                      if (patch.files.length) {
                        await Session.updatePart({
                          id: Identifier.ascending("part"),
                          messageID: input.assistantMessage.id,
                          sessionID: input.sessionID,
                          type: "patch",
                          hash: patch.hash,
                          files: patch.files,
                        })
                      }
                      snapshot = undefined
                    }
                    SessionSummary.summarize({
                      sessionID: input.sessionID,
                      messageID: input.assistantMessage.parentID,
                    }).catch(() => {})
                    if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
                      needsCompaction = true
                    }
                    break

                  case "text-start":
                    currentText = {
                      id: Identifier.ascending("part"),
                      messageID: input.assistantMessage.id,
                      sessionID: input.assistantMessage.sessionID,
                      type: "text",
                      text: "",
                      time: {
                        start: Date.now(),
                      },
                      metadata: value.providerMetadata,
                    }
                    break

                  case "text-delta":
                    if (currentText) {
                      currentText.text += value.text
                      if (value.providerMetadata) currentText.metadata = value.providerMetadata
                      if (currentText.text)
                        await Session.updatePart({
                          part: currentText,
                          delta: value.text,
                        })
                    }
                    break

                  case "text-end":
                    if (currentText) {
                      currentText.text = currentText.text.trimEnd()
                      const textOutput = await Plugin.trigger(
                        "experimental.text.complete",
                        {
                          sessionID: input.sessionID,
                          messageID: input.assistantMessage.id,
                          partID: currentText.id,
                        },
                        { text: currentText.text },
                      )
                      currentText.text = textOutput.text
                      currentText.time = {
                        start: currentText.time?.start ?? Date.now(),
                        end: Date.now(),
                      }
                      if (value.providerMetadata) currentText.metadata = value.providerMetadata
                      await Session.updatePart(currentText)
                    }
                    currentText = undefined
                    break

                  case "finish":
                    break

                  default:
                    log.info("unhandled", {
                      ...value,
                    })
                    continue
                }
                if (needsCompaction) break
              }
            } finally {
              if (delayedMonitor) clearInterval(delayedMonitor)
            }
          } catch (caught: unknown) {
            const e =
              !input.abort.aborted && caught instanceof Error && caught.name === "AbortError"
                ? new Error(
                    `Provider stream timed out after ${Math.round(PROVIDER_STALL_TIMEOUT_MS / 1000)}s with no completion signal.`,
                  )
                : caught instanceof Error
                  ? caught
                  : new Error(String(caught))
            log.error("process", {
              error: e,
              stack: JSON.stringify(e.stack),
            })
            const error = MessageV2.fromError(e, { providerID: input.model.providerID })
            const retry = SessionRetry.retryable(error)
            if (retry !== undefined) {
              attempt++
              const delay = SessionRetry.delay(attempt, error.name === "APIError" ? error : undefined)
              SessionStatus.set(input.sessionID, {
                type: "retry",
                attempt,
                message: retry,
                next: Date.now() + delay,
              })
              await SessionRetry.sleep(delay, input.abort).catch(() => {})
              continue
            }
            input.assistantMessage.error = error
            Bus.publish(Session.Event.Error, {
              sessionID: input.assistantMessage.sessionID,
              error: input.assistantMessage.error,
            })
            SessionStatus.set(input.sessionID, { type: "idle" })
          }
          if (snapshot) {
            const patch = await Snapshot.patch(snapshot)
            if (patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: patch.hash,
                files: patch.files,
              })
            }
            snapshot = undefined
          }
          const p = await MessageV2.parts(input.assistantMessage.id)
          for (const part of p) {
            if (part.type === "tool" && part.state.status !== "completed" && part.state.status !== "error") {
              await Session.updatePart({
                ...part,
                state: {
                  ...part.state,
                  status: "error",
                  error: "Tool execution aborted",
                  time: {
                    start: "time" in part.state && part.state.time?.start ? part.state.time.start : Date.now(),
                    end: Date.now(),
                  },
                },
              })
            }
          }
          input.assistantMessage.time.completed = Date.now()
          await Session.updateMessage(input.assistantMessage)
          if (needsCompaction) return "compact"
          if (blocked) return "stop"
          if (input.assistantMessage.error) return "stop"
          return "continue"
        }
      },
    }
    return result
  }
}
