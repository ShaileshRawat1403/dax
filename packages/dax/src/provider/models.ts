import { ModelsDev as SharedModelsDev } from "@dax-ai/provider"
import { Global } from "../global"
import path from "path"
import { Flag } from "../flag/flag"
import { Installation } from "../installation"
import { Log } from "../util/log"

const log = Log.create({ service: "models.dev" })
const filepath = path.join(Global.Path.cache, "models.json")

function url() {
  return Flag.DAX_MODELS_URL || "https://models.dev"
}

// Inject DAX's custom fetching and caching logic
SharedModelsDev.inject({
  fetcher: async () => {
    if (Flag.DAX_DISABLE_MODELS_FETCH) return {}
    const file = Bun.file(Flag.DAX_MODELS_PATH ?? filepath)
    const result = await file.json().catch(() => {})
    if (result) return result
    // Fall back to snapshot if available (handled by shared logic, but we can do it here too)
    return undefined
  }
})

export namespace ModelsDev {
  export const Model = SharedModelsDev.Model
  export type Model = SharedModelsDev.Model
  export const Provider = SharedModelsDev.Provider
  export type Provider = SharedModelsDev.Provider
  export const Data = SharedModelsDev.Data
  export const get = SharedModelsDev.get

  export async function refresh() {
    const file = Bun.file(filepath)
    const result = await fetch(`${url()}/api.json`, {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (result && result.ok) {
      await Bun.write(file, await result.text())
      SharedModelsDev.Data.reset()
    }
  }

  export function init() {
    if (Flag.DAX_DISABLE_MODELS_FETCH) return
    refresh()
    setInterval(
      async () => {
        await refresh()
      },
      60 * 1000 * 60,
    ).unref()
  }
}
