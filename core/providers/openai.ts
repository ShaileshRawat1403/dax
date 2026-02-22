import { createOpenAI as createOpenAISDK } from "@ai-sdk/openai";
import { streamText } from "ai";
import { Provider, StreamInput, StreamChunk } from "./types";

interface OpenAIProviderConfig {
  apiKey?: string;
  model?: string;
}

export function createOpenAI(config: OpenAIProviderConfig): Provider {
  const openai = createOpenAISDK({
    apiKey: config.apiKey,
  });

  return {
    id: "openai",
    sdk: openai, // Expose the underlying SDK
    async *stream({ prompt, context }: StreamInput): AsyncGenerator<StreamChunk> {
      // For now, we'll just use a simple system prompt.
      // Context from notes can be added later.
      const systemPrompt = "You are a helpful AI assistant.";

      try {
        const result = await streamText({
          model: openai(config.model || "gpt-4-turbo"),
          system: systemPrompt,
          prompt,
        });

        // Adapt the stream from the AI SDK to our internal format
        for await (const chunk of result.textStream) {
          yield { type: "text", delta: chunk };
        }
      } catch (error: any) {
        console.error("Error streaming from OpenAI:", error.message);
        yield { type: "error", error: error.message };
      }
    },
  };
}
