import { Auth } from "@/auth"

type EnvLike = Record<string, string | undefined>

export function hasGeminiApiKeyEnv(env: EnvLike = Bun.env) {
  return Boolean(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY)
}

export function isGeminiSubscriptionLane(input: {
  providerID: string
  auth?: Auth.Info
  env?: EnvLike
}) {
  if (input.providerID !== "google") return false
  if (hasGeminiApiKeyEnv(input.env)) return false
  return input.auth?.type === "oauth" && (input.auth.mode === "cli-import" || input.auth.mode === "codeassist")
}

export async function shouldSkipDecorativeGeminiSubscriptionCall(providerID: string) {
  const auth = await Auth.get("google")
  return isGeminiSubscriptionLane({
    providerID,
    auth,
  })
}
