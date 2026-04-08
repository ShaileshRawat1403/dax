import type { ProviderAuthMethod } from "@dax-ai/sdk/v2"

type ProviderAuthMethodLike = Pick<ProviderAuthMethod, "label" | "description">

export type VisibleProviderAuthMethod<T extends ProviderAuthMethodLike> = {
  method: T
  originalIndex: number
  title: string
  description?: string
  hint?: string
}

export function hasAdvancedGoogleClient(env: NodeJS.ProcessEnv = process.env) {
  return !!env.DAX_GOOGLE_CLI_CLIENT_ID && !!env.DAX_GOOGLE_CLI_CLIENT_SECRET
}

export async function getVisibleProviderAuthMethods<T extends ProviderAuthMethodLike>(
  providerID: string,
  methods: T[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<VisibleProviderAuthMethod<T>[]> {
  if (isClaudeCodeProvider(providerID)) {
    return getClaudeCodeAuthMethods(methods, env)
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
  const cliImportIndex = methods.findIndex((method) => isGeminiCliImportLabel(method.label))
  const directSignInIndex = methods.findIndex((method) => looksLikeAdvancedGoogleSignIn(method.label))
  const customOauthIndex = methods.findIndex((method) => looksLikeCustomGoogleOauth(method.label))

  const visible: VisibleProviderAuthMethod<T>[] = []

  if (apiKeyIndex >= 0) {
    visible.push({
      method: methods[apiKeyIndex]!,
      originalIndex: apiKeyIndex,
      title: "Gemini API Key",
      description: "Use your API key from Google AI Studio.",
      hint: "Free tier or pay-as-you-go",
    })
  }

  if (cliImportIndex >= 0) {
    visible.push({
      method: methods[cliImportIndex]!,
      originalIndex: cliImportIndex,
      title: "Gemini CLI Session Import",
      description: "Reuse your local `gemini` CLI login for the Gemini subscription lane.",
      hint: "Imported from Gemini CLI",
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
      title: "Google OAuth Client Sign-In",
      description: usesConfiguredClient
        ? "Sign in in your browser using the Google OAuth client configured for DAX."
        : "Sign in in your browser with your own Google OAuth client credentials.",
      hint: usesConfiguredClient ? "Browser sign-in" : "Requires client ID and secret",
    })
  }

  return visible
}

function isGoogleLikeProvider(providerID: string) {
  return providerID.includes("google") || providerID.includes("gemini")
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
      title: "Claude API Key",
      description: "Use your API key from console.anthropic.com",
      hint: "API usage tracking",
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
      title: "Claude Pro/Max Sign-In",
      description: "Use Claude with your Anthropic Pro or Max subscription",
      hint: "Subscription access",
    })
  }

  return visible.length > 0
    ? visible
    : methods.map((m, i) => ({ method: m, originalIndex: i, title: m.label, description: m.description }))
}
