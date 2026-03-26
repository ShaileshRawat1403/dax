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

export function getVisibleProviderAuthMethods<T extends ProviderAuthMethodLike>(
  providerID: string,
  methods: T[],
  env: NodeJS.ProcessEnv = process.env,
): VisibleProviderAuthMethod<T>[] {
  return methods.flatMap((method, originalIndex) => {
    const visible = describeProviderAuthMethod(providerID, method, env)
    if (!visible) return []
    return [
      {
        method,
        originalIndex,
        ...visible,
      },
    ]
  })
}

function describeProviderAuthMethod(
  providerID: string,
  method: ProviderAuthMethodLike,
  env: NodeJS.ProcessEnv,
): Omit<VisibleProviderAuthMethod<ProviderAuthMethodLike>, "method" | "originalIndex"> | null {
  let title = method.label
  let description = method.description
  let hint: string | undefined

  if (isGoogleLikeProvider(providerID)) {
    if (title.includes("Gemini API") || title.includes("API key")) {
      title = "Gemini API Key"
      hint = "Get a free API key"
    } else if (title.includes("Gemini CLI") || title.includes("CLI")) {
      title = "Import from Gemini CLI"
      hint = "Use local credentials (recommended)"
    } else if (looksLikeAdvancedGoogleSignIn(title)) {
      if (!hasAdvancedGoogleClient(env)) return null
      title = "Advanced Google Sign-In"
      hint = "Requires configured client ID and secret"
    } else if (title.toLowerCase().includes("oauth")) {
      title = "Custom Google OAuth Client"
      hint = "Use your own OAuth credentials"
    }
  }

  return {
    title,
    description,
    hint,
  }
}

function isGoogleLikeProvider(providerID: string) {
  return providerID.includes("google") || providerID.includes("gemini")
}

function looksLikeAdvancedGoogleSignIn(label: string) {
  return /sign[\s-]?in/i.test(label)
}
