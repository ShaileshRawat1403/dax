import { Provider, StreamInput } from "./types";

/**
 * A fallback provider for testing and clean-room environments.
 */
export function createProvider(id?: string): Provider {
  return {
    id: id || "stub",
    async *stream({ prompt }: StreamInput) {
      yield { type: "thinking", delta: "Analyzing request..." };
      yield {
        type: "text",
        delta:
          `I am the DAX stub provider. I received your prompt: "${prompt}".\n\n` +
          `To perform real actions, configure a provider in .dax/config.json and provide a JSON plan like:\n` +
          '```json\n[{"permission": "tool.read", "params": {"path": "README.md"}}]\n```',
      };
    },
  };
}
