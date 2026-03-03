import { Auth } from "@/auth"
import { Env } from "@/env"

const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"
const GOOGLE_SCOPE_CLOUD = "https://www.googleapis.com/auth/cloud-platform"
const GOOGLE_SCOPE_GENERATIVE = "https://www.googleapis.com/auth/generative-language.retriever"
const GEMINI_CLI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"

export class ProviderAuthPreflightError extends Error {
  constructor(
    public readonly providerID: string,
    message: string,
  ) {
    super(message)
    this.name = "ProviderAuthPreflightError"
  }
}

export type AuthDiagnostics = {
  providerID: string
  mode: "gemini-api-key" | "gemini-oauth" | "vertex-adc" | "missing"
  ok: boolean
  requiredEnv: string[]
  missingEnv: string[]
  details: string[]
  error?: string
}

type GoogleTokenInfo = {
  aud?: string
  azp?: string
  scope?: string
  expires_in?: string
}

type GoogleTokenHealth =
  | {
      ok: false
      reason: "token_invalid" | "scope_missing" | "audience_mismatch" | "token_expired"
      message: string
    }
  | {
      ok: true
      details: string[]
    }

const tokenHealthCache = new Map<string, { checkedAt: number; result: GoogleTokenHealth }>()
const TOKEN_HEALTH_TTL_MS = 60_000

function env(key: string) {
  return Env.get(key) ?? process.env[key] ?? Bun.env[key]
}

function effectiveGoogleOAuthClientID() {
  const custom = Auth.get("google")
  return custom.then((auth) => {
    if (auth?.type === "oauth-custom" && auth.clientID) {
      return { value: auth.clientID, source: "auth(oauth-custom)" as const }
    }
    const daxEnv = env("DAX_GEMINI_OAUTH_CLIENT_ID")
    if (daxEnv) return { value: daxEnv, source: "env(DAX_GEMINI_OAUTH_CLIENT_ID)" as const }
    const geminiEnv = env("GEMINI_OAUTH_CLIENT_ID")
    if (geminiEnv) return { value: geminiEnv, source: "env(GEMINI_OAUTH_CLIENT_ID)" as const }
    const googleEnv = env("GOOGLE_OAUTH_CLIENT_ID")
    if (googleEnv) return { value: googleEnv, source: "env(GOOGLE_OAUTH_CLIENT_ID)" as const }
    return { value: GEMINI_CLI_CLIENT_ID, source: "default" as const }
  })
}

function hasScope(scopeString: string, scope: string) {
  return scopeString.split(/\s+/).includes(scope)
}

async function validateGoogleOAuthAccessToken(token: string) {
  const cached = tokenHealthCache.get(token)
  if (cached && Date.now() - cached.checkedAt < TOKEN_HEALTH_TTL_MS) {
    return cached.result
  }

  const url = new URL(GOOGLE_TOKEN_INFO_URL)
  url.searchParams.set("access_token", token)
  const result = await fetch(url).catch(() => undefined)
  if (!result?.ok) {
    const health: GoogleTokenHealth = {
      ok: false as const,
      reason: "token_invalid",
      message:
        "Google OAuth access token is invalid or expired for Gemini API. Re-run `dax auth login`, choose Google, and use 'Sign in with Google (email)' or switch to GEMINI_API_KEY.",
    }
    tokenHealthCache.set(token, { checkedAt: Date.now(), result: health })
    return health
  }

  const info = (await result.json().catch(() => ({}))) as GoogleTokenInfo
  const scopeString = info.scope ?? ""
  const hasGeminiScope = hasScope(scopeString, GOOGLE_SCOPE_GENERATIVE)
  const hasCloudScope = hasScope(scopeString, GOOGLE_SCOPE_CLOUD)
  if (!hasGeminiScope && !hasCloudScope) {
    const health: GoogleTokenHealth = {
      ok: false as const,
      reason: "scope_missing",
      message:
        "Google OAuth token is missing Gemini scope. Add `https://www.googleapis.com/auth/generative-language.retriever` (or cloud-platform compatibility scope) and re-authenticate.",
    }
    tokenHealthCache.set(token, { checkedAt: Date.now(), result: health })
    return health
  }

  const expectedAudience =
    env("DAX_GEMINI_OAUTH_CLIENT_ID") ?? env("GEMINI_OAUTH_CLIENT_ID") ?? env("GOOGLE_OAUTH_CLIENT_ID")
  if (expectedAudience) {
    const audience = info.aud ?? info.azp
    if (audience && audience !== expectedAudience) {
      const health: GoogleTokenHealth = {
        ok: false as const,
        reason: "audience_mismatch",
        message:
          "Google OAuth token audience does not match configured Gemini OAuth client id. Re-authenticate with the same OAuth client configured in DAX.",
      }
      tokenHealthCache.set(token, { checkedAt: Date.now(), result: health })
      return health
    }
  }

  const expires = Number(info.expires_in ?? "0")
  if (Number.isFinite(expires) && expires <= 0) {
    const health: GoogleTokenHealth = {
      ok: false as const,
      reason: "token_expired",
      message: "Google OAuth access token is expired. Re-authenticate or use GEMINI_API_KEY.",
    }
    tokenHealthCache.set(token, { checkedAt: Date.now(), result: health })
    return health
  }

  const health: GoogleTokenHealth = {
    ok: true as const,
    details: [
      hasGeminiScope
        ? "OAuth scope check: Gemini scope present."
        : "OAuth scope check: cloud-platform compatibility scope present.",
      expectedAudience
        ? "OAuth audience check: matched configured Gemini OAuth client id."
        : "OAuth audience check: no explicit client id configured; skipping strict audience match.",
    ],
  }
  tokenHealthCache.set(token, { checkedAt: Date.now(), result: health })
  return health
}

async function hasReadableFile(path: string | undefined) {
  if (!path) return false
  return Bun.file(path).exists()
}

function adcPaths() {
  const home = env("HOME") ?? Bun.env.HOME ?? ""
  const explicit = env("GOOGLE_APPLICATION_CREDENTIALS")
  const defaultPath = `${home}/.config/gcloud/application_default_credentials.json`
  return { explicit, defaultPath }
}

async function diagnoseGoogleProvider(providerID: string): Promise<AuthDiagnostics> {
  const auth = await Auth.get("google")
  const effectiveClient = await effectiveGoogleOAuthClientID()
  const apiKey = env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY")
  const project = env("GOOGLE_CLOUD_PROJECT") ?? env("GCP_PROJECT") ?? env("GCLOUD_PROJECT")

  if (apiKey) {
    return {
      providerID,
      mode: "gemini-api-key",
      ok: true,
      requiredEnv: ["GEMINI_API_KEY (or GOOGLE_API_KEY)"],
      missingEnv: [],
      details: [
        "Using Gemini API key mode.",
        `OAuth client id in use: ${effectiveClient.value} (${effectiveClient.source})`,
        project
          ? "GOOGLE_CLOUD_PROJECT is also set. Keep Google models on `google/*`; use `google-vertex/*` only when using ADC."
          : "No Vertex project env detected.",
      ],
    }
  }

  if (auth?.type === "oauth") {
    const token = await validateGoogleOAuthAccessToken(auth.access)
    const details = token.ok
      ? [...token.details, `OAuth client id in use: ${effectiveClient.value} (${effectiveClient.source})`]
      : [`OAuth client id in use: ${effectiveClient.value} (${effectiveClient.source})`]
    return {
      providerID,
      mode: "gemini-oauth",
      ok: token.ok,
      requiredEnv: ["None required for OAuth token mode"],
      missingEnv: [],
      details,
      error: token.ok ? undefined : token.message,
    }
  }

  return {
    providerID,
    mode: "missing",
    ok: false,
    requiredEnv: ["GEMINI_API_KEY (or GOOGLE_API_KEY)"],
    missingEnv: ["GEMINI_API_KEY/GOOGLE_API_KEY or google OAuth login"],
    details: [`OAuth client id in use: ${effectiveClient.value} (${effectiveClient.source})`],
    error:
      "Google provider requires Gemini API key or Google OAuth token. Run `dax auth login` for provider `google`, or set GEMINI_API_KEY.",
  }
}

async function diagnoseVertexProvider(providerID: string): Promise<AuthDiagnostics> {
  const project = env("GOOGLE_CLOUD_PROJECT") ?? env("GCP_PROJECT") ?? env("GCLOUD_PROJECT")
  const { explicit, defaultPath } = adcPaths()
  const explicitReadable = await hasReadableFile(explicit)
  const defaultReadable = await hasReadableFile(defaultPath)
  const hasAdc = explicitReadable || defaultReadable

  const missingEnv = []
  if (!project) missingEnv.push("GOOGLE_CLOUD_PROJECT (or GCP_PROJECT / GCLOUD_PROJECT)")

  if (explicit && !explicitReadable) {
    missingEnv.push(`GOOGLE_APPLICATION_CREDENTIALS file not found at ${explicit}`)
  } else if (!explicit && !defaultReadable) {
    missingEnv.push("ADC not found. Run `gcloud auth application-default login` or set GOOGLE_APPLICATION_CREDENTIALS.")
  }

  const ok = Boolean(project) && hasAdc
  return {
    providerID,
    mode: ok ? "vertex-adc" : "missing",
    ok,
    requiredEnv: ["GOOGLE_CLOUD_PROJECT", "ADC (GOOGLE_APPLICATION_CREDENTIALS or gcloud application-default login)"],
    missingEnv,
    details: [
      project ? `Project detected: ${project}` : "Project not configured.",
      explicit
        ? explicitReadable
          ? `ADC path detected: ${explicit}`
          : `ADC path unreadable: ${explicit}`
        : defaultReadable
          ? `ADC path detected: ${defaultPath}`
          : "No ADC file found in default gcloud location.",
    ],
    error: ok
      ? undefined
      : "Vertex provider requires GOOGLE_CLOUD_PROJECT plus ADC. For Gemini API OAuth/API key, use `google/*` models instead.",
  }
}

export async function diagnoseProviderAuth(providerID: string): Promise<AuthDiagnostics> {
  if (providerID === "google") return diagnoseGoogleProvider(providerID)
  if (providerID === "google-vertex" || providerID === "google-vertex-anthropic") {
    return diagnoseVertexProvider(providerID)
  }
  return {
    providerID,
    mode: "missing",
    ok: true,
    requiredEnv: [],
    missingEnv: [],
    details: ["No provider-specific auth preflight rules for this provider."],
  }
}

export async function assertProviderAuth(providerID: string) {
  if (providerID !== "google" && providerID !== "google-vertex" && providerID !== "google-vertex-anthropic") return
  const report = await diagnoseProviderAuth(providerID)
  if (!report.ok) {
    throw new ProviderAuthPreflightError(providerID, report.error ?? "Provider auth preflight failed.")
  }

  // Additional split guard: reject obvious mode mismatch intent.
  if (providerID === "google") {
    const project = env("GOOGLE_CLOUD_PROJECT") ?? env("GCP_PROJECT") ?? env("GCLOUD_PROJECT")
    const hasGeminiKey = Boolean(env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY"))
    const hasOAuth = (await Auth.get("google"))?.type === "oauth"
    if (project && !hasGeminiKey && !hasOAuth) {
      throw new ProviderAuthPreflightError(
        providerID,
        "Google model selected but only Vertex project env is configured. Use `google-vertex/*` with ADC, or configure GEMINI_API_KEY / Google OAuth for `google/*`.",
      )
    }
  }
}

export function expectedGoogleOauthClientIds() {
  return [
    env("DAX_GEMINI_OAUTH_CLIENT_ID"),
    env("GEMINI_OAUTH_CLIENT_ID"),
    env("GOOGLE_OAUTH_CLIENT_ID"),
    GEMINI_CLI_CLIENT_ID,
  ].filter(Boolean) as string[]
}
