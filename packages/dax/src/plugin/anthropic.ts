import type { Hooks, PluginInput } from "@dax-ai/plugin"
import { Log } from "../util/log"
import { iife } from "@/util/iife"

const log = Log.create({ service: "plugin.anthropic" })

const CLIENT_ID = process.env.DAX_ANTHROPIC_CLIENT_ID ?? "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
const TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
const API_KEY_URL = "https://api.anthropic.com/api/oauth/claude_cli/create_api_key"
const SCOPES = "user:inference user:profile"

const OAUTH_PORT = 1746
const OAUTH_CALLBACK_PATH = "/callback"

const FAKE_ACCESS_TOKEN = "subscription-detected"

interface PkceCodes {
  verifier: string
  challenge: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

interface PendingOAuth {
  state: string
  pkce: PkceCodes
  redirectUri: string
  resolve: (code: string) => void
  reject: (err: Error) => void
}

let oauthServer: ReturnType<typeof Bun.serve> | undefined
let pendingOAuth: PendingOAuth | undefined

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
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

function generateState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

const HTML_SUCCESS = `<!doctype html>
<html>
  <head>
    <title>DAX – Authorization Successful</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex;
             justify-content: center; align-items: center; height: 100vh;
             margin: 0; background: #131010; color: #f1ecec; }
      .container { text-align: center; padding: 2rem; }
      h1 { color: #f1ecec; margin-bottom: 1rem; }
      p  { color: #b7b1b1; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Successful</h1>
      <p>You can close this window and return to DAX.</p>
    </div>
    <script>setTimeout(() => window.close(), 2000)</script>
  </body>
</html>`

const HTML_ERROR = (msg: string) => `<!doctype html>
<html>
  <head>
    <title>DAX – Authorization Failed</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; display: flex;
             justify-content: center; align-items: center; height: 100vh;
             margin: 0; background: #131010; color: #f1ecec; }
      .container { text-align: center; padding: 2rem; }
      h1 { color: #fc533a; margin-bottom: 1rem; }
      p  { color: #b7b1b1; }
      .error { color: #ff917b; font-family: monospace; margin-top: 1rem;
               padding: 1rem; background: #3c140d; border-radius: .5rem; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization Failed</h1>
      <p>An error occurred during authorization.</p>
      <div class="error">${msg}</div>
    </div>
  </body>
</html>`

function startOAuthServer(): string {
  const redirectUri = `http://localhost:${OAUTH_PORT}${OAUTH_CALLBACK_PATH}`
  if (oauthServer) return redirectUri

  oauthServer = Bun.serve({
    port: OAUTH_PORT,
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === OAUTH_CALLBACK_PATH) {
        const code = url.searchParams.get("code")
        const state = url.searchParams.get("state")
        const error = url.searchParams.get("error")
        const errorDescription = url.searchParams.get("error_description")

        if (error) {
          const msg = errorDescription || error
          pendingOAuth?.reject(new Error(msg))
          pendingOAuth = undefined
          return new Response(HTML_ERROR(msg), { headers: { "Content-Type": "text/html" } })
        }

        if (!code) {
          const msg = "Missing authorization code"
          pendingOAuth?.reject(new Error(msg))
          pendingOAuth = undefined
          return new Response(HTML_ERROR(msg), { status: 400, headers: { "Content-Type": "text/html" } })
        }

        if (!pendingOAuth || state !== pendingOAuth.state) {
          const msg = "Invalid state parameter"
          pendingOAuth?.reject(new Error(msg))
          pendingOAuth = undefined
          return new Response(HTML_ERROR(msg), { status: 400, headers: { "Content-Type": "text/html" } })
        }

        const current = pendingOAuth
        pendingOAuth = undefined
        current.resolve(code)

        return new Response(HTML_SUCCESS, { headers: { "Content-Type": "text/html" } })
      }

      if (url.pathname === "/cancel") {
        pendingOAuth?.reject(new Error("Login cancelled"))
        pendingOAuth = undefined
        return new Response("Login cancelled", { status: 200 })
      }

      return new Response("Not found", { status: 404 })
    },
  })

  log.info("anthropic oauth server started", { port: OAUTH_PORT })
  return redirectUri
}

function stopOAuthServer() {
  if (oauthServer) {
    oauthServer.stop()
    oauthServer = undefined
    log.info("anthropic oauth server stopped")
  }
}

function waitForCode(pkce: PkceCodes, state: string, redirectUri: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingOAuth) {
        pendingOAuth = undefined
        reject(new Error("OAuth login timed out — please try again"))
      }
    }, 5 * 60 * 1000)

    pendingOAuth = {
      state,
      pkce,
      redirectUri,
      resolve: (code) => { clearTimeout(timeout); resolve(code) },
      reject:  (err)  => { clearTimeout(timeout); reject(err) },
    }
  })
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  pkce: PkceCodes,
  state: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
      state,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Token exchange failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<TokenResponse>
}

async function refreshAnthropicToken(
  refreshToken: string,
): Promise<{ access: string; expires: number } | undefined> {
  if (!refreshToken) return undefined
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
      }),
    })
    if (!res.ok) {
      log.warn("anthropic token refresh failed", { status: res.status })
      return undefined
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!data.access_token) return undefined
    return {
      access: data.access_token,
      expires: Date.now() + (data.expires_in ?? 3600) * 1000,
    }
  } catch {
    return undefined
  }
}

export async function AnthropicAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",

      async loader(getAuth) {
        const info = await getAuth()
        if (!info) return {}

        if (info.type === "api") {
          return { apiKey: info.key }
        }

        if (info.type === "oauth") {
          if (!info.access || info.access === FAKE_ACCESS_TOKEN) return {}

          return {
            apiKey: "anthropic-oauth-dummy",
            async fetch(request: RequestInfo | URL, init?: RequestInit) {
              const current = await getAuth()
              if (!current || current.type !== "oauth") return fetch(request, init)

              let access = current.access
              const refresh = current.refresh
              let expires = current.expires

              // Refresh the access token if expired or within 60 s of expiry
              if (!access || expires - 60_000 < Date.now()) {
                const renewed = await refreshAnthropicToken(refresh)
                if (renewed) {
                  access = renewed.access
                  expires = renewed.expires
                  await input.client.auth.set({
                    providerID: "anthropic",
                    auth: { type: "oauth", access, refresh, expires } as any,
                  })
                  log.info("anthropic oauth: access token refreshed")
                }
              }

              const headers = new Headers(init?.headers)
              headers.delete("x-api-key")
              headers.delete("X-Api-Key")
              headers.delete("authorization")
              headers.delete("Authorization")
              if (access && access !== FAKE_ACCESS_TOKEN) {
                headers.set("Authorization", `Bearer ${access}`)
              }
              const existingBeta = headers.get("anthropic-beta")
              const betaFlags = new Set(existingBeta ? existingBeta.split(",").map((s) => s.trim()) : [])
              betaFlags.add("oauth-2025-04-20")
              betaFlags.add("claude-code-20250219")
              betaFlags.add("interleaved-thinking-2025-05-14")
              betaFlags.add("fine-grained-tool-streaming-2025-05-14")
              headers.set("anthropic-beta", [...betaFlags].join(","))

              const urlStr = iife(() => {
                if (request instanceof URL) return request.href
                if (request instanceof Request) return request.url
                return String(request)
              })
              const fullUrl = urlStr.startsWith("http") ? urlStr : `https://api.anthropic.com${urlStr}`
              return fetch(fullUrl, { ...init, headers })
            },
          }
        }

        return {}
      },

      methods: [
        {
          type: "oauth" as const,
          label: "Claude Pro/Max Sign-In",
          description:
            "Sign in with your Anthropic account (email) to use Claude with your Pro or Max subscription. " +
            "A browser window will open — no API key needed.",

          async authorize() {
            const redirectUri = startOAuthServer()
            const pkce = await generatePKCE()
            const state = generateState()

            const codePromise = waitForCode(pkce, state, redirectUri)

            const params = new URLSearchParams({
              response_type: "code",
              client_id: CLIENT_ID,
              redirect_uri: redirectUri,
              scope: SCOPES,
              code_challenge: pkce.challenge,
              code_challenge_method: "S256",
              state,
            })

            return {
              url: `${AUTHORIZE_URL}?${params.toString()}`,
              instructions:
                "1. Sign in with your Anthropic email in the browser that opens.\n" +
                "2. Approve the access request.\n" +
                "3. Once you see 'Authorization Successful', return to DAX.",
              method: "auto" as const,

              async callback() {
                try {
                  const code = await codePromise
                  const tokens = await exchangeCode(code, redirectUri, pkce, state)
                  stopOAuthServer()
                  return {
                    type: "success" as const,
                    access: tokens.access_token,
                    refresh: tokens.refresh_token ?? "",
                    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  }
                } catch (err) {
                  stopOAuthServer()
                  throw err
                }
              },
            }
          },
        },

        {
          type: "api",
          label: "API Key",
          description: "Enter an API key from console.anthropic.com.",
          prompts: [
            {
              key: "key",
              type: "text",
              message: "Enter your Anthropic API Key",
              validate: (x: string) => (x?.length > 0 ? undefined : "Required"),
            },
          ],
          async authorize(inputs: { key: string }) {
            return { type: "success" as const, key: inputs.key }
          },
        },
      ],
    },
  }
}
