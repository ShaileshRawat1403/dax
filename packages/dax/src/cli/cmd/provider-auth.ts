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

  // When the operator has configured a custom Google OAuth client via env vars,
  // prefer the direct sign-in method. Fall back to CLI import otherwise.
  const useDirectSignIn = hasAdvancedGoogleClient(env) && directSignInIndex >= 0
  const subscriptionIndex = useDirectSignIn ? directSignInIndex : cliImportIndex
  if (subscriptionIndex >= 0) {
    visible.push({
      method: methods[subscriptionIndex]!,
      originalIndex: subscriptionIndex,
      title: "Gemini Subscription Sign-In",
      description: useDirectSignIn
        ? "Sign in directly with your Google account using your OAuth client."
        : "Use your Gemini Pro or Plus subscription from the terminal.",
      hint: useDirectSignIn ? "Browser-based login (Pro/Plus)" : "Import from Gemini CLI",
    })
  }

  if (customOauthIndex >= 0) {
    visible.push({
      method: methods[customOauthIndex]!,
      originalIndex: customOauthIndex,
      title: "Custom Google OAuth Client",
      description: "Sign in with your own Google OAuth app credentials.",
      hint: "Advanced or enterprise setup",
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
      m.label.toLowerCase().includes("plus") ||
      m.label.toLowerCase().includes("sign-in"),
  )
  if (oauthIndex >= 0) {
    visible.push({
      method: methods[oauthIndex]!,
      originalIndex: oauthIndex,
      title: "Claude Pro/Plus Sign-In",
      description: "Use Claude with your Anthropic Pro or Plus subscription",
      hint: "Subscription access",
    })
  }

  return visible.length > 0
    ? visible
    : methods.map((m, i) => ({ method: m, originalIndex: i, title: m.label, description: m.description }))
}
