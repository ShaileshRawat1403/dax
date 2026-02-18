import type { Hooks, PluginInput } from "@dax-ai/plugin"
import { Auth, OAUTH_DUMMY_KEY } from "@/auth"

const GEMINI_OAUTH_DOC = "https://ai.google.dev/gemini-api/docs/oauth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"

const credsPaths = () =>
  [
    Bun.env.GEMINI_OAUTH_CREDS_PATH,
    `${Bun.env.HOME ?? ""}/.gemini/oauth_creds.json`,
    `${Bun.env.HOME ?? ""}/.config/gemini/oauth_creds.json`,
    `${Bun.env.HOME ?? ""}/.config/google-gemini/oauth_creds.json`,
  ].filter(Boolean) as string[]

type CliCreds = {
  access_token?: string
  refresh_token?: string
  expiry_date?: number
  client_id?: string
}

const readCreds = async () => {
  for (const item of credsPaths()) {
    const creds = await Bun.file(item)
      .json()
      .then((x) => x as CliCreds)
      .catch(() => undefined)
    if (creds?.access_token && creds?.refresh_token) return creds
  }
  return undefined
}

const latestOAuth = async (getAuth: () => Promise<Auth.Info | undefined>) => {
  const [stored, file] = await Promise.all([getAuth(), readCreds()])
  const oauth = stored?.type === "oauth" ? stored : undefined
  const fromFile =
    file?.access_token && file?.refresh_token
      ? {
          access: file.access_token,
          refresh: file.refresh_token,
          expires: file.expiry_date ?? 0,
          clientID: file.client_id,
        }
      : undefined
  if (!oauth && !fromFile) return undefined
  if (!oauth && fromFile) return fromFile
  if (oauth && !fromFile) return { access: oauth.access, refresh: oauth.refresh, expires: oauth.expires }
  if (!oauth || !fromFile) return undefined
  if (fromFile.expires > oauth.expires) return fromFile
  return { access: oauth.access, refresh: oauth.refresh, expires: oauth.expires }
}

const refreshGoogleToken = async (refreshToken: string, clientID?: string) => {
  const id = clientID ?? Bun.env.GOOGLE_OAUTH_CLIENT_ID ?? Bun.env.GEMINI_OAUTH_CLIENT_ID
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
  if (id) body.set("client_id", id)
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

            if (!access || expires < Date.now()) {
              const fromCli = await readCreds()
              const renewed = await refreshGoogleToken(refresh, fromCli?.client_id)
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

            return fetch(stripKey(request), { ...init, headers })
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Use Gemini CLI login",
          async authorize() {
            return {
              method: "auto" as const,
              url: GEMINI_OAUTH_DOC,
              instructions: "Sign in with `gemini`, then return here to import your local Gemini CLI session.",
              async callback() {
                const creds = await readCreds()
                if (!creds?.access_token || !creds?.refresh_token) return { type: "failed" as const }
                const valid = await validateGoogleAccessToken(creds.access_token)
                if (!valid) {
                  const renewed = await refreshGoogleToken(creds.refresh_token, creds.client_id)
                  if (!renewed?.access) return { type: "failed" as const }
                  const renewedValid = await validateGoogleAccessToken(renewed.access)
                  if (!renewedValid) return { type: "failed" as const }
                  return {
                    type: "success" as const,
                    access: renewed.access,
                    refresh: creds.refresh_token,
                    expires: renewed.expires,
                  }
                }
                return {
                  type: "success" as const,
                  access: creds.access_token,
                  refresh: creds.refresh_token,
                  expires: creds.expiry_date ?? Date.now() + 30 * 60 * 1000,
                }
              },
            }
          },
        },
      ],
    },
  }
}
