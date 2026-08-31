import { Auth } from "@/auth"
import { Env } from "@/env"
import {
  classifyProviderFailure,
  providerFailureNextStep,
  providerLaneLabel,
  type ProviderFailureCategory,
  type ProviderLane,
} from "@/provider/diagnostics"

const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"
const GOOGLE_SCOPE_CLOUD = "https://www.googleapis.com/auth/cloud-platform"
const GOOGLE_SCOPE_GENERATIVE_QUOTA = "https://www.googleapis.com/auth/generative-language.peruserquota"
const GOOGLE_SCOPE_GENERATIVE_RETRIEVER = "https://www.googleapis.com/auth/generative-language.retriever.readonly"
const getGeminiCliClientId = () => Bun.env.DAX_GOOGLE_CLI_CLIENT_ID ?? Bun.env.GEMINI_OAUTH_CLIENT_ID

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
  mode:
    | "gemini-api-key"
    | "gemini-oauth"
    | "cli-import"
    | "codeassist"
    | "custom-oauth"
    | "openai-api"
    | "openai-oauth"
    | "copilot-oauth"
    | "vertex-adc"
    | "missing"
    | "anthropic-api"
    | "anthropic-oauth"
  lane?: ProviderLane
  laneLabel?: string
  source?: "api-key" | "stored-oauth" | "cli-import" | "adc" | "env"
  endpoint?: "generativelanguage" | "cloudcode-pa" | "vertex"
  ok: boolean
  requiredEnv: string[]
  missingEnv: string[]
  details: string[]
  error?: string
  failureCategory?: ProviderFailureCategory
  next?: string[]
}

type GoogleTokenInfo = {
  aud?: string
  azp?: string
  scope?: string
  expires_in?: string
  email?: string
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

function formatRelativeMs(ms: number) {
  const abs = Math.abs(ms)
  const minutes = Math.floor(abs / 60_000)
  const hours = Math.floor(abs / 3_600_000)
  const days = Math.floor(abs / 86_400_000)
  if (days >= 1) return `${days}d`
  if (hours >= 1) return `${hours}h`
  if (minutes >= 1) return `${minutes}m`
  return `${Math.max(0, Math.floor(abs / 1000))}s`
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
    return { value: getGeminiCliClientId(), source: "env" as const }
  })
}

function hasScope(scopeString: string, scope: string) {
  return scopeString.split(/\s+/).includes(scope)
}

type GeminiCliCreds = {
  access_token?: string
  refresh_token?: string
}

function geminiCliCredPaths() {
  const home = env("HOME") ?? Bun.env.HOME ?? ""
  return [
    env("GEMINI_OAUTH_CREDS_PATH"),
    `${home}/.gemini/oauth_creds.json`,
    `${home}/.config/gemini/oauth_creds.json`,
    `${home}/.config/google-gemini/oauth_creds.json`,
  ].filter(Boolean) as string[]
}

async function readGeminiCliCreds() {
  for (const filepath of geminiCliCredPaths()) {
    const creds = await Bun.file(filepath)
      .json()
      .then((value) => value as GeminiCliCreds)
      .catch(() => undefined)
    if (!creds?.access_token && !creds?.refresh_token) continue
    return {
      access: creds.access_token,
      refresh: creds.refresh_token,
      source: filepath,
    }
  }
  return undefined
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
        "Google OAuth access token is invalid or expired for Gemini. Re-run `dax auth login` with a supported Google OAuth configuration, switch to `GEMINI_API_KEY`, or use a governed Antigravity worker for individual CLI subscription access.",
    }
    tokenHealthCache.set(token, { checkedAt: Date.now(), result: health })
    return health
  }

  const info = (await result.json().catch(() => ({}))) as GoogleTokenInfo
  const scopeString = info.scope ?? ""
  const hasGeminiScope =
    hasScope(scopeString, GOOGLE_SCOPE_GENERATIVE_QUOTA) || hasScope(scopeString, GOOGLE_SCOPE_GENERATIVE_RETRIEVER)
  const hasCloudScope = hasScope(scopeString, GOOGLE_SCOPE_CLOUD)
  if (!hasGeminiScope && !hasCloudScope) {
    const health: GoogleTokenHealth = {
      ok: false as const,
      reason: "scope_missing",
      message:
        "Google OAuth token is missing Gemini scope. Add `https://www.googleapis.com/auth/generative-language.peruserquota` and `https://www.googleapis.com/auth/generative-language.retriever.readonly` (or cloud-platform compatibility scope) and re-authenticate.",
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
      message:
        "Google OAuth access token is expired. Re-authenticate with a supported Google OAuth configuration, use `GEMINI_API_KEY`, or use a governed Antigravity worker for individual CLI subscription access.",
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
  const cliCreds = await readGeminiCliCreds()
  const effectiveClient = await effectiveGoogleOAuthClientID()
  const apiKey = env("GEMINI_API_KEY") ?? env("GOOGLE_API_KEY")
  const project = env("GOOGLE_CLOUD_PROJECT") ?? env("GCP_PROJECT") ?? env("GCLOUD_PROJECT")

  const hasValidOAuth = async () => {
    if (auth?.type === "oauth") {
      const mode = (auth.mode as any) ?? (cliCreds?.refresh ? "cli-import" : "gemini-oauth")
      const accessToken = mode === "cli-import" ? (cliCreds?.access ?? auth.access) : auth.access
      const token = await validateGoogleOAuthAccessToken(accessToken)
      const hasRefresh = mode === "cli-import" ? Boolean(cliCreds?.refresh) : Boolean(auth.refresh)
      return token.ok || hasRefresh
    }
    return false
  }

  const oauthValid = await hasValidOAuth()

  if (auth?.type === "oauth" && oauthValid) {
    const mode = (auth.mode as any) ?? (cliCreds?.refresh ? "cli-import" : "gemini-oauth")
    const accessToken = mode === "cli-import" ? (cliCreds?.access ?? auth.access) : auth.access
    const refreshToken = mode === "cli-import" ? (cliCreds?.refresh ?? auth.refresh) : auth.refresh
    const token = await validateGoogleOAuthAccessToken(accessToken)
    const hasRefresh = Boolean(refreshToken)
    const isSubscription = mode === "codeassist" || mode === "cli-import"
    const source = mode === "cli-import" && cliCreds?.refresh ? "cli-import" : "stored-oauth"
    const lane: ProviderLane =
      mode === "cli-import"
        ? "gemini-cli-import"
        : mode === "codeassist" || mode === "custom-oauth"
          ? "google-oauth-client"
          : "gemini-api"
    const failureCategory =
      token.ok || hasRefresh
        ? undefined
        : classifyProviderFailure({
            providerID,
            message:
              token.reason === "scope_missing" || token.reason === "audience_mismatch"
                ? `misconfigured: ${token.message}`
                : token.message,
          })

    const details = token.ok
      ? [
          ...token.details,
          `OAuth client id in use: ${effectiveClient.value} (${effectiveClient.source})`,
          mode === "cli-import"
            ? "Lane: Gemini CLI Import (enterprise legacy)."
            : mode === "codeassist"
              ? "Lane: Google OAuth Client Sign-In (configured browser sign-in)."
              : mode === "custom-oauth"
                ? "Lane: Google OAuth Client Sign-In (user-managed OAuth client)."
                : "Lane: Gemini API OAuth.",
          auth.accountId
            ? `Authenticated as: ${auth.accountId}`
            : "Authenticated email not recorded; re-run `dax auth login` to refresh metadata.",
        ]
      : [
          `OAuth client id in use: ${effectiveClient.value} (${effectiveClient.source})`,
          hasRefresh
            ? "Access token expired/invalid, but refresh token is present and will be used during execution."
            : "Access token expired/invalid and no refresh token found.",
          isSubscription && mode === "cli-import"
            ? "For a supported enterprise Gemini CLI deployment, refresh `gemini`; individual accounts should use a governed Antigravity worker or Gemini API key."
            : "Re-run `dax auth login` if the lane stays blocked.",
        ]

    return {
      providerID,
      mode,
      lane,
      laneLabel: providerLaneLabel(lane),
      source,
      endpoint: isSubscription ? "cloudcode-pa" : "generativelanguage",
      ok: token.ok || hasRefresh,
      requiredEnv: ["None required for OAuth token mode"],
      missingEnv: [],
      details,
      error: token.ok || hasRefresh ? undefined : token.message,
      failureCategory,
      next: failureCategory ? [providerFailureNextStep({ category: failureCategory, providerID, lane })] : undefined,
    }
  }

  if (apiKey) {
    return {
      providerID,
      mode: "gemini-api-key",
      lane: "gemini-api",
      laneLabel: providerLaneLabel("gemini-api"),
      source: "api-key",
      endpoint: "generativelanguage",
      ok: true,
      requiredEnv: ["GEMINI_API_KEY (or GOOGLE_API_KEY)"],
      missingEnv: [],
      details: [
        "Using Gemini API key mode.",
        `Lane: ${providerLaneLabel("gemini-api")}.`,
        `OAuth client id in use: ${effectiveClient.value} (${effectiveClient.source})`,
        project
          ? "GOOGLE_CLOUD_PROJECT is also set. Keep Google models on `google/*`; use `google-vertex/*` with ADC."
          : "No Vertex project env detected.",
      ],
    }
  }

  return {
    providerID,
    mode: "missing",
    lane: "gemini-api",
    laneLabel: providerLaneLabel("gemini-api"),
    source: "env",
    endpoint: "generativelanguage",
    ok: false,
    requiredEnv: ["GEMINI_API_KEY (or GOOGLE_API_KEY)"],
    missingEnv: ["GEMINI_API_KEY/GOOGLE_API_KEY or google OAuth login"],
    details: [`OAuth client id in use: ${effectiveClient.value} (${effectiveClient.source})`],
    failureCategory: "auth_missing",
    next: [providerFailureNextStep({ category: "auth_missing", providerID, lane: "gemini-api" })],
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
    lane: "vertex",
    laneLabel: providerLaneLabel("vertex"),
    source: explicit ? "env" : "adc",
    endpoint: "vertex",
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
    failureCategory: ok ? undefined : "misconfigured",
    next: ok ? undefined : [providerFailureNextStep({ category: "misconfigured", providerID, lane: "vertex" })],
    error: ok
      ? undefined
      : "Vertex provider requires GOOGLE_CLOUD_PROJECT plus ADC. For Gemini API OAuth/API key, use `google/*` models instead.",
  }
}

async function diagnoseCopilotProvider(providerID: string): Promise<AuthDiagnostics> {
  const auth = await Auth.get(providerID)
  const enterpriseAuth = providerID === "github-copilot" ? await Auth.get("github-copilot-enterprise") : undefined
  const hasAuth = auth?.type === "oauth" || enterpriseAuth?.type === "oauth"

  if (hasAuth) {
    const isEnterprise = enterpriseAuth?.type === "oauth"
    return {
      providerID,
      mode: "copilot-oauth",
      lane: "copilot-oauth",
      laneLabel: providerLaneLabel("copilot-oauth"),
      ok: true,
      requiredEnv: [],
      missingEnv: [],
      details: [
        isEnterprise ? "GitHub Copilot Enterprise OAuth session found." : "GitHub Copilot OAuth session found.",
        "Cost is $0 — uses your Copilot subscription.",
      ],
    }
  }

  return {
    providerID,
    mode: "missing",
    lane: "copilot-oauth",
    laneLabel: providerLaneLabel("copilot-oauth"),
    ok: false,
    requiredEnv: [],
    missingEnv: ["GitHub Copilot OAuth token"],
    failureCategory: "auth_missing",
    next: [providerFailureNextStep({ category: "auth_missing", providerID, lane: "copilot-oauth" })],
    error: `GitHub Copilot not authenticated. Run 'dax auth login' and select 'GitHub Copilot'.`,
    details: [
      "GitHub Copilot requires a GitHub account with an active Copilot subscription.",
      "Run 'dax auth login' → select 'GitHub Copilot' to authenticate via device code flow.",
    ],
  }
}

async function diagnoseOpenAIOAuthProvider(providerID: string): Promise<AuthDiagnostics> {
  const auth = await Auth.get(providerID)
  const hasApiKey = Boolean(env("OPENAI_API_KEY"))

  if (auth?.type === "oauth") {
    return {
      providerID,
      mode: "openai-oauth",
      lane: "openai-chatgpt",
      laneLabel: providerLaneLabel("openai-chatgpt"),
      ok: true,
      requiredEnv: [],
      missingEnv: [],
      details: [`${providerID} authenticated via OAuth (ChatGPT Plus/Pro subscription)`],
    }
  }

  if (auth?.type === "api" || hasApiKey) {
    return {
      providerID,
      mode: "openai-api",
      lane: "openai-api",
      laneLabel: providerLaneLabel("openai-api"),
      ok: true,
      requiredEnv: ["OPENAI_API_KEY"],
      missingEnv: hasApiKey ? [] : ["OPENAI_API_KEY"],
      details: [`${providerID} authenticated via API key`],
    }
  }

  return {
    providerID,
    mode: "missing",
    lane: "openai-api",
    laneLabel: providerLaneLabel("openai-api"),
    ok: false,
    requiredEnv: ["OPENAI_API_KEY"],
    missingEnv: ["OPENAI_API_KEY or OAuth login"],
    failureCategory: "auth_missing",
    next: [providerFailureNextStep({ category: "auth_missing", providerID, lane: "openai-api" })],
    error: `${providerID} not authenticated. Run 'dax auth login' or set OPENAI_API_KEY.`,
    details: ["OpenAI requires an API key or ChatGPT Plus/Pro OAuth login."],
  }
}

export async function diagnoseProviderAuth(providerID: string): Promise<AuthDiagnostics> {
  if (providerID === "google") return diagnoseGoogleProvider(providerID)
  if (providerID === "google-vertex" || providerID === "google-vertex-anthropic") {
    return diagnoseVertexProvider(providerID)
  }
  if (providerID === "claude-code" || providerID === "anthropic") {
    return diagnoseAnthropicProvider(providerID)
  }
  if (providerID === "github-copilot" || providerID === "github-copilot-enterprise") {
    return diagnoseCopilotProvider(providerID)
  }
  if (providerID === "openai") {
    return diagnoseOpenAIOAuthProvider(providerID)
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
  if (
    providerID !== "google" &&
    providerID !== "google-vertex" &&
    providerID !== "google-vertex-anthropic" &&
    providerID !== "claude-code" &&
    providerID !== "anthropic" &&
    providerID !== "github-copilot" &&
    providerID !== "github-copilot-enterprise" &&
    providerID !== "openai"
  )
    return
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
  return [env("DAX_GEMINI_OAUTH_CLIENT_ID"), env("GEMINI_OAUTH_CLIENT_ID"), env("GOOGLE_OAUTH_CLIENT_ID")].filter(
    Boolean,
  ) as string[]
}

async function diagnoseAnthropicProvider(providerID: string): Promise<AuthDiagnostics> {
  const auth = await Auth.get(providerID)
  const hasApiKey = Boolean(env("ANTHROPIC_API_KEY") || env("CLAUDE_API_KEY"))

  if (auth?.type === "oauth") {
    const expired = auth.expires <= Date.now()
    // Detect stale placeholder token written by the old stub implementation.
    if (!auth.access || auth.access === "subscription-detected") {
      return {
        providerID,
        mode: "anthropic-oauth",
        lane: "anthropic-subscription",
        laneLabel: providerLaneLabel("anthropic-subscription"),
        ok: false,
        requiredEnv: [],
        missingEnv: [],
        details: [
          `${providerID} OAuth token is a stale placeholder from a previous version.`,
          "Re-authenticate with 'dax auth login' to get a real token.",
        ],
        failureCategory: "auth_expired",
        next: [
          providerFailureNextStep({
            category: "auth_expired",
            providerID,
            lane: "anthropic-subscription",
          }),
        ],
        error: `${providerID} OAuth session is invalid. Run 'dax auth login ${providerID}' to re-authenticate.`,
      }
    }
    return {
      providerID,
      mode: "anthropic-oauth",
      lane: "anthropic-subscription",
      laneLabel: providerLaneLabel("anthropic-subscription"),
      ok: !expired,
      requiredEnv: [],
      missingEnv: [],
      details: [
        `${providerID} authenticated via OAuth (Pro/Max subscription)`,
        `OAuth token expires ${auth.expires <= Date.now() ? "in the past" : `in ${formatRelativeMs(auth.expires - Date.now())}`}`,
        `OAuth expiry timestamp: ${new Date(auth.expires).toISOString()}`,
        "This lane can be rate-limited by Anthropic independently of claude.ai web usage.",
      ],
      failureCategory: expired ? "auth_expired" : undefined,
      next: expired
        ? [
            providerFailureNextStep({
              category: "auth_expired",
              providerID,
              lane: "anthropic-subscription",
            }),
          ]
        : undefined,
      error: expired ? `${providerID} OAuth token is expired. Re-authenticate before retrying this lane.` : undefined,
    }
  }

  if (auth?.type === "api" || hasApiKey) {
    return {
      providerID,
      mode: "anthropic-api",
      lane: "anthropic-api",
      laneLabel: providerLaneLabel("anthropic-api"),
      source: hasApiKey ? "env" : "api-key",
      ok: true,
      requiredEnv: ["ANTHROPIC_API_KEY or CLAUDE_API_KEY"],
      missingEnv: hasApiKey ? [] : ["ANTHROPIC_API_KEY"],
      details: hasApiKey
        ? [`${providerID} authenticated via API key`]
        : [`${providerID} API key not found. Set ANTHROPIC_API_KEY or run 'dax auth login'.`],
    }
  }

  return {
    providerID,
    mode: "missing",
    lane: "anthropic-api",
    laneLabel: providerLaneLabel("anthropic-api"),
    ok: false,
    requiredEnv: ["ANTHROPIC_API_KEY"],
    missingEnv: ["ANTHROPIC_API_KEY"],
    failureCategory: "auth_missing",
    next: [providerFailureNextStep({ category: "auth_missing", providerID, lane: "anthropic-api" })],
    error: `${providerID} auth not configured. Run 'dax auth login ${providerID}' or set ANTHROPIC_API_KEY.`,
    details: [
      providerID === "claude-code"
        ? "Claude Code (Pro/Plus) requires OAuth subscription or API key"
        : "Anthropic provider requires ANTHROPIC_API_KEY or OAuth login",
    ],
  }
}
