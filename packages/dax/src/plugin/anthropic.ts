import type { Hooks } from "@dax-ai/plugin"

/** Native Anthropic chat uses API keys; subscription CLI auth stays with Claude Code. */
export async function AnthropicAuthPlugin(): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      async loader(getAuth) {
        const info = await getAuth()
        return info?.type === "api" ? { apiKey: info.key } : {}
      },
      methods: [
        {
          type: "api",
          label: "API Key",
          description: "Enter an API key from console.anthropic.com.",
          prompts: [
            {
              key: "key",
              type: "text",
              message: "Enter your Anthropic API Key",
              validate: (x: string) => (x?.length > 0 ? undefined : "Required"),
            },
          ],
          async authorize(inputs) {
            return { type: "success", key: inputs!.key }
          },
        },
      ],
    },
  }
}
