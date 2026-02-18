import type { Hooks, PluginInput } from "@dax-ai/plugin"
import { Auth, OAUTH_DUMMY_KEY } from "@/auth"

const GEMINI_OAUTH_DOC = "https://ai.google.dev/gemini-api/docs/oauth"
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"
const WAIT_MS = 2 * 60 * 1000
const WAIT_STEP_MS = 1500

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
  const id = clientID ?? Bun.env.GOOGLE_OAUTH_CLIENT_ID ?? Bun.env.GEMINI_OAUTH_CLIENT_ID
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
  if (id) body.set("client_id", id)
  if (clientSecret) body.set("client_secret", clientSecret)
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
                  const renewedValid = await validateGoogleAccessToken(renewed.access)
                  if (!renewedValid) return { type: "failed" as const }
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
