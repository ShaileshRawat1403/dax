import type { Hooks, PluginInput } from "@dax-ai/plugin"
import { Auth, OAUTH_DUMMY_KEY } from "@/auth"
import { parseGeminiSubscriptionRetryMs } from "./gemini-rate-limit"
import { scheduleGeminiSubscriptionRequest, persistGeminiSubscriptionCooldown } from "./gemini-scheduler"
import { Global } from "@/global"
import path from "path"
import { iife } from "../util/iife"

const GEMINI_OAUTH_DOC = "https://ai.google.dev/gemini-api/docs/oauth"
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"
const GOOGLE_SCOPE_OPENID = "openid"
const GOOGLE_SCOPE_CLOUD = "https://www.googleapis.com/auth/cloud-platform"
const GOOGLE_SCOPE_EMAIL = "https://www.googleapis.com/auth/userinfo.email"
const GOOGLE_SCOPE_PROFILE = "https://www.googleapis.com/auth/userinfo.profile"
const GOOGLE_SCOPE_GENERATIVE_QUOTA = "https://www.googleapis.com/auth/generative-language.peruserquota"
const GOOGLE_SCOPE_GENERATIVE_RETRIEVER = "https://www.googleapis.com/auth/generative-language.retriever.readonly"
const OAUTH_PORT = 1717
const OAUTH_PORT_MAX = 1730
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000
const WAIT_MS = 2 * 60 * 1000
const WAIT_STEP_MS = 1500
const ACCESS_ONLY_PREFIX = "access-only:"
// Google's official OAuth credentials for direct sign-in (Pro/Plus)
// Set via environment variables: DAX_GOOGLE_CLI_CLIENT_ID, DAX_GOOGLE_CLI_CLIENT_SECRET
const GOOGLE_CLOUD_SDK_CLIENT_ID = "764086051750-76sqf96j9pjkndisqve66smditp53m6j.apps.googleusercontent.com"
const getGoogleCliClientId = () =>
  Bun.env.DAX_GOOGLE_CLI_CLIENT_ID ?? Bun.env.GEMINI_OAUTH_CLIENT_ID ?? GOOGLE_CLOUD_SDK_CLIENT_ID
const getGoogleCliClientSecret = () => Bun.env.DAX_GOOGLE_CLI_CLIENT_SECRET ?? Bun.env.GEMINI_OAUTH_CLIENT_SECRET

let cachedCloudCodeProjectId: string | undefined = undefined

async function resolveCloudCodeProject(accessToken: string, refreshToken?: string): Promise<string> {
  if (cachedCloudCodeProjectId) return cachedCloudCodeProjectId

  const metadata = {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  }

  const makeHeaders = (token: string) => ({
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "GoogleCloud/1.0.0 (Windows NT 10.0; Win64; x64) GeminiCLI/0.34.0",
  })

  // Try loadCodeAssist with current token
  let loadRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
    method: "POST",
    headers: makeHeaders(accessToken),
    body: JSON.stringify({ metadata }),
  }).catch(() => null)

  if (loadRes?.ok) {
    const data = await loadRes.json().catch(() => ({}))
    if (data.cloudaicompanionProject) {
      cachedCloudCodeProjectId = data.cloudaicompanionProject
      return cachedCloudCodeProjectId as string
    }
  }

  // If loadCodeAssist failed, try to get a fresh token
  // Strategy 1: Re-read CLI file (user may have run `gemini`)
  const freshCreds = await readCliCreds()
  if (freshCreds?.access && freshCreds.expires && freshCreds.expires > Date.now()) {
    loadRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
      method: "POST",
      headers: makeHeaders(freshCreds.access),
      body: JSON.stringify({ metadata }),
    }).catch(() => null)

    if (loadRes?.ok) {
      const data = await loadRes.json().catch(() => ({}))
      if (data.cloudaicompanionProject) {
        cachedCloudCodeProjectId = data.cloudaicompanionProject
        return cachedCloudCodeProjectId as string
      }
    }
  }

  // Strategy 2: Refresh the token using the refresh token
  if (refreshToken) {
    const refreshed = await refreshGoogleToken(refreshToken)
    if (refreshed?.access) {
      loadRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
        method: "POST",
        headers: makeHeaders(refreshed.access),
        body: JSON.stringify({ metadata }),
      }).catch(() => null)

      if (loadRes?.ok) {
        const data = await loadRes.json().catch(() => ({}))
        if (data.cloudaicompanionProject) {
          cachedCloudCodeProjectId = data.cloudaicompanionProject
          return cachedCloudCodeProjectId as string
        }
      }
    }
  }

  // Fallback onboard attempt
  const onboardRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:onboardUser", {
    method: "POST",
    headers: makeHeaders(accessToken),
    body: JSON.stringify({ tierId: "standard-tier", metadata }),
  }).catch(() => null)

  if (onboardRes?.ok) {
    const data = await onboardRes.json().catch(() => ({}))
    if (data.cloudaicompanionProject?.id) {
      cachedCloudCodeProjectId = data.cloudaicompanionProject.id
      return cachedCloudCodeProjectId as string
    } else if (typeof data.cloudaicompanionProject === "string" && data.cloudaicompanionProject) {
      cachedCloudCodeProjectId = data.cloudaicompanionProject
      return cachedCloudCodeProjectId as string
    }
  }

  cachedCloudCodeProjectId = "default"
  return cachedCloudCodeProjectId
}

const credsPaths = () =>
  [
    Bun.env.GEMINI_OAUTH_CREDS_PATH,
    `${Bun.env.HOME ?? ""}/.gemini/oauth_creds.json`,
    `${Bun.env.HOME ?? ""}/.config/gemini/oauth_creds.json`,
    `${Bun.env.HOME ?? ""}/.config/google-gemini/oauth_creds.json`,
  ].filter(Boolean) as string[]

const adcPath = () =>
  [Bun.env.DAX_GEMINI_ADC_PATH, `${Bun.env.HOME ?? ""}/.config/gcloud/application_default_credentials.json`].find(
    Boolean,
  )

type CliCreds = {
  access_token?: string
  refresh_token?: string
  expiry_date?: number
  client_id?: string
  client_secret?: string
}

type AdcCreds = {
  type?: string
  refresh_token?: string
  client_id?: string
  client_secret?: string
  quota_project_id?: string
}

type OAuthCreds = {
  access?: string
  refresh?: string
  expires?: number
  clientID?: string
  clientSecret?: string
  quotaProjectID?: string
  mode?: "api-key" | "custom-oauth" | "cli-import" | "codeassist" | "vertex"
}

type CliImportCredentialSnapshot = Pick<OAuthCreds, "access" | "refresh" | "expires" | "clientID" | "clientSecret">

type OAuthState = {
  access?: string
  refresh: string
  expires: number
  clientID?: string
  clientSecret?: string
  quotaProjectID?: string
  accountId?: string // user email
  mode?: "api-key" | "custom-oauth" | "cli-import" | "codeassist" | "vertex"
}

function isSubscriptionMode(mode: OAuthState["mode"]) {
  return mode === "cli-import" || mode === "codeassist"
}

class GeminiCliSessionExpiredError extends Error {
  constructor() {
    super(
      "Your imported Gemini CLI session expired. Reconnect with 'Gemini CLI Session Import', switch to 'Google OAuth Client Sign-In', or run `gemini` again to refresh your local terminal login.",
    )
    this.name = "GeminiCliSessionExpiredError"
  }
}

function importedGeminiCliExpiredError() {
  return new GeminiCliSessionExpiredError()
}

// Module-level web OAuth re-auth state — shared across all concurrent fetch calls.
let _webReauthUrl: string | undefined
let _webReauthPromise: Promise<{ access: string; expires: number; refresh?: string } | null> | undefined
const _reauthUrlCallbacks = new Set<(url: string) => void>()

/** Register a callback that fires when a Gemini CLI session expires and web re-auth starts. */
export function onGeminiReauthRequired(cb: (url: string) => void): () => void {
  _reauthUrlCallbacks.add(cb)
  return () => _reauthUrlCallbacks.delete(cb)
}

type AuthRaceWinner = { source: "web"; code: string } | { source: "cli"; creds: OAuthCreds }

/**
 * Race a web OAuth code arrival against CLI credentials file detection.
 * Returns the first valid result, or null if neither completes within timeoutMs.
 */
async function raceGoogleAuth(
  webState: string,
  baseline: OAuthCreds | undefined,
  timeoutMs: number,
): Promise<AuthRaceWinner | null> {
  return new Promise<AuthRaceWinner | null>((resolve) => {
    let done = false
    const finish = (result: AuthRaceWinner | null) => {
      if (done) return
      done = true
      resolve(result)
    }

    const webTimer = setInterval(() => {
      const code = oauthCode.get(webState)
      if (code) {
        oauthCode.delete(webState)
        clearInterval(webTimer)
        finish({ source: "web", code })
      }
    }, 400)

    waitForCliImportCreds({ baseline, timeoutMs }).then((creds) => {
      if (creds?.refresh) {
        clearInterval(webTimer)
        oauthCode.delete(webState)
        finish({ source: "cli", creds })
      }
    })

    setTimeout(() => {
      clearInterval(webTimer)
      finish(null)
    }, timeoutMs)
  })
}

/**
 * Start a background web OAuth flow to renew an expired CLI session.
 * Returns the sign-in URL immediately and a promise for the new token.
 * Deduplicates: if a flow is already in progress, returns the same state.
 */
async function beginWebOAuthRefresh(): Promise<{
  url: string
  tokens: Promise<{ access: string; expires: number; refresh?: string } | null>
} | null> {
  if (_webReauthUrl && _webReauthPromise) {
    return { url: _webReauthUrl, tokens: _webReauthPromise }
  }

  let redirectURI: string
  try {
    redirectURI = await startOAuthServer()
  } catch {
    return null
  }

  oauthCode.clear()
  const reauthState = generateState()
  const pkce = await generatePKCE()
  const clientID = getGoogleCliClientId()
  const clientSecret = getGoogleCliClientSecret()
  _webReauthUrl = buildGoogleAuthorizeURL(redirectURI, reauthState, pkce, clientID, "compat")

  for (const cb of _reauthUrlCallbacks) {
    try {
      cb(_webReauthUrl)
    } catch {}
  }

  _webReauthPromise = (async () => {
    try {
      const code = await waitForOAuthCode(reauthState)
      const token = await exchangeCodeForTokens(code, redirectURI, pkce, clientID, clientSecret)
      if (!token.access_token) return null
      return {
        access: token.access_token,
        expires: Date.now() + (token.expires_in ?? 3600) * 1000,
        refresh: token.refresh_token,
      }
    } catch {
      return null
    } finally {
      _webReauthUrl = undefined
      _webReauthPromise = undefined
    }
  })()

  return { url: _webReauthUrl, tokens: _webReauthPromise }
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

interface PkceCodes {
  verifier: string
  challenge: string
}

let oauthServer: ReturnType<typeof Bun.serve> | undefined
const oauthCode = new Map<string, string>()
let oauthRedirectURI: string | undefined

const readCliCreds = async (): Promise<OAuthCreds | undefined> => {
  for (const item of credsPaths()) {
    const creds = await Bun.file(item)
      .json()
      .then((x) => x as CliCreds)
      .catch(() => undefined)
    if (!creds) continue
    if (!creds.access_token && !creds.refresh_token) continue
    return {
      access: creds.access_token,
      refresh: creds.refresh_token,
      expires: creds.expiry_date,
      clientID: creds.client_id,
      clientSecret: creds.client_secret,
      quotaProjectID: undefined,
    } satisfies OAuthCreds
  }
  return undefined
}

const readAdcCreds = async (): Promise<OAuthCreds | undefined> => {
  const file = adcPath()
  if (!file) return undefined
  const creds = await Bun.file(file)
    .json()
    .then((x) => x as AdcCreds)
    .catch(() => undefined)
  if (!creds) return undefined
  if (creds.type !== "authorized_user") return undefined
  if (!creds.refresh_token) return undefined
  return {
    access: undefined,
    refresh: creds.refresh_token,
    expires: undefined,
    clientID: creds.client_id,
    clientSecret: creds.client_secret,
    quotaProjectID: creds.quota_project_id,
  } satisfies OAuthCreds
}

const readCreds = async (): Promise<OAuthCreds | undefined> => {
  const [cli, adc] = await Promise.all([readCliCreds(), readAdcCreds()])
  if (cli?.access && cli?.refresh) return { ...cli, mode: "cli-import" }
  if (cli?.refresh) return { ...cli, mode: "cli-import" }
  // Do not auto-import ADC for Gemini API ("google" provider). ADC is for
  // Vertex flows and usually yields cloud-platform scoped tokens that fail
  // against Gemini API auth requirements.
  // Import must be explicitly enabled by setting DAX_GEMINI_ALLOW_ADC_IMPORT=1
  if (adc?.refresh && Bun.env.DAX_GEMINI_ALLOW_ADC_IMPORT === "1") return { ...adc, mode: "vertex" }
  return undefined
}

export function cliImportCredSignature(creds?: CliImportCredentialSnapshot) {
  if (!creds?.refresh) return ""
  return [creds.refresh, creds.access ?? "", creds.expires ?? 0, creds.clientID ?? "", creds.clientSecret ?? ""].join(
    "::",
  )
}

export function isCliImportReady(creds?: CliImportCredentialSnapshot, now = Date.now()) {
  return Boolean(creds?.refresh && creds.access && typeof creds.expires === "number" && creds.expires > now + 30_000)
}

export async function waitForCliImportCreds(options?: {
  baseline?: CliImportCredentialSnapshot
  read?: () => Promise<OAuthCreds | undefined>
  timeoutMs?: number
  stepMs?: number
  now?: () => number
}) {
  const read = options?.read ?? readCliCreds
  const timeoutMs = options?.timeoutMs ?? WAIT_MS
  const stepMs = options?.stepMs ?? WAIT_STEP_MS
  const now = options?.now ?? Date.now
  const baseline = options?.baseline
  if (isCliImportReady(baseline, now())) return baseline

  const baselineSignature = cliImportCredSignature(baseline)
  const end = now() + timeoutMs
  while (now() < end) {
    const creds = await read()
    if (creds?.refresh) {
      const changed = cliImportCredSignature(creds) !== baselineSignature
      if ((baselineSignature === "" && creds.refresh) || changed || isCliImportReady(creds, now())) {
        return creds
      }
    }
    await Bun.sleep(stepMs)
  }
  return undefined
}

const latestOAuth = async (getAuth: () => Promise<Auth.Info | undefined>): Promise<OAuthState | undefined> => {
  const [stored, file] = await Promise.all([getAuth(), readCreds()])
  const oauth = stored?.type === "oauth" ? stored : undefined

  // Prefer explicitly stored non-import lanes so a freshly completed custom
  // or Code Assist sign-in is not unexpectedly replaced by external CLI files.
  if (oauth?.refresh && oauth.mode && oauth.mode !== "cli-import") {
    return oauth
  }

  if (file?.refresh) {
    const fromFile: OAuthState = {
      refresh: file.refresh,
      access: file.access,
      expires: file.expires ?? 0,
      clientID: file.clientID,
      clientSecret: file.clientSecret,
      quotaProjectID: file.quotaProjectID,
      mode: file.mode,
    }
    // Prefer external CLI/ADC creds whenever available so import flow reflects
    // the latest login identity and scopes.
    return fromFile
  }

  return oauth
}

const refreshGoogleToken = async (refreshToken: string, clientID?: string, clientSecret?: string) => {
  if (refreshToken.startsWith(ACCESS_ONLY_PREFIX)) return undefined

  // If no client credentials available, try using the refresh token directly
  // This works for CLI-imported credentials that don't have associated client secrets
  const useClientCreds = clientID && clientSecret

  if (!useClientCreds) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })

    const result = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }).catch(() => undefined)

    if (!result?.ok) return undefined

    const json = (await result.json().catch(() => undefined)) as
      | { access_token?: string; expires_in?: number }
      | undefined

    if (!json?.access_token) return undefined

    return {
      access: json.access_token,
      expires: Date.now() + (json.expires_in ?? 3600) * 1000,
    }
  }

  // Use client credentials for refresh
  const id = clientID
  const secret = clientSecret

  if (!id || !secret) {
    throw new Error(
      "OAuth credentials required for token refresh. Provide client_id and client_secret:\n" +
        "  1. Create OAuth credentials at: https://console.cloud.google.com/apis/credentials/oauthclient\n" +
        "  2. Set DAX_GOOGLE_CLI_CLIENT_ID and DAX_GOOGLE_CLI_CLIENT_SECRET environment variables",
    )
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
  body.set("client_id", id)
  body.set("client_secret", secret)
  const result = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }).catch(() => undefined)
  if (!result?.ok) return undefined
  const json = (await result.json().catch(() => undefined)) as
    | { access_token?: string; expires_in?: number }
    | undefined
  if (!json?.access_token) return undefined
  return {
    access: json.access_token,
    expires: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
}

const refreshStoredGoogleAccess = async (oauth: OAuthState | undefined, refreshToken: string) => {
  if (oauth?.mode === "cli-import" && (!oauth.clientID || !oauth.clientSecret)) {
    // Always re-read the CLI creds file first — the user may have run `gemini`
    // in the background and the file has a fresh access token.
    const freshFile = await readCliCreds()
    if (freshFile?.access && freshFile.expires && freshFile.expires > Date.now()) {
      return { access: freshFile.access, expires: freshFile.expires }
    }

    // If the file doesn't have a fresh token, try the direct refresh.
    // Some OAuth flows work without client secrets.
    const fromEnv = refreshGoogleToken(refreshToken)
    const envResult = await fromEnv
    if (envResult?.access) return envResult

    // Last resort: check if the CLI file was modified recently (within last 2 hours).
    // If so, the user likely ran `gemini` recently and the file might have a token
    // that's still valid even if our cached expiry says otherwise.
    for (const item of credsPaths()) {
      try {
        const stat = await Bun.file(item).stat()
        const ageMs = Date.now() - stat.mtimeMs
        if (ageMs < 2 * 60 * 60 * 1000) {
          const retryFile = await readCliCreds()
          if (retryFile?.access && retryFile.expires && retryFile.expires > Date.now()) {
            return { access: retryFile.access, expires: retryFile.expires }
          }
        }
      } catch {
        // File doesn't exist or can't be stat'd
      }
    }

    throw importedGeminiCliExpiredError()
  }
  return refreshGoogleToken(refreshToken, oauth?.clientID, oauth?.clientSecret)
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((x) => chars[x % chars.length])
    .join("")
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const binary = String.fromCharCode(...bytes)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(hash) }
}

function generateState() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

const startOAuthServer = async () => {
  if (oauthServer && oauthRedirectURI) return oauthRedirectURI
  for (let port = OAUTH_PORT; port <= OAUTH_PORT_MAX; port++) {
    let server: ReturnType<typeof Bun.serve> | undefined
    try {
      server = Bun.serve({
        port,
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname !== "/auth/callback") return new Response("Not found", { status: 404 })
          const code = url.searchParams.get("code")
          const state = url.searchParams.get("state")
          const error = url.searchParams.get("error")
          const description = url.searchParams.get("error_description")
          if (error) {
            const message = description
              ? `Authorization failed: ${description}. You can close this tab.`
              : `Authorization failed (${error}). You can close this tab.`
            return new Response(message, { status: 400 })
          }
          if (!code || !state) {
            return new Response(
              "Authorization callback missing code/state. Do not open localhost callback directly. " +
                "Use the latest Google sign-in link from DAX and complete consent in that same browser window.",
              { status: 400 },
            )
          }
          oauthCode.set(state, code)
          return new Response("Authorization successful. You can close this tab.", { status: 200 })
        },
      })
    } catch {
      server = undefined
    }
    if (!server) continue
    oauthServer = server
    oauthRedirectURI = `http://localhost:${port}/auth/callback`
    return oauthRedirectURI
  }
  throw new Error(`Unable to start local OAuth callback server on ports ${OAUTH_PORT}-${OAUTH_PORT_MAX}`)
}

const waitForOAuthCode = (state: string) =>
  new Promise<string>((resolve, reject) => {
    const end = Date.now() + OAUTH_TIMEOUT_MS
    const timer = setInterval(() => {
      const code = oauthCode.get(state)
      if (code) {
        oauthCode.delete(state)
        clearInterval(timer)
        resolve(code)
        return
      }
      if (Date.now() < end) return
      clearInterval(timer)
      oauthCode.delete(state)
      reject(
        new Error("OAuth login timed out. Use the latest DAX sign-in link and finish login in that same browser tab."),
      )
    }, 400)
  })

const exchangeCodeForTokens = async (
  code: string,
  redirectURI: string,
  pkce: PkceCodes,
  clientID: string,
  clientSecret?: string,
) => {
  const secret = clientSecret ?? Bun.env.DAX_GEMINI_OAUTH_CLIENT_SECRET ?? Bun.env.GEMINI_OAUTH_CLIENT_SECRET
  const body = new URLSearchParams({
    code,
    client_id: clientID,
    code_verifier: pkce.verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectURI,
  })
  if (secret) body.set("client_secret", secret)
  const result = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }).catch((err) => {
    throw new Error(`Network error during token exchange: ${err.message}`)
  })

  if (!result?.ok) {
    const text = await result?.text().catch(() => "Unknown error")
    throw new Error(`Token exchange failed (${result?.status}): ${text}`)
  }

  return result.json() as Promise<TokenResponse>
}

const buildGoogleAuthorizeURL = (
  redirectURI: string,
  state: string,
  pkce: PkceCodes,
  clientID: string,
  scopeMode: "full" | "compat" = (Bun.env.DAX_GEMINI_OAUTH_SCOPE_MODE ?? "full").toLowerCase() as "full" | "compat",
) => {
  const scopes = [
    GOOGLE_SCOPE_OPENID,
    GOOGLE_SCOPE_EMAIL,
    GOOGLE_SCOPE_PROFILE,
    GOOGLE_SCOPE_CLOUD,
    GOOGLE_SCOPE_GENERATIVE_QUOTA,
    GOOGLE_SCOPE_GENERATIVE_RETRIEVER,
  ]
  // compat mode avoids hard failures on some unverified clients that reject generative-language scope.
  if (scopeMode === "compat") {
    // Only cloud-platform
    return new URL(
      `${GOOGLE_AUTH_URL}?${new URLSearchParams({
        access_type: "offline",
        client_id: clientID,
        code_challenge: pkce.challenge,
        code_challenge_method: "S256",
        prompt: "consent",
        redirect_uri: redirectURI,
        response_type: "code",
        scope: [GOOGLE_SCOPE_OPENID, GOOGLE_SCOPE_EMAIL, GOOGLE_SCOPE_PROFILE, GOOGLE_SCOPE_CLOUD].join(" "),
        state,
      }).toString()}`,
    ).href
  }
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: clientID,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: redirectURI,
    response_type: "code",
    scope: scopes.join(" "),
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

const checkTokenHealth = async (accessToken: string) => {
  const url = new URL(GOOGLE_TOKEN_INFO_URL)
  url.searchParams.set("access_token", accessToken)
  const result = await fetch(url).catch(() => undefined)
  if (!result?.ok) return { ok: false, reason: "token_expired" as const }
  const json = (await result.json().catch(() => ({}))) as { scope?: string; email?: string }
  const scopes = json.scope ?? ""
  // Gemini OAuth tokens should include Gemini or Cloud scope.
  if (
    !scopes.includes(GOOGLE_SCOPE_GENERATIVE_QUOTA) &&
    !scopes.includes(GOOGLE_SCOPE_GENERATIVE_RETRIEVER) &&
    !scopes.includes(GOOGLE_SCOPE_CLOUD)
  ) {
    return { ok: false, reason: "scope_missing" as const }
  }
  return { ok: true, email: json.email }
}

const stripKey = (request: RequestInfo | URL) => {
  const base = request instanceof URL ? request.href : request instanceof Request ? request.url : request.toString()
  const url = new URL(base)
  url.searchParams.delete("key")
  return url
}

const isScopeError = async (response: Response) => {
  if (response.status !== 403) return false
  const text = await response
    .clone()
    .text()
    .catch(() => "")
  return text.toLowerCase().includes("insufficient authentication scopes")
}

const isInvalidCredentialError = async (response: Response) => {
  if (response.status !== 401 && response.status !== 403) return false
  const text = await response
    .clone()
    .text()
    .catch(() => "")
    .then((x) => x.toLowerCase())
  return (
    text.includes("invalid authentication credentials") ||
    text.includes("expected oauth 2 access token") ||
    text.includes("login cookie")
  )
}

const googleAuthHelpResponse = (status: number, message: string) =>
  new Response(
    JSON.stringify({
      error: {
        code: status,
        message,
        status: status === 401 ? "UNAUTHENTICATED" : "PERMISSION_DENIED",
      },
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  )

export async function GeminiAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "google",
      async loader(getAuth) {
        const info = await getAuth()
        if (!info || info.type !== "oauth") return {}
        return {
          apiKey: OAUTH_DUMMY_KEY,
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            const current = await getAuth()
            if (!current || current.type !== "oauth") return fetch(request, init)

            const fresh = await latestOAuth(getAuth)
            let access = fresh?.access ?? current.access
            const refresh = fresh?.refresh ?? current.refresh
            let expires = fresh?.expires ?? current.expires
            const quotaProjectID = fresh?.quotaProjectID

            if (!access || expires < Date.now() || Bun.env.DAX_GEMINI_SIMULATE_EXPIRE) {
              let renewed: { access: string; expires: number } | undefined
              try {
                renewed = await refreshStoredGoogleAccess(fresh, refresh)
              } catch (err) {
                if (err instanceof GeminiCliSessionExpiredError) {
                  const reauth = await beginWebOAuthRefresh()
                  if (reauth) {
                    reauth.tokens
                      .then(async (result) => {
                        if (!result?.access) return
                        await input.client.auth.set({
                          providerID: "google",
                          auth: {
                            type: "oauth",
                            access: result.access,
                            refresh: result.refresh ?? fresh?.refresh ?? refresh,
                            expires: result.expires,
                            clientID: getGoogleCliClientId(),
                            clientSecret: getGoogleCliClientSecret(),
                            mode: "codeassist",
                          } as any,
                        })
                      })
                      .catch(() => {})
                    throw new Error(
                      `Gemini session expired. Sign in to renew:\n${reauth.url}\n\nOnce signed in, send your message again.`,
                    )
                  }
                }
                throw err
              }
              if (renewed) {
                access = renewed.access
                expires = renewed.expires
                await input.client.auth.set({
                  providerID: "google",
                  auth: {
                    type: "oauth",
                    access,
                    refresh,
                    expires,
                    clientID: fresh?.clientID,
                    clientSecret: fresh?.clientSecret,
                    quotaProjectID: fresh?.quotaProjectID,
                    accountId: fresh?.accountId,
                    mode: fresh?.mode,
                  } as any,
                })
              }
            }

            const headers = new Headers(init?.headers)
            headers.delete("x-goog-api-key")
            headers.delete("X-Goog-Api-Key")
            headers.delete("authorization")
            headers.delete("Authorization")
            if (access) headers.set("Authorization", `Bearer ${access}`)
            if (quotaProjectID) headers.set("x-goog-user-project", quotaProjectID)

            let req = stripKey(request)
            let reqBody = init?.body
            let resolvedProject: string | undefined
            let effectiveModel: string | undefined

            // Native DAX routing for Pro/Plus Subscriptions (Code Assist API)
            // If the auth mode is explicitly Code Assist or CLI import, route to cloudcode-pa
            if (isSubscriptionMode(fresh?.mode) && req.href.includes("generativelanguage.googleapis.com")) {
              const isStream = req.href.includes("streamGenerateContent")
              const action = isStream ? "streamGenerateContent" : "generateContent"
              req = new URL(`https://cloudcode-pa.googleapis.com/v1internal:${action}${isStream ? "?alt=sse" : ""}`)

              resolvedProject = await resolveCloudCodeProject(access!, refresh)

              if (typeof reqBody === "string") {
                try {
                  const parsed = JSON.parse(reqBody)
                  effectiveModel = parsed.model || "gemini-2.5-flash"
                  delete parsed.model

                  if (parsed.generationConfig && parsed.generationConfig.thinkingConfig) {
                    delete parsed.generationConfig.thinkingConfig
                  }

                  const effectiveSessionID = (input as any).sessionID || crypto.randomUUID()
                  reqBody = JSON.stringify({
                    project: resolvedProject,
                    model: effectiveModel,
                    user_prompt_id: crypto.randomUUID(),
                    request: {
                      ...parsed,
                      session_id: effectiveSessionID,
                    },
                  })
                } catch (e) {}
              }
              // Code Assist API requires a specific User-Agent format
              headers.set("User-Agent", "GoogleCloud/1.0.0 (Windows NT 10.0; Win64; x64) GeminiCLI/0.34.0")
              headers.set("x-activity-request-id", crypto.randomUUID().substring(0, 16))
            }

            const executeFetch = async (
              fetchReq: URL,
              fetchHeaders: Headers,
              fetchBody: any,
              resolvedProject?: string,
              modelName?: string,
            ) => {
              const doFetch = async () => {
                const response = await fetch(fetchReq, { ...init, headers: fetchHeaders, body: fetchBody })
                return response
              }

              let response: Response | null
              if (fetchReq.hostname === "cloudcode-pa.googleapis.com") {
                response = await scheduleGeminiSubscriptionRequest(doFetch, {
                  projectId: resolvedProject,
                  model: modelName,
                })
                if (!response) {
                  const err: any = new Error("Throttled")
                  err.status = 429
                  throw err
                }
              } else {
                response = await doFetch()
              }

              // Only rewrite successful responses from Code Assist API
              if (response.ok && fetchReq.hostname === "cloudcode-pa.googleapis.com") {
                const contentType = response.headers.get("content-type") ?? ""

                // Handle SSE Streams
                if (contentType.includes("text/event-stream") && response.body) {
                  const decoder = new TextDecoder()
                  const encoder = new TextEncoder()
                  let buffer = ""
                  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
                  const CHUNK_TIMEOUT_MS = 30_000

                  const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                      reader = response.body!.getReader()
                      const pump = (): void => {
                        const readPromise = reader!.read()
                        const timeoutPromise = new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
                          setTimeout(() => reject(new Error("chunk_timeout")), CHUNK_TIMEOUT_MS)
                        })
                        Promise.race([readPromise, timeoutPromise])
                          .then(({ done, value }) => {
                            if (done) {
                              if (buffer.length > 0) {
                                processLine(buffer, controller, encoder, false)
                              }
                              controller.close()
                              return
                            }

                            buffer += decoder.decode(value, { stream: true })
                            let newlineIndex: number
                            while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
                              const line = buffer.slice(0, newlineIndex)
                              buffer = buffer.slice(newlineIndex + 1)
                              processLine(line, controller, encoder, true)
                            }
                            pump()
                          })
                          .catch((err) => {
                            if (err.message === "chunk_timeout") {
                              console.error("[Gemini] stream chunk timeout, closing stream", {
                                timeoutMs: CHUNK_TIMEOUT_MS,
                              })
                              if (buffer.length > 0) {
                                controller.enqueue(encoder.encode(buffer + "\n"))
                              }
                              controller.close()
                            } else {
                              controller.error(err)
                            }
                          })
                      }
                      pump()
                    },
                    cancel(reason) {
                      if (reader) reader.cancel(reason).catch(() => {})
                    },
                  })

                  const processLine = (
                    line: string,
                    controller: ReadableStreamDefaultController<Uint8Array>,
                    encoder: TextEncoder,
                    appendNewline: boolean,
                  ) => {
                    const hasCr = line.endsWith("\r")
                    const rawLine = hasCr ? line.slice(0, -1) : line
                    const suffix = appendNewline ? (hasCr ? "\r\n" : "\n") : ""

                    if (rawLine.startsWith("data:")) {
                      const jsonText = rawLine.slice(5).trim()
                      if (jsonText) {
                        try {
                          const json = JSON.parse(jsonText)
                          if (json.response !== undefined) {
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(json.response)}${suffix}`))
                            return
                          }
                        } catch {
                          // Fall through to raw enqueue on parse error
                        }
                      }
                    }
                    controller.enqueue(encoder.encode(line + suffix))
                  }

                  return new Response(stream, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                  })
                }

                // Handle JSON (non-streaming)
                if (contentType.includes("application/json")) {
                  try {
                    const text = await response.text()
                    const json = JSON.parse(text)
                    if (json.response !== undefined) {
                      return new Response(JSON.stringify(json.response), {
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.headers,
                      })
                    }
                    return new Response(text, {
                      status: response.status,
                      statusText: response.statusText,
                      headers: response.headers,
                    })
                  } catch {
                    // Fallback
                  }
                }
              }

              return response
            }

            const first = await executeFetch(req, headers, reqBody, resolvedProject, effectiveModel)

            // Handle 401 (Token Expired/Invalid) - Reactive Refresh
            if (first.status === 401) {
              let renewed: { access: string; expires: number } | undefined
              try {
                renewed = await refreshStoredGoogleAccess(fresh, refresh)
              } catch (err) {
                if (err instanceof GeminiCliSessionExpiredError) {
                  const reauth = await beginWebOAuthRefresh()
                  if (reauth) {
                    reauth.tokens
                      .then(async (result) => {
                        if (!result?.access) return
                        await input.client.auth.set({
                          providerID: "google",
                          auth: {
                            type: "oauth",
                            access: result.access,
                            refresh: result.refresh ?? fresh?.refresh ?? refresh,
                            expires: result.expires,
                            clientID: getGoogleCliClientId(),
                            clientSecret: getGoogleCliClientSecret(),
                            mode: "codeassist",
                          } as any,
                        })
                      })
                      .catch(() => {})
                    throw new Error(
                      `Gemini session expired. Sign in to renew:\n${reauth.url}\n\nOnce signed in, send your message again.`,
                    )
                  }
                }
                throw err
              }
              if (renewed?.access) {
                await input.client.auth.set({
                  providerID: "google",
                  auth: {
                    type: "oauth",
                    access: renewed.access,
                    refresh,
                    expires: renewed.expires,
                    clientID: fresh?.clientID,
                    clientSecret: fresh?.clientSecret,
                    quotaProjectID: fresh?.quotaProjectID,
                    accountId: fresh?.accountId,
                    mode: fresh?.mode,
                  } as any,
                })
                const retryHeaders = new Headers(init?.headers)
                retryHeaders.delete("x-goog-api-key")
                retryHeaders.delete("X-Goog-Api-Key")
                retryHeaders.delete("authorization")
                retryHeaders.delete("Authorization")
                retryHeaders.set("Authorization", `Bearer ${renewed.access}`)
                if (quotaProjectID) retryHeaders.set("x-goog-user-project", quotaProjectID)
                return executeFetch(req, retryHeaders, reqBody)
              }
            }

            const scopeError = await isScopeError(first)
            const invalidCredential = await isInvalidCredentialError(first)
            if (!scopeError && !invalidCredential) return first

            const cliCandidate = await readCliCreds()
            const adcCandidate = Bun.env.DAX_GEMINI_ALLOW_ADC_IMPORT === "1" ? await readAdcCreds() : undefined
            const candidates = [
              cliCandidate ? { ...cliCandidate, mode: "cli-import" as const } : undefined,
              adcCandidate ? { ...adcCandidate, mode: "vertex" as const } : undefined,
            ].filter((x) => !!x?.refresh && !!x?.clientID && !!x?.clientSecret)
            for (const imported of candidates) {
              if (!imported?.refresh) continue
              const renewed = await refreshGoogleToken(imported.refresh, imported.clientID, imported.clientSecret)
              if (!renewed?.access) continue
              const health = await checkTokenHealth(renewed.access)
              await input.client.auth.set({
                providerID: "google",
                auth: {
                  type: "oauth",
                  access: renewed.access,
                  refresh: imported.refresh,
                  expires: renewed.expires,
                  clientID: imported.clientID,
                  clientSecret: imported.clientSecret,
                  quotaProjectID: imported.quotaProjectID,
                  accountId: health.ok ? health.email : undefined,
                  mode: imported.mode,
                } as any,
              })
              const retryHeaders = new Headers(init?.headers)
              retryHeaders.delete("x-goog-api-key")
              retryHeaders.delete("X-Goog-Api-Key")
              retryHeaders.delete("authorization")
              retryHeaders.delete("Authorization")
              retryHeaders.set("Authorization", `Bearer ${renewed.access}`)
              if (imported.quotaProjectID) retryHeaders.set("x-goog-user-project", imported.quotaProjectID)
              const retried = await executeFetch(req, retryHeaders, reqBody)
              const retryScopeError = await isScopeError(retried)
              const retryInvalidCredential = await isInvalidCredentialError(retried)
              if (!retryScopeError && !retryInvalidCredential) return retried
            }
            if (scopeError) {
              return googleAuthHelpResponse(
                403,
                "Google token is missing the scopes required for this Gemini lane. Use `Gemini API Key`, reconnect with `Gemini CLI Session Import`, or use `Google OAuth Client Sign-In`. If you authenticated with gcloud/ADC, use the Vertex provider instead.",
              )
            }
            if (invalidCredential) {
              return googleAuthHelpResponse(
                401,
                "Google credentials are invalid for this lane. Use `Gemini API Key`, reconnect with `Gemini CLI Session Import`, or use `Google OAuth Client Sign-In`. For gcloud ADC credentials, switch to Vertex provider.",
              )
            }
            return first
          },
        }
      },
      methods: [
        {
          type: "api",
          label: "Gemini API Key",
          description: "Use your API key from Google AI Studio. Best for free tier and pay-as-you-go.",
          prompts: [
            {
              key: "key",
              type: "text",
              message: "Enter your Gemini API Key",
              validate: (x) => (x && x.length > 0 ? undefined : "Required"),
            },
          ],
          async authorize(inputs: any) {
            return {
              type: "success",
              key: inputs.key,
            }
          },
        },
        {
          type: "oauth" as const,
          label: "Sign in with Google",
          description:
            "Sign in with your Google account using a secure browser flow.\n" +
            "Works with Gemini free tier, Pro, and Plus subscriptions — no CLI required.\n" +
            "If the `gemini` CLI is already running, your session will be detected automatically.",
          async authorize() {
            const baseline = await readCliCreds()
            const clientID = getGoogleCliClientId()
            const clientSecret = getGoogleCliClientSecret()

            const redirectURI = await startOAuthServer()
            oauthCode.clear()
            const webState = generateState()
            const pkce = await generatePKCE()
            const signInUrl = buildGoogleAuthorizeURL(redirectURI, webState, pkce, clientID, "compat")

            return {
              method: "auto" as const,
              url: signInUrl,
              instructions:
                "Click the link to sign in with your Google account, or run `gemini` in a terminal — DAX will detect your session automatically.",
              async callback() {
                const winner = await raceGoogleAuth(webState, baseline, WAIT_MS)
                if (!winner) return { type: "failed" as const }

                // Web browser OAuth completed first
                if (winner.source === "web") {
                  const token = await exchangeCodeForTokens(winner.code, redirectURI, pkce, clientID, clientSecret)
                  if (!token.access_token) return { type: "failed" as const }
                  const health = await checkTokenHealth(token.access_token)
                  if (!health.ok) {
                    if (health.reason === "scope_missing")
                      throw new Error(
                        "Google account token is missing required scopes (cloud-platform, peruserquota, or retriever.readonly).",
                      )
                    if (health.reason === "token_expired")
                      throw new Error("Token expired during verification. Retry sign-in.")
                    throw new Error(`Token verification failed: ${health.reason}`)
                  }
                  const current = await readCreds()
                  return {
                    type: "success" as const,
                    access: token.access_token,
                    refresh: token.refresh_token ?? current?.refresh ?? `${ACCESS_ONLY_PREFIX}${Date.now()}`,
                    expires: Date.now() + (token.expires_in ?? 3600) * 1000,
                    clientID,
                    clientSecret,
                    accountId: health.email,
                    mode: "codeassist" as const,
                  }
                }

                // Gemini CLI credentials file detected first
                const creds = winner.creds
                let access = creds.access
                let expires = creds.expires ?? 0
                let health = access ? await checkTokenHealth(access) : { ok: false, reason: "token_expired" as const }

                if (!health.ok && health.reason === "token_expired") {
                  if (!creds.clientID || !creds.clientSecret) {
                    const renewed = await refreshGoogleToken(creds.refresh!)
                    if (!renewed?.access) throw importedGeminiCliExpiredError()
                    access = renewed.access
                    expires = renewed.expires
                    health = await checkTokenHealth(access)
                  } else {
                    const renewed = await refreshGoogleToken(creds.refresh!, creds.clientID, creds.clientSecret)
                    if (!renewed?.access) return { type: "failed" as const }
                    access = renewed.access
                    expires = renewed.expires
                    health = await checkTokenHealth(access)
                  }
                }

                if (!health.ok) {
                  if (health.reason === "scope_missing")
                    throw new Error(
                      "Imported Gemini CLI session is missing required scopes. Sign in with Google above instead.",
                    )
                  if (health.reason === "token_expired") throw importedGeminiCliExpiredError()
                  throw new Error(`Token validation failed: ${health.reason}`)
                }

                return {
                  type: "success" as const,
                  access: access!,
                  refresh: creds.refresh!,
                  expires: expires || Date.now() + 30 * 60 * 1000,
                  clientID: creds.clientID,
                  clientSecret: creds.clientSecret,
                  accountId: health.email,
                  mode: "cli-import" as const,
                }
              },
            }
          },
        },
        {
          type: "oauth" as const,
          label: "Custom Google OAuth Client",
          description:
            "Sign in with your own OAuth credentials. Requires creating an OAuth client in Google Cloud Console.",
          prompts: [
            {
              key: "clientID",
              type: "text",
              message: "Enter your Google OAuth Client ID",
              placeholder: "e.g. 123456789-abc.apps.googleusercontent.com",
              validate: (x: string) =>
                x && x.includes("apps.googleusercontent.com") ? undefined : "Must be a valid Google OAuth Client ID",
            },
            {
              key: "clientSecret",
              type: "text",
              message: "Enter your Google OAuth Client Secret",
              placeholder: "e.g. GOCSPX-...",
              validate: (x: string) => (x && x.length > 0 ? undefined : "Required"),
            },
          ],
          async authorize(inputs: any) {
            const customAuth = await Auth.get("google").then((x: any) => (x?.type === "oauth-custom" ? x : undefined))

            const clientID =
              inputs.clientID ||
              customAuth?.clientID ||
              Bun.env.DAX_GEMINI_OAUTH_CLIENT_ID ||
              Bun.env.GEMINI_OAUTH_CLIENT_ID ||
              GOOGLE_CLOUD_SDK_CLIENT_ID
            const clientSecret = inputs.clientSecret || customAuth?.clientSecret

            if (!clientID) {
              throw new Error(
                "OAuth credentials required. Please provide Client ID.\n" +
                  "Create OAuth credentials at: https://console.cloud.google.com/apis/credentials/oauthclient",
              )
            }
            const redirectURI = await startOAuthServer()
            oauthCode.clear()
            const state = generateState()
            const pkce = await generatePKCE()
            return {
              method: "auto" as const,
              url: buildGoogleAuthorizeURL(redirectURI, state, pkce, clientID),
              instructions:
                "Complete sign-in in your browser. DAX will detect the localhost redirect automatically. " +
                `OAuth client: ${clientID}. Redirect: ${redirectURI}.`,
              async callback() {
                const code = await waitForOAuthCode(state)
                const token = await exchangeCodeForTokens(code, redirectURI, pkce, clientID, clientSecret)

                if (!token.access_token) throw new Error("Token response missing access_token")

                const health = await checkTokenHealth(token.access_token)
                if (!health.ok) {
                  if (health.reason === "scope_missing")
                    throw new Error(
                      "Google account token is missing required scopes (cloud-platform, peruserquota, or retriever.readonly).",
                    )
                  if (health.reason === "token_expired")
                    throw new Error("Token expired during verification. Retry sign-in.")
                  throw new Error(`Token verification failed: ${health.reason}`)
                }

                const current = await readCreds()
                return {
                  type: "success" as const,
                  access: token.access_token,
                  refresh: token.refresh_token ?? current?.refresh ?? `${ACCESS_ONLY_PREFIX}${Date.now()}`,
                  expires: Date.now() + (token.expires_in ?? 3600) * 1000,
                  clientID,
                  clientSecret,
                  accountId: health.email,
                  mode: "custom-oauth" as const,
                }
              },
            }
          },
        },
      ],
    },
  }
}
