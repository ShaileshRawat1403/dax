import type { Hooks, PluginInput, Plugin as PluginInstance } from "@dax-ai/plugin"

export async function AnthropicAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      async loader(getAuth) {
        const info = await getAuth()
        if (!info) return {}

        if (info.type === "api") {
          return { apiKey: info.key }
        }

        return {}
      },
      methods: [
        {
          type: "api",
          label: "Claude API Key",
          description: "Use your API key from console.anthropic.com. Best for API usage tracking.",
          prompts: [
            {
              key: "key",
              type: "text",
              message: "Enter your Claude API Key",
              validate: (x: string) => (x && x.length > 0 ? undefined : "Required"),
            },
          ],
          async authorize(inputs: { key: string }) {
            return {
              type: "success" as const,
              key: inputs.key,
            }
          },
        },
      ],
    },
  }
}
