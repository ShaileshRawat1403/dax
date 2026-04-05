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

  const subscriptionIndex = await resolveGoogleSubscriptionIndex({
    cliImportIndex,
    directSignInIndex,
    env,
  })
  if (subscriptionIndex != null) {
    visible.push({
      method: methods[subscriptionIndex]!,
      originalIndex: subscriptionIndex,
      title: "Gemini Subscription Sign-In",
      description: "Use Gemini Pro or Plus through your Gemini CLI session or direct subscription sign-in.",
      hint:
        subscriptionIndex === cliImportIndex
          ? "Uses your local Gemini CLI session"
          : "Uses direct subscription sign-in",
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

async function resolveGoogleSubscriptionIndex(input: {
  cliImportIndex: number
  directSignInIndex: number
  env: NodeJS.ProcessEnv
}) {
  if (await hasGeminiCliSession(input.env)) {
    if (input.cliImportIndex >= 0) return input.cliImportIndex
  }

  if (hasAdvancedGoogleClient(input.env)) {
    if (input.directSignInIndex >= 0) return input.directSignInIndex
  }

  if (input.cliImportIndex >= 0) return input.cliImportIndex
  if (input.directSignInIndex >= 0) return input.directSignInIndex
  return undefined
}

async function hasGeminiCliSession(env: NodeJS.ProcessEnv) {
  for (const item of geminiCredPaths(env)) {
    const creds = await Bun.file(item)
      .json()
      .then((value) => value as { access_token?: string; refresh_token?: string })
      .catch(() => undefined)
    if (creds?.access_token || creds?.refresh_token) return true
  }
  return false
}

function geminiCredPaths(env: NodeJS.ProcessEnv) {
  const home = env.HOME ?? Bun.env.HOME ?? ""
  return [
    env.GEMINI_OAUTH_CREDS_PATH,
    `${home}/.gemini/oauth_creds.json`,
    `${home}/.config/gemini/oauth_creds.json`,
    `${home}/.config/google-gemini/oauth_creds.json`,
  ].filter(Boolean) as string[]
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

  const subscriptionIndex = methods.findIndex(
    (m) =>
      m.label.toLowerCase().includes("pro") ||
      m.label.toLowerCase().includes("plus") ||
      m.label.toLowerCase().includes("subscription"),
  )
  if (subscriptionIndex >= 0) {
    visible.push({
      method: methods[subscriptionIndex]!,
      originalIndex: subscriptionIndex,
      title: "Claude Pro/Plus Subscription",
      description: "Sign in with your Anthropic subscription for Pro or Plus access",
      hint: "Requires OAuth credentials",
    })
  }

  return visible.length > 0
    ? visible
    : methods.map((m, i) => ({ method: m, originalIndex: i, title: m.label, description: m.description }))
}
