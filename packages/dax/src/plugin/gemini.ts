import type { Hooks, PluginInput } from "@dax-ai/plugin"
import { Auth, OAUTH_DUMMY_KEY } from "@/auth"

const GEMINI_OAUTH_DOC = "https://ai.google.dev/gemini-api/docs/oauth"
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"
const GEMINI_CLI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const GOOGLE_SCOPE_CLOUD = "https://www.googleapis.com/auth/cloud-platform"
const GOOGLE_SCOPE_EMAIL = "https://www.googleapis.com/auth/userinfo.email"
const GOOGLE_SCOPE_PROFILE = "https://www.googleapis.com/auth/userinfo.profile"
const GOOGLE_SCOPE_GENERATIVE = "https://www.googleapis.com/auth/generative-language"
const OAUTH_PORT = 1717
const OAUTH_PORT_MAX = 1730
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000
const WAIT_MS = 2 * 60 * 1000
const WAIT_STEP_MS = 1500
const ACCESS_ONLY_PREFIX = "access-only:"

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
}

type OAuthState = {
  access?: string
  refresh: string
  expires: number
  clientID?: string
  clientSecret?: string
  quotaProjectID?: string
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
  if (cli?.access && cli?.refresh) return cli
  if (cli?.refresh) return cli
  if (adc?.refresh) return adc
  return undefined
}

const waitForCreds = async () => {
  const end = Date.now() + WAIT_MS
  while (Date.now() < end) {
    const creds = await readCreds()
    if (creds?.refresh) return creds
    await Bun.sleep(WAIT_STEP_MS)
  }
  return undefined
}

const latestOAuth = async (getAuth: () => Promise<Auth.Info | undefined>): Promise<OAuthState | undefined> => {
  const [stored, file] = await Promise.all([getAuth(), readCreds()])
  const oauth = stored?.type === "oauth" ? stored : undefined

  if (file?.refresh) {
    const fromFile: OAuthState = {
      refresh: file.refresh,
      access: file.access,
      expires: file.expires ?? 0,
      clientID: file.clientID,
      clientSecret: file.clientSecret,
      quotaProjectID: file.quotaProjectID,
    }
    // Prefer external CLI/ADC creds whenever available so import flow reflects
    // the latest login identity and scopes.
    return fromFile
  }

  return oauth
}

const refreshGoogleToken = async (refreshToken: string, clientID?: string, clientSecret?: string) => {
  if (refreshToken.startsWith(ACCESS_ONLY_PREFIX)) return undefined
  const id = clientID ?? Bun.env.DAX_GEMINI_OAUTH_CLIENT_ID ?? Bun.env.GEMINI_OAUTH_CLIENT_ID ?? GEMINI_CLI_CLIENT_ID
  const secret = clientSecret ?? Bun.env.DAX_GEMINI_OAUTH_CLIENT_SECRET ?? Bun.env.GEMINI_OAUTH_CLIENT_SECRET
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
  if (id) body.set("client_id", id)
  if (secret) body.set("client_secret", secret)
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
            return new Response(description || "Authorization failed. You can close this tab.", { status: 400 })
          }
          if (!code || !state) {
            return new Response("Authorization failed. You can close this tab.", { status: 400 })
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
        new Error(
          "OAuth login timed out. Use the latest DAX sign-in link and finish login in that same browser tab.",
        ),
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

const buildGoogleAuthorizeURL = (redirectURI: string, state: string, pkce: PkceCodes, clientID: string) => {
  const allowGenerative = Bun.env.DAX_GEMINI_SCOPE_GENERATIVE === "1"
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: clientID,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: redirectURI,
    response_type: "code",
    scope: [GOOGLE_SCOPE_CLOUD, GOOGLE_SCOPE_EMAIL, GOOGLE_SCOPE_PROFILE, ...(allowGenerative ? [GOOGLE_SCOPE_GENERATIVE] : [])].join(" "),
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

const checkTokenHealth = async (accessToken: string) => {
  const url = new URL(GOOGLE_TOKEN_INFO_URL)
  url.searchParams.set("access_token", accessToken)
  const result = await fetch(url).catch(() => undefined)
  if (!result?.ok) return { ok: false, reason: "token_expired" }
  const json = (await result.json().catch(() => ({}))) as { scope?: string }
  const scopes = json.scope ?? ""
  if (!scopes.includes(GOOGLE_SCOPE_CLOUD) && !scopes.includes(GOOGLE_SCOPE_GENERATIVE)) {
    return { ok: false, reason: "scope_missing" }
  }
  return { ok: true }
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
            let refresh = fresh?.refresh ?? current.refresh
            let expires = fresh?.expires ?? current.expires
            const quotaProjectID = fresh?.quotaProjectID

            if (!access || expires < Date.now() || Bun.env.DAX_GEMINI_SIMULATE_EXPIRE) {
              const fromFile = await readCreds()
              const renewed = await refreshGoogleToken(refresh, fromFile?.clientID, fromFile?.clientSecret)
              if (renewed) {
                access = renewed.access
                expires = renewed.expires
                await input.client.auth.set({
                  path: { id: "google" },
                  body: {
                    type: "oauth",
                    access,
                    refresh,
                    expires,
                  },
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
            const req = stripKey(request)
            const first = await fetch(req, { ...init, headers })

            // Handle 401 (Token Expired/Invalid) - Reactive Refresh
            if (first.status === 401) {
              const renewed = await refreshGoogleToken(refresh, fresh?.clientID, fresh?.clientSecret)
              if (renewed?.access) {
                await input.client.auth.set({
                  path: { id: "google" },
                  body: {
                    type: "oauth",
                    access: renewed.access,
                    refresh,
                    expires: renewed.expires,
                  },
                })
                const retryHeaders = new Headers(init?.headers)
                retryHeaders.delete("x-goog-api-key")
                retryHeaders.delete("X-Goog-Api-Key")
                retryHeaders.delete("authorization")
                retryHeaders.delete("Authorization")
                retryHeaders.set("Authorization", `Bearer ${renewed.access}`)
                if (quotaProjectID) retryHeaders.set("x-goog-user-project", quotaProjectID)
                return fetch(req, { ...init, headers: retryHeaders })
              }
            }

            const scopeError = await isScopeError(first)
            if (!scopeError) return first

            const candidates = [await readCliCreds(), await readAdcCreds()].filter((x) => !!x?.refresh)
            for (const imported of candidates) {
              if (!imported?.refresh) continue
              const renewed = await refreshGoogleToken(imported.refresh, imported.clientID, imported.clientSecret)
              if (!renewed?.access) continue
              await input.client.auth.set({
                path: { id: "google" },
                body: {
                  type: "oauth",
                  access: renewed.access,
                  refresh: imported.refresh,
                  expires: renewed.expires,
                },
              })
              const retryHeaders = new Headers(init?.headers)
              retryHeaders.delete("x-goog-api-key")
              retryHeaders.delete("X-Goog-Api-Key")
              retryHeaders.delete("authorization")
              retryHeaders.delete("Authorization")
              retryHeaders.set("Authorization", `Bearer ${renewed.access}`)
              if (imported.quotaProjectID) retryHeaders.set("x-goog-user-project", imported.quotaProjectID)
              const retried = await fetch(req, { ...init, headers: retryHeaders })
              const retryScopeError = await isScopeError(retried)
              if (!retryScopeError) return retried
            }
            return first
          },
        }
      },
      methods: [
        {
          type: "api",
          label: "Enter API Key",
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
          type: "oauth",
          label: "Use Gemini CLI login (import)",
          async authorize() {
            return {
              method: "auto" as const,
              url: GEMINI_OAUTH_DOC,
              instructions:
                "Run `gemini` and finish Google login (or run `gcloud auth application-default login`), then wait here while DAX imports credentials.",
              async callback() {
                const creds = await waitForCreds()
                if (!creds?.refresh) return { type: "failed" as const }
                let access = creds.access
                let expires = creds.expires ?? 0

                let health = access ? await checkTokenHealth(access) : { ok: false, reason: "token_expired" as const }

                if (!health.ok && health.reason === "token_expired") {
                  const renewed = await refreshGoogleToken(creds.refresh, creds.clientID, creds.clientSecret)
                  if (!renewed?.access) return { type: "failed" as const }
                  access = renewed.access
                  expires = renewed.expires
                  health = await checkTokenHealth(access)
                }

                if (!health.ok) {
                  if (health.reason === "scope_missing") throw new Error("Run gemini to login, then retry import.")
                  if (health.reason === "token_expired") throw new Error("Re-run gemini login.")
                  throw new Error(`Token validation failed: ${health.reason}`)
                }

                return {
                  type: "success" as const,
                  access: access!,
                  refresh: creds.refresh,
                  expires: expires || Date.now() + 30 * 60 * 1000,
                }
              },
            }
          },
        },
        {
          type: "oauth" as const,
          label: "Sign in with Google (email)",
          async authorize() {
            const customAuth = await Auth.get("google").then((x) => (x?.type === "oauth-custom" ? x : undefined))

            const clientID =
              customAuth?.clientID ??
              Bun.env.DAX_GEMINI_OAUTH_CLIENT_ID ??
              Bun.env.GEMINI_OAUTH_CLIENT_ID ??
              GEMINI_CLI_CLIENT_ID
            const redirectURI = await startOAuthServer()
            oauthCode.clear()
            const state = generateState()
            const pkce = await generatePKCE()
            return {
              method: "auto" as const,
              url: buildGoogleAuthorizeURL(redirectURI, state, pkce, clientID),
              instructions: "Complete sign-in in your browser. DAX will detect the localhost redirect automatically.",
              async callback() {
                const code = await waitForOAuthCode(state)
                const local = await readCreds()
                const token = await exchangeCodeForTokens(
                  code,
                  redirectURI,
                  pkce,
                  clientID,
                  customAuth?.clientSecret ?? local?.clientSecret,
                )

                if (!token.access_token) throw new Error("Token response missing access_token")

                const health = await checkTokenHealth(token.access_token)
                if (!health.ok) {
                  if (health.reason === "scope_missing")
                    throw new Error(
                      "Google account token is missing required scopes (cloud-platform or generative-language).",
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
                }
              },
            }
          },
        },
      ],
    },
  }
}
