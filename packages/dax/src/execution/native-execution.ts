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
   */
  export async function runSingleShot(input: SessionPrompt.PromptInput): Promise<SingleShotResult> {
    const message = await SessionPrompt.prompt({
      ...input,
      // This boundary owns adjudication below. Keep SessionPrompt itself in
      // conversational mode so one provider stop produces exactly one
      // completion decision rather than terminalizing twice.
      completionPolicy: "explicit",
    })

    const messages = await MessageV2.filterCompacted(MessageV2.stream(input.sessionID))
    const lastAssistant = [...messages].reverse().find((m) => m.info.role === "assistant")
    const completion = lastAssistant
      ? await adjudicateNativeCompletionCandidate({
          sessionID: input.sessionID,
          assistantMessageID: lastAssistant.info.id,
          finishReason: (lastAssistant.info as MessageV2.Assistant).finish ?? "stop",
          hasError: Boolean((lastAssistant.info as MessageV2.Assistant).error),
        })
      : {
          candidate: false,
          accepted: false,
          runId: input.sessionID,
          reasonCodes: ["no_assistant_message"],
        }

    return { message, completion }
  }
}
