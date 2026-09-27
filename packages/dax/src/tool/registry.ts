import { QuestionTool } from "./question"
import { ShellTool } from "./shell"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { BatchTool } from "./batch"
import { ReadTool } from "./read"
import { TaskTool } from "./task"
import { TodoWriteTool, TodoReadTool } from "./todo"
import { WebFetchTool } from "./webfetch"
import { WriteTool } from "./write"
import { InvalidTool } from "./invalid"
import { SkillTool } from "./skill"
import type { Agent } from "../agent/agent"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Config } from "../config/config"
import path from "path"
import { type ToolContext as PluginToolContext, type ToolDefinition } from "@dax-ai/plugin"
import z from "zod"
import { Plugin } from "../plugin"
import { WebSearchTool } from "./websearch"
import { CodeSearchTool } from "./codesearch"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"
import { LspTool } from "./lsp"
import { Truncate } from "./truncation"
import { PlanExitTool, PlanEnterTool } from "./plan"
import { ApplyPatchTool } from "./apply_patch"
import { PMNoteTool } from "./pm_note"
import { ReflectionTool } from "./reflection"
import { GitBranchTool } from "./git_branch"
import { nativeCapabilities } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import {
  CapabilityIdentityError,
  createDynamicCatalog,
  metadataKey,
  pluginCapability,
  validationMetadata,
} from "@/capability/dynamic-identity"

// Identity is attached to the actual built-in definition, never inferred from
// its public name (a plugin may legitimately use the same name).
const nativeDefinitions = new Map<Tool.Info, { id: string; init: Tool.Info["init"] }>(
  [
    InvalidTool,
    QuestionTool,
    ShellTool,
    ReadTool,
    GlobTool,
    GrepTool,
    EditTool,
    WriteTool,
    TaskTool,
    WebFetchTool,
    TodoWriteTool,
    PMNoteTool,
    WebSearchTool,
    CodeSearchTool,
    SkillTool,
    ApplyPatchTool,
    GitBranchTool,
    LspTool,
    BatchTool,
    PlanExitTool,
    PlanEnterTool,
    ReflectionTool,
  ].map((info) => [info, { id: info.id, init: info.init }]),
)

export namespace ToolRegistry {
  const log = Log.create({ service: "tool.registry" })
  type Executor = (...args: never[]) => Promise<unknown>
  const executorBindings = new WeakMap<
    object,
    {
      id: string
      execute: Executor
      kind: "builtin" | "plugin"
      check?: () => void
      capability?: CapabilityDescriptor
    }
  >()

  /** Resolve before hooks/effects; descriptors do not change permission. */
  export function executionIdentity<T extends { id: string; execute: Executor }>(
    item: T,
  ): {
    kind: "builtin" | "plugin"
    id: string
    execute: T["execute"]
    receiver: T
    capability?: CapabilityDescriptor
  } {
    const binding = executorBindings.get(item)
    if (!binding || binding.id !== item.id || binding.execute !== item.execute) {
      if (!binding) throw new CapabilityIdentityError("unbound")
      if (binding.capability) throw new CapabilityIdentityError("changed")
      throw new Error(`Unbound or changed tool executor: ${binding.id}`)
    }
    binding.check?.()
    return {
      kind: binding.kind,
      id: binding.id,
      execute: (binding.check
        ? async (...args: never[]) => {
            binding.check!()
            return binding.execute.call(item, ...args)
          }
        : binding.execute) as T["execute"],
      receiver: item,
      ...(binding.kind === "builtin"
        ? { capability: nativeCapabilities.require(`native.tool.${binding.id}`) }
        : { capability: binding.capability }),
    }
  }

  async function initialize(t: Tool.Info, kind: "builtin" | "plugin", agent?: Agent.Info) {
    const id = t.id
    const init = t.init
    const definition = kind === "plugin" ? dynamicDefinitions.get(t) : undefined
    definition?.check()
    if (kind === "builtin") {
      const expected = nativeDefinitions.get(t)
      if (!expected || expected.id !== id || expected.init !== init) {
        throw new Error(`Unknown or changed native executor definition: ${id}`)
      }
      nativeCapabilities.require(`native.tool.${id}`)
    }
    const item = { id, ...(await init.call(t, { agent })) }
    definition?.check()
    const { parameters, description, result, authorization, execute } = item
    const validation = definition?.capability ? validationMetadata({ parameters, result }) : undefined
    const check = definition?.capability
      ? () => {
          definition.check()
          if (
            item.parameters !== parameters ||
            item.description !== description ||
            item.result !== result ||
            item.authorization !== authorization ||
            item.execute !== execute
          )
            throw new CapabilityIdentityError("changed")
          try {
            const live = validationMetadata({ parameters: item.parameters, result: item.result })
            if (
              live.key !== validation!.key ||
              live.references.length !== validation!.references.length ||
              live.references.some((reference, index) => reference !== validation!.references[index])
            )
              throw new CapabilityIdentityError("changed")
          } catch {
            throw new CapabilityIdentityError("changed")
          }
        }
      : definition?.check
    executorBindings.set(item, { id, execute: item.execute, kind, check, capability: definition?.capability })
    return item
  }

  /** Queued task dispatch uses the genuine native definition, not a name. */
  export async function initializeNative(t: Tool.Info, agent?: Agent.Info) {
    return initialize(t, "builtin", agent)
  }

  const dynamicDefinitions = new WeakMap<Tool.Info, { check: () => void; capability?: CapabilityDescriptor }>()
  export const state = Instance.state(
    () => ({
      custom: [] as Tool.Info[],
      directory: Instance.directory,
      catalog: createDynamicCatalog(),
    }),
    async (s) => s.catalog.dispose(),
  )

  async function discover() {
    const s = state()
    const ticket = s.catalog.begin()
    const found: ReturnType<typeof fromPlugin>[] = []
    const glob = new Bun.Glob("{tool,tools}/*.{js,ts}")

    const matches = await Config.directories().then((dirs) =>
      dirs.flatMap((dir) => [...glob.scanSync({ cwd: dir, absolute: true, followSymlinks: true, dot: true })]),
    )
    if (matches.length) await Config.waitForDependencies()
    for (const match of matches) {
      const namespace = path.basename(match, path.extname(match))
      const mod = await import(match)
      for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
        found.push(
          fromPlugin(
            id === "default" ? namespace : `${namespace}_${id}`,
            def,
            ["directory", path.resolve(match), id],
            () => mod[id] === def,
          ),
        )
      }
    }

    for (const source of await Plugin.toolsFromSources()) {
      for (const [id, def] of Object.entries(source.hooks.tool ?? {})) {
        found.push(fromPlugin(id, def, [...source.origin, id], () => source.hooks.tool?.[id] === def))
      }
    }

    const custom = [...s.custom]
    const entries = [
      ...found.map((item) => item.entry),
      ...custom.map((info) => ({
        alias: info.id,
        source: "legacy_custom",
        receiver: info,
        executor: info.init,
        metadata: "legacy",
      })),
    ]
    const checks = s.catalog.publish(ticket, entries)
    for (const [index, item] of found.entries()) {
      const current = checks[index]
      item.bind(
        () => {
          if (Instance.directory !== s.directory) throw new CapabilityIdentityError("stale")
          current()
        },
        () => s.catalog.changed(item.info.id),
      )
    }
    for (const [index, info] of custom.entries()) {
      const id = info.id
      const init = info.init
      dynamicDefinitions.set(info, {
        check() {
          checks[found.length + index]()
          if (Instance.directory !== s.directory) throw new CapabilityIdentityError("stale")
          if (info.id !== id || info.init !== init) {
            s.catalog.changed(id)
            throw new CapabilityIdentityError("changed")
          }
        },
      })
    }
    return [...found.map((item) => item.info), ...custom]
  }

  function fromPlugin(id: string, def: ToolDefinition, origin: readonly string[], owns: () => boolean) {
    if (
      !def ||
      typeof def.execute !== "function" ||
      typeof def.description !== "string" ||
      !def.args ||
      Object.getPrototypeOf(def.args) !== Object.prototype
    )
      throw new CapabilityIdentityError("malformed")
    const execute = def.execute
    const description = def.description
    const args = def.args
    const fields = Object.entries(args).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const parameters = z.object({ ...args })
    const snapshot = () => {
      try {
        if (!def.args || Object.getPrototypeOf(def.args) !== Object.prototype || typeof def.description !== "string") {
          throw new CapabilityIdentityError("malformed")
        }
        const validation = validationMetadata(def.args)
        return {
          key: metadataKey({
            description: def.description,
            input: z.toJSONSchema(z.object({ ...def.args })),
            validation: validation.key,
            adapter: "dax-string-v1",
          }),
          references: validation.references,
        }
      } catch {
        throw new CapabilityIdentityError("malformed")
      }
    }
    const { key: metadata, references } = snapshot()
    const { descriptor, source } = pluginCapability(origin)
    let current: (() => void) | undefined
    let invalidate: (() => void) | undefined
    const check = () => {
      if (!current) throw new CapabilityIdentityError("unbound")
      current()
      try {
        const live = snapshot()
        if (
          owns() &&
          def.execute === execute &&
          def.args === args &&
          Object.keys(def.args).length === fields.length &&
          fields.every(([key, value]) => def.args[key] === value) &&
          live.key === metadata &&
          live.references.length === references.length &&
          live.references.every((value, index) => value === references[index])
        )
          return
      } catch {
        // An invalid live definition is a changed binding, not leaked parser text.
      }
      invalidate?.()
      throw new CapabilityIdentityError("changed")
    }
    const info: Tool.Info = {
      id,
      init: async (initCtx) => ({
        parameters,
        description,
        // A plugin's domain contract is its declared string return. That string
        // is parsed below before it is transformed into DAX transport.
        result: Tool.Result,
        execute: async (args, ctx) => {
          // Recheck after awaited approval/hooks, immediately before the actual
          // captured plugin effect. No lookup or retry against a successor.
          check()
          const pluginCtx = {
            ...ctx,
            directory: Instance.directory,
            worktree: Instance.worktree,
          } as unknown as PluginToolContext
          // Plugin tools return a string by contract. Parse it before truncation
          // so a misbehaving plugin cannot become a successful model result.
          const result = z.string().parse(await execute.call(def, args as any, pluginCtx))
          const domainResult = Tool.parseResult(id, {
            title: "",
            output: result,
            metadata: {},
          })
          ctx.captureValidatedResult?.(domainResult)
          const out = await Truncate.output(domainResult.output, {}, initCtx?.agent)
          return Tool.parseResult(id, {
            ...domainResult,
            output: out.content,
            metadata: { truncated: out.truncated, ...(out.truncated ? { outputPath: out.outputPath } : {}) },
          })
        },
      }),
    }
    const init = info.init
    return {
      info,
      entry: {
        alias: id,
        source,
        receiver: def,
        executor: execute,
        metadata,
        capability: descriptor,
        references: [args, ...references],
      },
      bind(assertCurrent: () => void, reject: () => void) {
        current = assertCurrent
        invalidate = reject
        dynamicDefinitions.set(info, {
          capability: descriptor,
          check() {
            check()
            if (info.id !== id || info.init !== init) throw new CapabilityIdentityError("changed")
          },
        })
      },
    }
  }

  /**
   * Registers a custom tool in the registry.
   * Updates existing tool if same ID, otherwise adds new.
   * @param tool - Tool definition to register
   */
  export async function register(tool: Tool.Info) {
    const { custom } = state()
    state().catalog.changed(tool.id)
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all() {
    const custom = await discover()
    const config = await Config.get()

    const builtins = [
      InvalidTool,
      ...(["app", "cli", "desktop"].includes(Flag.DAX_CLIENT) ? [QuestionTool] : []),
      ShellTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      PMNoteTool,
      // TodoReadTool,
      WebSearchTool,
      CodeSearchTool,
      SkillTool,
      ApplyPatchTool,
      GitBranchTool,
      ...(Flag.DAX_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(Flag.DAX_EXPERIMENTAL_PLAN_MODE && Flag.DAX_CLIENT === "cli" ? [PlanExitTool, PlanEnterTool] : []),
      ReflectionTool,
    ]
    return [
      ...builtins.map((info) => ({ info, kind: "builtin" as const })),
      ...custom.map((info) => ({ info, kind: "plugin" as const })),
    ]
  }

  export async function ids() {
    return all().then((x) => x.map((t) => t.info.id))
  }

  /**
   * Tool ids sourced from directory-scanned tool files or plugin manifests
   * (`fromPlugin`), as opposed to DAX's own built-in `Tool.define` set.
   * Exists so callers outside the registry (native settlement) can classify
   * an invocation's executor without duplicating the built-in id list.
   */
  export async function pluginIds(): Promise<Set<string>> {
    const custom = await discover()
    return new Set(custom.map((t) => t.id))
  }

  export async function tools(
    model: {
      providerID: string
      modelID: string
    },
    agent?: Agent.Info,
  ) {
    const tools = await all()
    const result = await Promise.all(
      tools
        .filter(({ info: t }) => {
          // Enable websearch/codesearch for zen users OR via enable flag
          if (t.id === "codesearch" || t.id === "websearch") {
            return model.providerID === "dax" || Flag.DAX_ENABLE_EXA
          }

          // use apply tool in same format as codex
          const usePatch =
            model.modelID.includes("gpt-") && !model.modelID.includes("oss") && !model.modelID.includes("gpt-4")
          if (t.id === "apply_patch") return usePatch
          if (t.id === "edit" || t.id === "write") return !usePatch

          return true
        })
        .map(async ({ info: t, kind }) => {
          using _ = log.time(t.id)
          return initialize(t, kind, agent)
        }),
    )
    for (const item of result) executionIdentity(item)
    return result
  }
}
