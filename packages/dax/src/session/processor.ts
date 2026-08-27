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
import { updateProviderPressure } from "@/state/events/event-transitions"
import { getGeminiSubscriptionPressure } from "@/plugin/gemini-scheduler"

export namespace SessionProcessor {
  const DOOM_LOOP_THRESHOLD = 3
  const PROVIDER_DELAY_THRESHOLD_MS = 12_000
  const PROVIDER_STALL_TIMEOUT_MS = Math.max(30_000, Number(process.env.DAX_PROVIDER_STALL_TIMEOUT_MS ?? 180_000))
  const SLOW_MESSAGE_COOLDOWN_MS = 30_000
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
            const shouldTrackDelayedProvider = true
            let lastProgressAt = Date.now()
            let delayedRaised = false
            // Count tools currently between tool-call and tool-result. When > 0
            // the stream is idle because the tool is running (possibly waiting for
            // user approval/question). Do NOT flag as delayed or timeout during this.
            let toolsInFlight = 0
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
            let pressureNotified = false
            let throttleNotificationShown = false
            let lastSlowMessageTime = 0
            const trackPressure = () => {
              if (input.model.providerID === "google") {
                const pressure = getGeminiSubscriptionPressure()
                updateProviderPressure(input.sessionID, {
                  lane: "gemini-subscription",
                  inFlight: pressure.inFlight,
                  queueLength: pressure.queueLength,
                  throttles: pressure.consecutiveThrottles,
                }).catch((e) => log.error("failed to update provider pressure", { error: String(e) }))

                if (pressure.consecutiveThrottles > 0) {
                  if (!throttleNotificationShown) {
                    throttleNotificationShown = true
                    const throttleMsg =
                      pressure.consecutiveThrottles === 1
                        ? "Gemini subscription lane throttled. Retrying..."
                        : `Gemini subscription lane throttled (${pressure.consecutiveThrottles}x). Retrying in background...`
                    SessionStatus.set(input.sessionID, {
                      type: "delayed",
                      message: throttleMsg,
                      since: lastProgressAt,
                    })
                    delayedRaised = true
                  }
                  return
                } else {
                  throttleNotificationShown = false
                }

                const now = Date.now()
                if (
                  !pressureNotified &&
                  now - lastSlowMessageTime > SLOW_MESSAGE_COOLDOWN_MS &&
                  now - lastProgressAt >= PROVIDER_DELAY_THRESHOLD_MS
                ) {
                  pressureNotified = true
                  lastSlowMessageTime = now
                  SessionStatus.set(input.sessionID, {
                    type: "delayed",
                    message: delayedMessage,
                    since: lastProgressAt,
                  })
                  delayedRaised = true
                }
              }
            }
            // Use a managed abort controller so we can reset the stall deadline
            // while tools are in-flight (waiting for user input, approvals, etc.).
            // AbortSignal.timeout() would fire unconditionally after 180 s and
            // kill the stream even when the question tool is just waiting for the
            // user to type an answer.
            const stallController = new AbortController()
            let stallTimer = setTimeout(() => stallController.abort(), PROVIDER_STALL_TIMEOUT_MS)
            const resetStallTimer = () => {
              clearTimeout(stallTimer)
              stallTimer = setTimeout(() => stallController.abort(), PROVIDER_STALL_TIMEOUT_MS)
            }
            const combinedAbort = AbortSignal.any([input.abort, stallController.signal])

            const delayedMonitor =
              shouldTrackDelayedProvider &&
              setInterval(() => {
                const now = Date.now()
                if (now - lastSlowMessageTime < SLOW_MESSAGE_COOLDOWN_MS) return
                trackPressure()
                if (delayedRaised) return
                // A tool is in-flight — it may be waiting for user approval or a
                // question answer. Keep the progress timer and the stall deadline
                // fresh so we never incorrectly flag "delayed" or fire the timeout.
                if (toolsInFlight > 0) {
                  lastProgressAt = Date.now()
                  resetStallTimer()
                  return
                }
                if (Date.now() - lastProgressAt < PROVIDER_DELAY_THRESHOLD_MS) return
                lastSlowMessageTime = now
                delayedRaised = true
                SessionStatus.set(input.sessionID, {
                  type: "delayed",
                  message: delayedMessage,
                  since: lastProgressAt,
                })
              }, 1000)

            trackPressure()
            const stream = await LLM.stream({
              ...streamInput,
              abort: combinedAbort,
            })

            try {
              const iterator = stream.fullStream[Symbol.asyncIterator]()
              const nextEvent = async () => {
                // While tools are in-flight the LLM stream is paused waiting for
                // tool execution results (e.g. the question tool blocking on user
                // input). The stall timer is already being reset by the monitor
                // above — do NOT race against an additional fixed setTimeout here
                // or the question tool will always time out after 180 s.
                if (toolsInFlight > 0) {
                  return iterator.next()
                }
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
                    toolsInFlight++
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
                    toolsInFlight = Math.max(0, toolsInFlight - 1)
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
                    toolsInFlight = Math.max(0, toolsInFlight - 1)
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
                      const observation = await Snapshot.patch(snapshot)
                      if (observation.status === "failed") {
                        log.warn("snapshot patch observation failed", {
                          snapshot,
                          ...observation.failure,
                        })
                      } else if (observation.patch.files.length) {
                        await Session.updatePart({
                          id: Identifier.ascending("part"),
                          messageID: input.assistantMessage.id,
                          sessionID: input.sessionID,
                          type: "patch",
                          hash: observation.patch.hash,
                          files: observation.patch.files,
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
              clearTimeout(stallTimer)
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
            const retry = SessionRetry.retryable(error, attempt)
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
            const observation = await Snapshot.patch(snapshot)
            if (observation.status === "failed") {
              log.warn("snapshot patch observation failed", {
                snapshot,
                ...observation.failure,
              })
            } else if (observation.patch.files.length) {
              await Session.updatePart({
                id: Identifier.ascending("part"),
                messageID: input.assistantMessage.id,
                sessionID: input.sessionID,
                type: "patch",
                hash: observation.patch.hash,
                files: observation.patch.files,
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
