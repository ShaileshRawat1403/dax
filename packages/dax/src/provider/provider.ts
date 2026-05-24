import { Provider, ModelsDev, ProviderTransform, inject } from "@dax-ai/provider"
import { Log } from "../util/log"
import { Env } from "../env"
import { Auth } from "../auth"
import { Config } from "../config/config"
import { Plugin } from "../plugin"
import { BunProc } from "../bun"

// Create a logger instance mapping to the new ProviderLogger interface
const log = Log.create({ service: "provider" })
const providerLog = {
  info: (msg: string, extra?: any) => log.info(msg, extra),
  debug: (msg: string, extra?: any) => log.debug(msg, extra),
  error: (msg: string, extra?: any) => log.error(msg, extra),
  time: (msg: string, extra?: any) => log.time(msg, extra),
}

// Inject DAX-specific implementations into the shared provider
inject({
  log: providerLog,
  env: Env,
  auth: {
    get: async (id: string) => Auth.get(id),
    all: async () => Auth.all(),
  },
  config: {
    get: async () => Config.get(),
  },
  plugins: [], // Plugins are loaded dynamically in the DAX app
  installPackage: async (pkg: string, version: string) => {
    return BunProc.install(pkg, version)
  }
})

// Load plugins asynchronously after initial injection (since Plugin.list() is async)
Plugin.list().then(plugins => {
  inject({ plugins })
}).catch(() => {})

export { Provider, ModelsDev, ProviderTransform }

