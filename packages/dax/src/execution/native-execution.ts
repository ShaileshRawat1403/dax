import { SessionPrompt } from "@/session/prompt"
import { adjudicateNativeCompletionCandidate, type NativeCompletionDecision } from "./native-completion"
import { MessageV2 } from "@/session/message-v2"

// The repository's execution APIs use namespace modules consistently.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace NativeExecution {
  export type SingleShotResult = {
    message: MessageV2.WithParts
    completion: NativeCompletionDecision
  }

  /**
   * Executes a single-shot native governed task.
   *
   * Unlike generic conversational prompts (which preserve the active running
   * state across user turns), single-shot native execution specifically owns
   * completion adjudication and terminalization upon provider stop.
   *
   * Adjudication runs against the exact assistant result this invocation
   * produced. It used to re-read the compacted session history and adjudicate
   * whichever assistant happened to be newest, which is a different message
   * whenever compaction or summarization interleaved with the turn — so the
   * decision could be made about work this call never did.
   */
  export async function runSingleShot(input: SessionPrompt.PromptInput): Promise<SingleShotResult> {
    const message = await SessionPrompt.prompt({
      ...input,
      // This boundary owns adjudication below. Keep SessionPrompt itself in
      // conversational mode so one provider stop produces exactly one
      // completion decision rather than terminalizing twice.
      completionPolicy: "explicit",
    })

    if (message.info.role !== "assistant") {
      return {
        message,
        completion: {
          candidate: false,
          accepted: false,
          runId: input.sessionID,
          reasonCodes: [`non_assistant_result:${message.info.role}`],
        },
      }
    }

    const assistant = message.info as MessageV2.Assistant
    return {
      message,
      // A missing finish reason is not a provider stop. Defaulting it to "stop"
      // turned "the provider never told us how this ended" into a completion
      // candidate; adjudication fails it closed as `finish_reason:missing`.
      completion: await adjudicateNativeCompletionCandidate({
        sessionID: input.sessionID,
        assistantMessageID: assistant.id,
        finishReason: assistant.finish,
        hasError: Boolean(assistant.error),
      }),
    }
  }
}
