import { Instance } from "@/project/instance"
import { Plugin } from "../plugin"
import { map, filter, pipe, fromEntries, mapValues } from "remeda"
import z from "zod"
import { fn } from "@/util/fn"
import type { AuthOuathResult, Hooks } from "@dax-ai/plugin"
import { NamedError } from "@dax-ai/util/error"
import { Auth } from "@/auth"

export namespace ProviderAuth {
  const state = Instance.state(async () => {
    const methods = pipe(
      await Plugin.list(),
      filter((x) => x.auth?.provider !== undefined),
      map((x) => [x.auth!.provider, x.auth!] as const),
      fromEntries(),
    )
    return { methods, pending: {} as Record<string, AuthOuathResult> }
  })

  export const Prompt = z
    .object({
      key: z.string(),
      type: z.string(),
      message: z.string(),
      placeholder: z.string().optional(),
    })
    .meta({ ref: "ProviderAuthPrompt" })

  export const Method = z
    .object({
      type: z.union([z.literal("oauth"), z.literal("api")]),
      label: z.string(),
      description: z.string().optional(),
      prompts: z.array(Prompt).optional(),
    })
    .meta({
      ref: "ProviderAuthMethod",
    })
  export type Method = z.infer<typeof Method>

  export async function methods() {
    const s = await state()
    return mapValues(s.methods, (x) =>
      x.methods.map(
        (y): Method => ({
          type: y.type,
          label: y.label,
          description: y.description,
          prompts: y.prompts?.map((p) => {
            if (p.type === "text") {
              return {
                key: p.key,
                type: "text" as const,
                message: p.message,
                placeholder: p.placeholder,
              }
            }
            return {
              key: p.key,
              type: "select" as const,
              message: p.message,
            }
          }),
        }),
      ),
    )
  }

  export const Authorization = z
    .object({
      url: z.string(),
      method: z.union([z.literal("auto"), z.literal("code")]),
      instructions: z.string(),
    })
    .meta({
      ref: "ProviderAuthAuthorization",
    })
  export type Authorization = z.infer<typeof Authorization>

  export const authorize = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      inputs: z.record(z.string(), z.string()).optional(),
    }),
    async (input): Promise<Authorization | undefined> => {
      const auth = await state().then((s) => s.methods[input.providerID])
      const method = auth.methods[input.method]
      if (method.type === "oauth") {
        const inputs = input.inputs ?? {}
        const result = await method.authorize(inputs)
        await state().then((s) => (s.pending[input.providerID] = result))
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      }
    },
  )

  export const callback = fn(
    z.object({
      providerID: z.string(),
      method: z.number(),
      code: z.string().optional(),
    }),
    async (input) => {
      const match = await state().then((s) => s.pending[input.providerID])
      if (!match) throw new OauthMissing({ providerID: input.providerID })
      let result

      if (match.method === "code") {
        if (!input.code) throw new OauthCodeMissing({ providerID: input.providerID })
        result = await match.callback(input.code)
      }

      if (match.method === "auto") {
        result = await match.callback()
      }

      if (result?.type === "success") {
        if ("key" in result) {
          await Auth.set(input.providerID, {
            type: "api",
            key: result.key,
          })
        }
        if ("refresh" in result) {
          const info: Auth.Info = {
            type: "oauth",
            access: result.access,
            refresh: result.refresh,
            expires: result.expires,
          }
          if (result.accountId) info.accountId = result.accountId
          if (result.clientID) info.clientID = result.clientID
          if (result.clientSecret) info.clientSecret = result.clientSecret
          if (result.mode) info.mode = result.mode
          await Auth.set(input.providerID, info)
        }
        return
      }

      // Callback returned "failed" — auth is not ready yet (e.g. CLI import
      // waiting for the user to run `gemini`). Throw OauthMissing so the TUI
      // shows "Authorization not ready, press r to retry" instead of a fatal error.
      throw new OauthMissing({ providerID: input.providerID })
    },
  )

  export const api = fn(
    z.object({
      providerID: z.string(),
      key: z.string(),
    }),
    async (input) => {
      await Auth.set(input.providerID, {
        type: "api",
        key: input.key,
      })
    },
  )

  export const OauthMissing = NamedError.create(
    "ProviderAuthOauthMissing",
    z.object({
      providerID: z.string(),
    }),
  )
  export const OauthCodeMissing = NamedError.create(
    "ProviderAuthOauthCodeMissing",
    z.object({
      providerID: z.string(),
    }),
  )

  export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))
}
