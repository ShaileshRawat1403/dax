import { Provider, StreamInput, StreamChunk } from "./types";

/**
 * Wraps a provider to track execution time and estimated token usage.
 */
export function withMetrics(provider: Provider): Provider {
  return {
    ...provider,
    async *stream(input: StreamInput): AsyncGenerator<StreamChunk> {
      const start = Date.now();
      let charCount = 0;

      for await (const chunk of provider.stream(input)) {
        if (chunk.type === "text") {
          charCount += chunk.delta.length;
        }
        yield chunk;
      }

      yield {
        type: "metrics",
        data: {
          provider: provider.id,
          ms: Date.now() - start,
          // Rough estimate: 4 chars per token
          tokens: Math.round(charCount / 4),
        },
      };
    },
  };
}
