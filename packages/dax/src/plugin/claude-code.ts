import type { Hooks, PluginInput, Plugin as PluginInstance } from "@dax-ai/plugin"

export async function ClaudeCodeAuthPlugin(input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "claude-code",
      async loader(getAuth) {
        const info = await getAuth()
        if (!info) return {}

        if (info.type === "api") {
          return { apiKey: info.key }
        }

        if (info.type === "oauth") {
          return {
            apiKey: "claude-code-oauth-dummy",
            async fetch(request: RequestInfo | URL, init?: RequestInit) {
              const fresh = await getAuth()
              if (!fresh || fresh.type !== "oauth") {
                return typeof fetch === "function" ? fetch(request, init) : {}
              }

              let access = fresh.access
              if (!access || fresh.expires < Date.now()) {
                if (fresh.refresh) {
                  const renewed = await refreshClaudeCodeToken(fresh.refresh)
                  if (renewed?.access) {
                    access = renewed.access
                    await input.client.auth.set({
                      providerID: "claude-code",
                      auth: {
                        type: "oauth",
                        access,
                        refresh: fresh.refresh,
                        expires: renewed.expires,
                        accountId: fresh.accountId,
                      },
                    })
                  }
                }
              }

              const headers = new Headers(init?.headers)
              headers.delete("x-api-key")
              headers.delete("X-Api-Key")
              headers.delete("authorization")
              headers.delete("Authorization")
              if (access) headers.set("Authorization", `Bearer ${access}`)

              const urlString = typeof request === "string" ? request : String(request)
              const baseUrl = "https://api.anthropic.com"
              const fullUrl = urlString.startsWith("http") ? urlString : `${baseUrl}${urlString}`

              return fetch(fullUrl, { ...init, headers })
            },
          }
        }

        return {}
      },
      methods: [
        {
          type: "api",
          label: "Claude Code API Key",
          description: "Use your API key from console.anthropic.com. Best for API usage tracking.",
          prompts: [
            {
              key: "key",
              type: "text",
              message: "Enter your Claude Code API Key",
              validate: (x: string) => (x && x.length > 0 ? undefined : "Required"),
            },
          ],
          async authorize(inputs: { key: string }) {
            return {
              type: "success" as const,
              key: inputs.key,
            }
          },
        },
        {
          type: "oauth" as const,
          label: "Claude Pro/Plus Subscription",
          description:
            "Sign in with your Anthropic subscription for Claude Code Pro or Plus.\n" +
            "Requires DAX_CLAUDE_CODE_CLIENT_ID and DAX_CLAUDE_CODE_CLIENT_SECRET env vars.",
          async authorize() {
            const clientID = process.env.DAX_CLAUDE_CODE_CLIENT_ID
            const clientSecret = process.env.DAX_CLAUDE_CODE_CLIENT_SECRET

            if (!clientID || !clientSecret) {
              throw new Error(
                "Claude Pro/Plus sign-in requires DAX_CLAUDE_CODE_CLIENT_ID and DAX_CLAUDE_CODE_CLIENT_SECRET.\n" +
                  "Set these in your environment. These are your OAuth credentials from Anthropic.",
              )
            }

            const redirectURI = "http://localhost:3456/auth/claude-code/callback"
            const state = `claude-code-${Date.now()}`
            const codeVerifier = generateCodeVerifier()
            const codeChallenge = await generateCodeChallenge(codeVerifier)

            const authUrl = new URL("https://auth.anthropic.com/oauth/authorize")
            authUrl.searchParams.set("client_id", clientID)
            authUrl.searchParams.set("redirect_uri", redirectURI)
            authUrl.searchParams.set("response_type", "code")
            authUrl.searchParams.set("scope", "api:read api:write")
            authUrl.searchParams.set("state", state)
            authUrl.searchParams.set("code_challenge", codeChallenge)
            authUrl.searchParams.set("code_challenge_method", "S256")

            return {
              method: "auto" as const,
              url: authUrl.toString(),
              instructions: "Complete sign-in in your browser. DAX will detect the redirect automatically.",
              async callback() {
                const code = await waitForCallback(state, redirectURI)
                if (!code) return { type: "failed" as const }

                const tokenUrl = "https://auth.anthropic.com/oauth/token"
                const tokenResponse = await fetch(tokenUrl, {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded" },
                  body: new URLSearchParams({
                    grant_type: "authorization_code",
                    code,
                    client_id: clientID,
                    client_secret: clientSecret,
                    redirect_uri: redirectURI,
                    code_verifier: codeVerifier,
                  }),
                })

                if (!tokenResponse.ok) {
                  const err = await tokenResponse.text()
                  throw new Error(`Token exchange failed: ${err}`)
                }

                const token = await tokenResponse.json()
                if (!token.access_token) {
                  throw new Error("Token response missing access_token")
                }

                return {
                  type: "success" as const,
                  access: token.access_token,
                  refresh: token.refresh_token ?? "",
                  expires: Date.now() + (token.expires_in ?? 3600) * 1000,
                  accountId: token.user_id ?? "unknown",
                }
              },
            }
          },
        },
      ],
    },
  }
}

async function refreshClaudeCodeToken(refreshToken: string): Promise<{ access: string; expires: number } | null> {
  const clientID = process.env.DAX_CLAUDE_CODE_CLIENT_ID
  const clientSecret = process.env.DAX_CLAUDE_CODE_CLIENT_SECRET

  if (!clientID || !clientSecret) return null

  try {
    const response = await fetch("https://auth.anthropic.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientID,
        client_secret: clientSecret,
      }),
    })

    if (!response.ok) return null

    const token = await response.json()
    return {
      access: token.access_token,
      expires: Date.now() + (token.expires_in ?? 3600) * 1000,
    }
  } catch {
    return null
  }
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
}

function waitForCallback(state: string, redirectURI: string): Promise<string | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 120000)
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:3456/auth/claude-code/state/${state}`)
        if (response.ok) {
          const data = await response.json()
          if (data.code) {
            clearInterval(interval)
            clearTimeout(timeout)
            resolve(data.code)
          }
        }
      } catch {
        // Continue polling
      }
    }, 1000)
  })
}
