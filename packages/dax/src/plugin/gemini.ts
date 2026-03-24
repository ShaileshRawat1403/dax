import type { Hooks, PluginInput } from "@dax-ai/plugin"
import { Auth, OAUTH_DUMMY_KEY } from "@/auth"

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
const getGoogleCliClientId = () => Bun.env.DAX_GOOGLE_CLI_CLIENT_ID ?? Bun.env.GEMINI_OAUTH_CLIENT_ID
const getGoogleCliClientSecret = () => Bun.env.DAX_GOOGLE_CLI_CLIENT_SECRET ?? Bun.env.GEMINI_OAUTH_CLIENT_SECRET

let cachedCloudCodeProjectId: string | undefined = undefined

async function resolveCloudCodeProject(accessToken: string): Promise<string> {
  if (cachedCloudCodeProjectId) return cachedCloudCodeProjectId

  const metadata = {
    ideType: "IDE_UNSPECIFIED",
    platform: "PLATFORM_UNSPECIFIED",
    pluginType: "GEMINI",
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": "GoogleCloud/1.0.0 (Windows NT 10.0; Win64; x64) GeminiCLI/0.34.0",
  }

  const loadRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist", {
    method: "POST",
    headers,
    body: JSON.stringify({ metadata }),
  }).catch(() => null)

  if (loadRes?.ok) {
    const data = await loadRes.json().catch(() => ({}))
    if (data.cloudaicompanionProject) {
      cachedCloudCodeProjectId = data.cloudaicompanionProject
      return cachedCloudCodeProjectId as string
    }
  }

  // Fallback onboard attempt if not loaded
  const onboardRes = await fetch("https://cloudcode-pa.googleapis.com/v1internal:onboardUser", {
    method: "POST",
    headers,
    body: JSON.stringify({ tierId: "free-tier", metadata }),
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

  cachedCloudCodeProjectId = "free-tier"
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
}

type OAuthState = {
  access?: string
  refresh: string
  expires: number
  clientID?: string
  clientSecret?: string
  quotaProjectID?: string
  accountId?: string // user email
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
  // Do not auto-import ADC for Gemini API ("google" provider). ADC is for
  // Vertex flows and usually yields cloud-platform scoped tokens that fail
  // against Gemini API auth requirements.
  // Import is allowed by default, can be disabled by setting DAX_GEMINI_ALLOW_ADC_IMPORT=0
  if (adc?.refresh && Bun.env.DAX_GEMINI_ALLOW_ADC_IMPORT !== "0") return adc
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

  // Prefer the credential explicitly stored in DAX auth state.
  // Falling back to CLI/ADC files can unintentionally override a freshly
  // completed "Sign in with Google (email)" flow with unrelated credentials.
  if (oauth?.refresh) {
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
    }
    // Prefer external CLI/ADC creds whenever available so import flow reflects
    // the latest login identity and scopes.
    return fromFile
  }

  return oauth
}

const refreshGoogleToken = async (refreshToken: string, clientID?: string, clientSecret?: string) => {
  if (refreshToken.startsWith(ACCESS_ONLY_PREFIX)) return undefined
  const id = clientID ?? Bun.env.DAX_GEMINI_OAUTH_CLIENT_ID ?? Bun.env.GEMINI_OAUTH_CLIENT_ID
  const secret = clientSecret ?? Bun.env.DAX_GEMINI_OAUTH_CLIENT_SECRET ?? Bun.env.GEMINI_OAUTH_CLIENT_SECRET
  if (!id || !secret) {
    throw new Error(
      "OAuth credentials required for token refresh. Provide client_id and client_secret:\n" +
        "  1. Create OAuth credentials at: https://console.cloud.google.com/apis/credentials/oauthclient\n" +
        "  2. Run: dax auth add --oauth-creds <path-to-client_secret.json>",
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
  }).catch((err) => {
    return undefined
  })
  if (!result?.ok) {
    return undefined
  }
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
              const renewed = await refreshGoogleToken(refresh, fresh?.clientID, fresh?.clientSecret)
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

            let req = stripKey(request)
            let reqBody = init?.body

            // Native DAX routing for Pro/Plus Subscriptions (Code Assist API)
            // If the user authenticated with the Gemini CLI client ID, the token requires
            // hitting the cloudcode-pa endpoint instead of the standard generativelanguage endpoint.
            if (fresh?.clientID === getGoogleCliClientId() && req.href.includes("generativelanguage.googleapis.com")) {
              const isStream = req.href.includes("streamGenerateContent")
              const action = isStream ? "streamGenerateContent" : "generateContent"
              req = new URL(`https://cloudcode-pa.googleapis.com/v1internal:${action}${isStream ? "?alt=sse" : ""}`)

              const resolvedProject = await resolveCloudCodeProject(access!)

              if (typeof reqBody === "string") {
                try {
                  const parsed = JSON.parse(reqBody)
                  const effectiveModel = parsed.model || "gemini-2.5-flash"
                  delete parsed.model

                  if (parsed.generationConfig && parsed.generationConfig.thinkingConfig) {
                    delete parsed.generationConfig.thinkingConfig
                  }

                  reqBody = JSON.stringify({
                    project: resolvedProject,
                    model: effectiveModel,
                    user_prompt_id: crypto.randomUUID(),
                    request: {
                      ...parsed,
                      session_id: crypto.randomUUID(),
                    },
                  })
                } catch (e) {}
              }
              // Code Assist API requires a specific User-Agent format
              headers.set("User-Agent", "GoogleCloud/1.0.0 (Windows NT 10.0; Win64; x64) GeminiCLI/0.34.0")
              headers.set("x-activity-request-id", crypto.randomUUID().substring(0, 16))
            }

            const executeFetch = async (fetchReq: URL, fetchHeaders: Headers, fetchBody: any) => {
              const response = await fetch(fetchReq, { ...init, headers: fetchHeaders, body: fetchBody })

              if (!response.ok && response.status === 429 && fetchReq.hostname === "cloudcode-pa.googleapis.com") {
                try {
                  const text = await response.text()
                  const json = JSON.parse(text)
                  const message = json.error?.message || ""
                  const match = message.match(/after (\d+)s/)
                  const retrySec = match ? parseInt(match[1], 10) : 15

                  const newHeaders = new Headers(response.headers)
                  newHeaders.set("Retry-After", retrySec.toString())
                  newHeaders.set("retry-after-ms", (retrySec * 1000).toString())

                  return new Response(text, {
                    status: 429,
                    statusText: response.statusText,
                    headers: newHeaders,
                  })
                } catch {
                  // Fallback to original response
                }
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

                  const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                      reader = response.body!.getReader()
                      const pump = (): void => {
                        reader!
                          .read()
                          .then(({ done, value }) => {
                            if (done) {
                              if (buffer.length > 0) {
                                if (buffer.startsWith("data:")) {
                                  try {
                                    const json = JSON.parse(buffer.slice(5).trim())
                                    if (json.response !== undefined) {
                                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(json.response)}\n`))
                                    } else {
                                      controller.enqueue(encoder.encode(buffer + "\n"))
                                    }
                                  } catch {
                                    controller.enqueue(encoder.encode(buffer + "\n"))
                                  }
                                } else {
                                  controller.enqueue(encoder.encode(buffer + "\n"))
                                }
                              }
                              controller.close()
                              return
                            }

                            buffer += decoder.decode(value, { stream: true })
                            let newlineIndex = buffer.indexOf("\n")
                            while (newlineIndex !== -1) {
                              const line = buffer.slice(0, newlineIndex)
                              buffer = buffer.slice(newlineIndex + 1)
                              const hasCr = line.endsWith("\r")
                              const rawLine = hasCr ? line.slice(0, -1) : line

                              if (rawLine.startsWith("data:")) {
                                try {
                                  const jsonText = rawLine.slice(5).trim()
                                  if (jsonText) {
                                    const json = JSON.parse(jsonText)
                                    if (json.response !== undefined) {
                                      controller.enqueue(
                                        encoder.encode(
                                          `data: ${JSON.stringify(json.response)}${hasCr ? "\r\n" : "\n"}`,
                                        ),
                                      )
                                    } else {
                                      controller.enqueue(encoder.encode(`${rawLine}${hasCr ? "\r\n" : "\n"}`))
                                    }
                                  } else {
                                    controller.enqueue(encoder.encode(`${rawLine}${hasCr ? "\r\n" : "\n"}`))
                                  }
                                } catch {
                                  controller.enqueue(encoder.encode(`${rawLine}${hasCr ? "\r\n" : "\n"}`))
                                }
                              } else {
                                controller.enqueue(encoder.encode(`${rawLine}${hasCr ? "\r\n" : "\n"}`))
                              }
                              newlineIndex = buffer.indexOf("\n")
                            }
                            pump()
                          })
                          .catch((err) => controller.error(err))
                      }
                      pump()
                    },
                    cancel(reason) {
                      if (reader) reader.cancel(reason).catch(() => {})
                    },
                  })

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

            const first = await executeFetch(req, headers, reqBody)

            // Handle 401 (Token Expired/Invalid) - Reactive Refresh
            if (first.status === 401) {
              const renewed = await refreshGoogleToken(refresh, fresh?.clientID, fresh?.clientSecret)
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
                  },
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

            const candidates = [
              await readCliCreds(),
              Bun.env.DAX_GEMINI_ALLOW_ADC_IMPORT !== "0" ? await readAdcCreds() : undefined,
            ].filter((x) => !!x?.refresh)
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
                },
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
                "Google (Gemini API) token is missing required Gemini OAuth scopes. Use Google provider with API key (recommended), or use 'Sign in with Google (email)' for Gemini API. If you authenticated with gcloud/ADC, use the Vertex provider instead.",
              )
            }
            if (invalidCredential) {
              return googleAuthHelpResponse(
                401,
                "Google (Gemini API) received invalid credentials for this flow. Use Google provider with Gemini API key or Gemini OAuth (Gemini OAuth scope). For gcloud ADC credentials, switch to Vertex provider.",
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
          type: "oauth",
          label: "Import from Gemini CLI",
          description: "Import your Google account from the `gemini` CLI. For Gemini Pro or Plus subscribers.",
          async authorize() {
            return {
              method: "auto" as const,
              url: GEMINI_OAUTH_DOC,
              instructions:
                "Run `gemini` and finish Google login, then wait here while DAX imports Gemini OAuth credentials.",
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
                  if (health.reason === "scope_missing") {
                    throw new Error(
                      "Imported token is missing Gemini scope. Use API key for Google provider, or use Sign in with Google. For gcloud credentials use Vertex provider.",
                    )
                  }
                  if (health.reason === "token_expired") throw new Error("Re-run gemini login.")
                  throw new Error(`Token validation failed: ${health.reason}`)
                }

                return {
                  type: "success" as const,
                  access: access!,
                  refresh: creds.refresh,
                  expires: expires || Date.now() + 30 * 60 * 1000,
                  clientID: creds.clientID,
                  clientSecret: creds.clientSecret,
                  quotaProjectID: creds.quotaProjectID,
                  accountId: health.ok ? (health as any).email : undefined,
                }
              },
            }
          },
        },
        {
          type: "oauth" as const,
          label: "Sign in with Google",
          description:
            "Sign in directly with your Google account. Use this for Gemini Pro or Plus subscriptions.\nRequires DAX_GOOGLE_CLI_CLIENT_ID and DAX_GOOGLE_CLI_CLIENT_SECRET env vars.",
          async authorize() {
            const clientID = getGoogleCliClientId()
            const clientSecret = getGoogleCliClientSecret()

            if (!clientID || !clientSecret) {
              throw new Error(
                "Sign in with Google requires DAX_GOOGLE_CLI_CLIENT_ID and DAX_GOOGLE_CLI_CLIENT_SECRET.\n" +
                  "Set these in your environment or use 'Your Google OAuth Client' option.",
              )
            }

            const redirectURI = await startOAuthServer()
            oauthCode.clear()
            const state = generateState()
            const pkce = await generatePKCE()
            return {
              method: "auto" as const,
              url: buildGoogleAuthorizeURL(redirectURI, state, pkce, clientID, "compat"),
              instructions: "Complete sign-in in your browser. DAX will detect the localhost redirect automatically.",
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
                  accountId: (health as any).email,
                }
              },
            }
          },
        },
        {
          type: "oauth" as const,
          label: "Your Google OAuth Client",
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
            const customAuth = await Auth.get("google").then((x: Auth.Info | undefined) =>
              x?.type === "oauth-custom" ? x : undefined,
            )

            const clientID =
              inputs.clientID ||
              customAuth?.clientID ||
              Bun.env.DAX_GEMINI_OAUTH_CLIENT_ID ||
              Bun.env.GEMINI_OAUTH_CLIENT_ID
            const clientSecret = inputs.clientSecret || customAuth?.clientSecret

            if (!clientID || !clientSecret) {
              throw new Error(
                "OAuth credentials required. Please provide both Client ID and Client Secret.\n" +
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
                  accountId: (health as any).email,
                }
              },
            }
          },
        },
      ],
    },
  }
}
