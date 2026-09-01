import type { ProviderAuthMethod } from "@dax-ai/sdk/v2"
import { providerLaneLabel, type ProviderLane } from "@/provider/diagnostics"

type ProviderAuthMethodLike = Pick<ProviderAuthMethod, "label" | "description">

export type VisibleProviderAuthMethod<T extends ProviderAuthMethodLike> = {
  method: T
  originalIndex: number
  title: string
  description?: string
  hint?: string
  lane?: ProviderLane
}

export function hasAdvancedGoogleClient(env: NodeJS.ProcessEnv = process.env) {
  return !!env.DAX_GOOGLE_CLI_CLIENT_ID && !!env.DAX_GOOGLE_CLI_CLIENT_SECRET
}

export function legacyGeminiCliImportEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.DAX_ENABLE_LEGACY_GEMINI_CLI_IMPORT === "1"
}

export async function getVisibleProviderAuthMethods<T extends ProviderAuthMethodLike>(
  providerID: string,
  methods: T[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<VisibleProviderAuthMethod<T>[]> {
  if (isClaudeCodeProvider(providerID)) {
    return getClaudeCodeAuthMethods(methods, env)
  }

  if (isOpenAIProvider(providerID)) {
    return getOpenAIAuthMethods(methods)
  }

  if (!isGoogleLikeProvider(providerID)) {
    return methods.map((method, originalIndex) => ({
      method,
      originalIndex,
      title: method.label,
      description: method.description,
    }))
  }

  const apiKeyIndex = methods.findIndex((method) => isGoogleApiKeyLabel(method.label))
  const cliImportIndex = methods.findIndex(
    (method) => isGeminiCliImportLabel(method.label) && !isAntigravityImportLabel(method.label),
  )
  const directSignInIndex = methods.findIndex((method) => looksLikeAdvancedGoogleSignIn(method.label))
  const customOauthIndex = methods.findIndex((method) => looksLikeCustomGoogleOauth(method.label))

  const visible: VisibleProviderAuthMethod<T>[] = []

  if (apiKeyIndex >= 0) {
    visible.push({
      method: methods[apiKeyIndex]!,
      originalIndex: apiKeyIndex,
      title: providerLaneLabel("gemini-api")!,
      description: "Use your API key from Google AI Studio.",
      hint: "Free tier or pay-as-you-go",
      lane: "gemini-api",
    })
  }

  if (cliImportIndex >= 0 && legacyGeminiCliImportEnabled(env)) {
    visible.push({
      method: methods[cliImportIndex]!,
      originalIndex: cliImportIndex,
      title: providerLaneLabel("gemini-cli-import")!,
      description: "Legacy enterprise/Google Cloud Gemini CLI import.",
      hint: "Enterprise legacy opt-in",
      lane: "gemini-cli-import",
    })
  }

  const oauthSignInIndex =
    hasAdvancedGoogleClient(env) && directSignInIndex >= 0
      ? directSignInIndex
      : customOauthIndex >= 0
        ? customOauthIndex
        : directSignInIndex

  if (oauthSignInIndex >= 0) {
    const usesConfiguredClient = oauthSignInIndex === directSignInIndex
    visible.push({
      method: methods[oauthSignInIndex]!,
      originalIndex: oauthSignInIndex,
      title: providerLaneLabel("google-oauth-client")!,
      description: usesConfiguredClient
        ? "Sign in in your browser using the Google OAuth client configured for DAX."
        : "Sign in in your browser with your own Google OAuth client credentials.",
      hint: usesConfiguredClient ? "Browser sign-in" : "Requires client ID and secret",
      lane: "google-oauth-client",
    })
  }

  return visible
}

function isGoogleLikeProvider(providerID: string) {
  return providerID.includes("google") || providerID.includes("gemini")
}

function isAntigravityImportLabel(label: string) {
  return label.toLowerCase().includes("antigravity")
}

function isGoogleApiKeyLabel(label: string) {
  return label.includes("Gemini API") || label.includes("API key")
}

function isGeminiCliImportLabel(label: string) {
  return label.includes("Gemini CLI") || label.includes("CLI")
}

function looksLikeAdvancedGoogleSignIn(label: string) {
  return /sign[\s-]?in/i.test(label)
}

function looksLikeCustomGoogleOauth(label: string) {
  return label.toLowerCase().includes("oauth")
}

function isClaudeCodeProvider(providerID: string): boolean {
  return providerID === "claude-code" || providerID === "anthropic"
}

function isOpenAIProvider(providerID: string): boolean {
  return providerID === "openai"
}

function getClaudeCodeAuthMethods<T extends ProviderAuthMethodLike>(
  methods: T[],
  env: NodeJS.ProcessEnv = process.env,
): VisibleProviderAuthMethod<T>[] {
  const visible: VisibleProviderAuthMethod<T>[] = []

  const apiKeyIndex = methods.findIndex((m) => m.label.toLowerCase().includes("api key"))
  if (apiKeyIndex >= 0) {
    visible.push({
      method: methods[apiKeyIndex]!,
      originalIndex: apiKeyIndex,
      title: providerLaneLabel("anthropic-api")!,
      description: "Use your API key from console.anthropic.com",
      hint: "API usage tracking",
      lane: "anthropic-api",
    })
  }

  const oauthIndex = methods.findIndex(
    (m) =>
      m.label.toLowerCase().includes("pro") ||
      m.label.toLowerCase().includes("max") ||
      m.label.toLowerCase().includes("plus") ||
      m.label.toLowerCase().includes("sign-in"),
  )
  if (oauthIndex >= 0) {
    visible.push({
      method: methods[oauthIndex]!,
      originalIndex: oauthIndex,
      title: providerLaneLabel("anthropic-subscription")!,
      description: "Use Claude with your Anthropic Pro or Max subscription",
      hint: "Subscription access",
      lane: "anthropic-subscription",
    })
  }

  return visible.length > 0
    ? visible
    : methods.map((m, i) => ({ method: m, originalIndex: i, title: m.label, description: m.description }))
}

function getOpenAIAuthMethods<T extends ProviderAuthMethodLike>(methods: T[]): VisibleProviderAuthMethod<T>[] {
  return methods.map((method, originalIndex) => {
    const label = method.label.toLowerCase()
    if (label.includes("api key")) {
      return {
        method,
        originalIndex,
        title: providerLaneLabel("openai-api")!,
        description: "Use your OpenAI API key.",
        hint: "API usage tracking",
        lane: "openai-api" as const,
      }
    }
    if (label.includes("chatgpt") || label.includes("plus") || label.includes("pro")) {
      return {
        method,
        originalIndex,
        title: label.includes("headless")
          ? `${providerLaneLabel("openai-chatgpt")} (headless)`
          : label.includes("browser")
            ? `${providerLaneLabel("openai-chatgpt")} (browser)`
            : providerLaneLabel("openai-chatgpt")!,
        description: method.description,
        hint: "Subscription access",
        lane: "openai-chatgpt" as const,
      }
    }
    return {
      method,
      originalIndex,
      title: method.label,
      description: method.description,
    }
  })
}
