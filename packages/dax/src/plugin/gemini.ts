import type { Hooks, PluginInput } from "@dax-ai/plugin"
import { Auth, OAUTH_DUMMY_KEY } from "@/auth"

const GEMINI_OAUTH_DOC = "https://ai.google.dev/gemini-api/docs/oauth"
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"
const GEMINI_CLI_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
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
let oauthCodeLatest: string | undefined

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
  const fromFile: OAuthState | undefined = file?.refresh
    ? {
        access: file.access,
        refresh: file.refresh,
        expires: file.expires ?? 0,
        clientID: file.clientID,
        clientSecret: file.clientSecret,
        quotaProjectID: file.quotaProjectID,
      }
    : undefined
  if (!oauth && !fromFile) return undefined
  if (!oauth && fromFile) return fromFile
  if (oauth && !fromFile)
    return { access: oauth.access, refresh: oauth.refresh, expires: oauth.expires, quotaProjectID: undefined }
  if (!oauth || !fromFile) return undefined
  if (fromFile.expires > oauth.expires) return fromFile
  return { access: oauth.access, refresh: oauth.refresh, expires: oauth.expires, quotaProjectID: undefined }
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
  const json = (await result.json().catch(() => undefined)) as { access_token?: string; expires_in?: number } | undefined
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
          oauthCodeLatest = code
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
      if (oauthCodeLatest) {
        const latest = oauthCodeLatest
        oauthCodeLatest = undefined
        oauthCode.clear()
        clearInterval(timer)
        resolve(latest)
        return
      }
      if (Date.now() < end) return
      clearInterval(timer)
      reject(new Error("OAuth login timed out"))
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
  }).catch(() => undefined)
  if (!result?.ok) return undefined
  return result.json().then((x) => x as TokenResponse).catch(() => undefined)
}

const buildGoogleAuthorizeURL = (redirectURI: string, state: string, pkce: PkceCodes, clientID: string) => {
  const params = new URLSearchParams({
    access_type: "offline",
    client_id: clientID,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    prompt: "consent",
    redirect_uri: redirectURI,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ].join(" "),
    state,
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

const validateGoogleAccessToken = async (accessToken: string) => {
  const url = new URL(GOOGLE_TOKEN_INFO_URL)
  url.searchParams.set("access_token", accessToken)
  const result = await fetch(url)
    .then((x) => x)
    .catch(() => undefined)
  return !!result?.ok
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

            if (!access || expires < Date.now()) {
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
          type: "oauth" as const,
          label: "Sign in with Google (email)",
          async authorize() {
            const clientID =
              Bun.env.DAX_GEMINI_OAUTH_CLIENT_ID ?? Bun.env.GEMINI_OAUTH_CLIENT_ID ?? GEMINI_CLI_CLIENT_ID
            const redirectURI = await startOAuthServer()
            oauthCode.clear()
            oauthCodeLatest = undefined
            const state = generateState()
            const pkce = await generatePKCE()
            return {
              method: "auto" as const,
              url: buildGoogleAuthorizeURL(redirectURI, state, pkce, clientID),
              instructions: "Complete sign-in in your browser. DAX will detect the localhost redirect automatically.",
              async callback() {
                const code = await waitForOAuthCode(state).catch(() => undefined)
                if (!code) return { type: "failed" as const }
                const local = await readCreds()
                const token = await exchangeCodeForTokens(code, redirectURI, pkce, clientID, local?.clientSecret)
                const current = await readCreds()
                const access = token?.access_token
                const refresh = token?.refresh_token ?? current?.refresh
                if (!access) {
                  const imported = await waitForCreds()
                  if (!imported?.refresh) return { type: "failed" as const }
                  let importedAccess = imported.access
                  let importedExpires = imported.expires ?? 0
                  if (!importedAccess || importedExpires < Date.now()) {
                    const renewed = await refreshGoogleToken(imported.refresh, imported.clientID, imported.clientSecret)
                    if (!renewed?.access) return { type: "failed" as const }
                    importedAccess = renewed.access
                    importedExpires = renewed.expires
                  }
                  return {
                    type: "success" as const,
                    access: importedAccess,
                    refresh: imported.refresh,
                    expires: importedExpires || Date.now() + 30 * 60 * 1000,
                  }
                }
                await validateGoogleAccessToken(access).catch(() => undefined)
                return {
                  type: "success" as const,
                  access,
                  refresh: refresh ?? `${ACCESS_ONLY_PREFIX}${Date.now()}`,
                  expires: Date.now() + (token.expires_in ?? 3600) * 1000,
                }
              },
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
                if (!access || expires < Date.now()) {
                  const renewed = await refreshGoogleToken(creds.refresh, creds.clientID, creds.clientSecret)
                  if (!renewed?.access) return { type: "failed" as const }
                  access = renewed.access
                  expires = renewed.expires
                }
                const valid = await validateGoogleAccessToken(access)
                if (!valid) {
                  const renewed = await refreshGoogleToken(creds.refresh, creds.clientID, creds.clientSecret)
                  if (!renewed?.access) return { type: "failed" as const }
                  await validateGoogleAccessToken(renewed.access).catch(() => undefined)
                  return {
                    type: "success" as const,
                    access: renewed.access,
                    refresh: creds.refresh,
                    expires: renewed.expires,
                  }
                }
                return {
                  type: "success" as const,
                  access,
                  refresh: creds.refresh,
                  expires: expires || Date.now() + 30 * 60 * 1000,
                }
              },
            }
          },
        },
      ],
    },
  }
}
