export type ProviderFailureCategory =
  | "auth_expired"
  | "auth_missing"
  | "rate_limited"
  | "model_unavailable"
  | "provider_unavailable"
  | "misconfigured"
  | "unknown"

export type ProviderLane =
  | "gemini-api"
  | "gemini-cli-import"
  | "google-oauth-client"
  | "vertex"
  | "anthropic-api"
  | "anthropic-subscription"
  | "openai-api"
  | "openai-chatgpt"
  | "copilot-oauth"

const laneLabels: Record<ProviderLane, string> = {
  "gemini-api": "Gemini API Key",
  "gemini-cli-import": "Gemini CLI Session Import",
  "google-oauth-client": "Google OAuth Client Sign-In",
  vertex: "Google Vertex ADC",
  "anthropic-api": "Claude API Key",
  "anthropic-subscription": "Claude Pro/Max Sign-In",
  "openai-api": "OpenAI API Key",
  "openai-chatgpt": "ChatGPT Plus/Pro Sign-In",
  "copilot-oauth": "GitHub Copilot Sign-In",
}

export function providerLaneLabel(lane?: ProviderLane) {
  return lane ? laneLabels[lane] : undefined
}

export function classifyProviderFailure(input: {
  errorName?: string
  message?: string
  providerID?: string
}): ProviderFailureCategory {
  const haystack = `${input.errorName ?? ""}\n${input.message ?? ""}\n${input.providerID ?? ""}`.toLowerCase()

  if (haystack.includes("providerauthoauthmissing") || haystack.includes("not authenticated")) return "auth_missing"
  if (
    haystack.includes("expired") ||
    haystack.includes("stale placeholder") ||
    haystack.includes("token_invalid") ||
    haystack.includes("oauth session is invalid")
  )
    return "auth_expired"
  if (haystack.includes("rate limit") || haystack.includes("rate_limit") || haystack.includes("429")) {
    return "rate_limited"
  }
  if (
    haystack.includes("model not found") ||
    haystack.includes("model unavailable") ||
    haystack.includes("unknown model")
  ) {
    return "model_unavailable"
  }
  if (
    haystack.includes("service unavailable") ||
    haystack.includes("provider unavailable") ||
    haystack.includes("temporarily unavailable") ||
    haystack.includes("connection reset") ||
    haystack.includes("econnreset") ||
    haystack.includes("enotfound")
  ) {
    return "provider_unavailable"
  }
  if (
    haystack.includes("scope_missing") ||
    haystack.includes("scope missing") ||
    haystack.includes("audience_mismatch") ||
    haystack.includes("audience does not match") ||
    haystack.includes("misconfigured") ||
    haystack.includes("requires google_cloud_project") ||
    haystack.includes("client id") ||
    haystack.includes("client secret") ||
    haystack.includes("adc not found") ||
    haystack.includes("oauth client")
  ) {
    return "misconfigured"
  }
  return "unknown"
}

export function providerFailureNextStep(input: {
  category: ProviderFailureCategory
  providerID: string
  lane?: ProviderLane
}) {
  const lane = providerLaneLabel(input.lane) ?? input.providerID
  switch (input.category) {
    case "auth_expired":
      if (input.lane === "gemini-cli-import") {
        return "Run `gemini`, finish login in the terminal, then retry `Gemini CLI Session Import`."
      }
      return `Reconnect ${lane} with \`dax auth login ${input.providerID}\` and retry.`
    case "auth_missing":
      if (input.lane === "gemini-cli-import") {
        return "Run `gemini`, finish login in the terminal, then retry `Gemini CLI Session Import`."
      }
      return `Authenticate ${lane} first with \`dax auth login ${input.providerID}\` or configure the required API key.`
    case "rate_limited":
      return `Wait for ${lane} rate limits to reset, then retry or switch to another configured lane.`
    case "model_unavailable":
      return `Choose a different model on ${lane} or verify that the selected model is available on this lane.`
    case "provider_unavailable":
      return `Retry ${lane} later and inspect provider status if the outage continues.`
    case "misconfigured":
      return `Review ${lane} configuration and required environment/auth settings, then retry.`
    case "unknown":
      return `Inspect ${lane} auth details with \`dax doctor auth --json\` and retry once the provider state is clearer.`
  }
}

export function describeProviderFailure(input: {
  providerID: string
  lane?: ProviderLane
  errorName?: string
  message?: string
}) {
  const category = classifyProviderFailure(input)
  return {
    category,
    laneLabel: providerLaneLabel(input.lane) ?? input.providerID,
    nextStep: providerFailureNextStep({
      category,
      providerID: input.providerID,
      lane: input.lane,
    }),
  }
}

