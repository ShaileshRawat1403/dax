import type { Hooks, PluginInput, Plugin as PluginInstance } from "@dax-ai/plugin"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { Log } from "../util/log"
import { createDaxClient } from "@dax-ai/sdk"
import { Server } from "../server/server"
import { BunProc } from "../bun"
import { Instance } from "../project/instance"
import { Flag } from "../flag/flag"
import { CodexAuthPlugin } from "./codex"
import { Session } from "../session"
import { NamedError } from "@dax-ai/util/error"
import { GeminiAuthPlugin } from "./gemini"
import { AnthropicAuthPlugin } from "./anthropic"
import * as ProjectTrust from "../project/trust"

export namespace Plugin {
  const log = Log.create({ service: "plugin" })

  const BUILTIN: string[] = []

  // Built-in plugins that are directly imported (not installed from npm).
  // Most plugin hooks remain experimental unless they are called out in docs
  // as a supported customization path.
  const INTERNAL_PLUGINS: [string, PluginInstance][] = [
    ["codex-auth", CodexAuthPlugin],
    ["gemini-auth", GeminiAuthPlugin],
    ["anthropic-auth", AnthropicAuthPlugin],
  ]

  const state = Instance.state(async () => {
    const client = createDaxClient({
      baseUrl: "http://localhost:4096",
      directory: Instance.directory,
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const config = await Config.get()
    const hooks: Hooks[] = []
    const toolSources: { hooks: Hooks; origin: readonly string[] }[] = []
    const input: PluginInput = {
      client,
      project: Instance.project,
      worktree: Instance.worktree,
      directory: Instance.directory,
      serverUrl: Server.url(),
      $: Bun.$,
    }

    for (const [key, plugin] of INTERNAL_PLUGINS) {
      log.info("loading internal plugin", { name: plugin.name })
      const init = await plugin(input)
      hooks.push(init)
      toolSources.push({ hooks: init, origin: ["internal", key] })
    }

    let plugins = config.plugin ?? []
    // A project's plugins were approved as the content they had when config
    // loaded. Re-read that content now, immediately before importing, so a file
    // added or edited since is not run on the strength of an earlier approval.
    const project = await Config.projectPlugins()
    if (project.specifiers.length) {
      const current = await ProjectTrust.inspectProjectPlugins(project.directories, project.specifiers)
      const allowed =
        current.failure === undefined &&
        project.approved !== undefined &&
        ProjectTrust.sameTools(current.files, project.approved)
      if (!allowed) {
        const withheldSpecifiers = new Set(project.specifiers)
        plugins = plugins.filter((entry) => !withheldSpecifiers.has(entry))
        if (current.failure) ProjectTrust.noteWithheldPluginScanFailure(project.specifiers, current.failure)
        else ProjectTrust.noteWithheldPlugins(project.specifiers, current.files)
        log.warn("withheld project plugins that changed since approval", {
          plugins: project.specifiers.length,
          failure: current.failure,
        })
      }
    }
    if (plugins.length) await Config.waitForDependencies()
    if (!Flag.DAX_DISABLE_DEFAULT_PLUGINS) {
      plugins = [...BUILTIN, ...plugins]
    }

    for (let plugin of plugins) {
      const configured = plugin
      // ignore old codex plugin since it is supported first party now
      if (plugin.includes("dax-openai-codex-auth") || plugin.includes("dax-copilot-auth")) continue
      log.info("loading plugin", { path: plugin })
      if (!plugin.startsWith("file://")) {
        const lastAtIndex = plugin.lastIndexOf("@")
        const pkg = lastAtIndex > 0 ? plugin.substring(0, lastAtIndex) : plugin
        const version = lastAtIndex > 0 ? plugin.substring(lastAtIndex + 1) : "latest"
        const builtin = BUILTIN.some((x) => x.startsWith(pkg + "@"))
        plugin = await BunProc.install(pkg, version).catch((err) => {
          if (!builtin) throw err

          const message = err instanceof Error ? err.message : String(err)
          log.error("failed to install builtin plugin", {
            pkg,
            version,
            error: message,
          })
          Bus.publish(Session.Event.Error, {
            error: new NamedError.Unknown({
              message: `Failed to install built-in plugin ${pkg}@${version}: ${message}`,
            }).toObject(),
          })

          return ""
        })
        if (!plugin) continue
      }
      const mod = await import(plugin)
      // Prevent duplicate initialization when plugins export the same function
      // as both a named export and default export (e.g., `export const X` and `export default X`).
      // Object.entries(mod) would return both entries pointing to the same function reference.
      const seen = new Set<PluginInstance>()
      for (const [name, fn] of Object.entries<PluginInstance>(mod)) {
        if (seen.has(fn)) continue
        seen.add(fn)
        const init = await fn(input)
        hooks.push(init)
        const canonicalExport =
          Object.entries<PluginInstance>(mod)
            .filter(([, candidate]) => candidate === fn)
            .map(([key]) => key)
            .sort()[0] ?? name
        toolSources.push({ hooks: init, origin: ["configured", configured, plugin, canonicalExport] })
      }
    }

    return {
      hooks,
      input,
      toolSources,
    }
  })

  export async function trigger<
    Name extends Exclude<keyof Required<Hooks>, "auth" | "event" | "tool">,
    Input = Parameters<Required<Hooks>[Name]>[0],
    Output = Parameters<Required<Hooks>[Name]>[1],
  >(name: Name, input: Input, output: Output): Promise<Output> {
    if (!name) return output
    for (const hook of await state().then((x) => x.hooks)) {
      const fn = hook[name]
      if (!fn) continue
      // @ts-expect-error if you feel adventurous, please fix the typing, make sure to bump the try-counter if you
      // give up.
      // try-counter: 2
      await fn(input, output)
    }
    return output
  }

  export async function list() {
    return state().then((x) => x.hooks)
  }

  /** Internal loader view; keep public hook consumers and tool descriptions unchanged. */
  export async function toolsFromSources() {
    return state().then((x) => x.toolSources)
  }

  export async function init() {
    const hooks = await state().then((x) => x.hooks)
    const config = await Config.get()
    for (const hook of hooks) {
      // @ts-expect-error this is because we haven't moved plugin to sdk v2
      await hook.config?.(config)
    }
    Bus.subscribeAll(async (input) => {
      const hooks = await state().then((x) => x.hooks)
      for (const hook of hooks) {
        hook["event"]?.({
          event: input,
        })
      }
    })
  }
}
