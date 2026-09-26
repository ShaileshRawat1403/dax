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
      throw new Error(`Unbound or changed tool executor: ${item.id}`)
    }
    return {
      kind: binding.kind,
      id: binding.id,
      execute: binding.execute as T["execute"],
      receiver: item,
      ...(binding.kind === "builtin" ? { capability: nativeCapabilities.require(`native.tool.${binding.id}`) } : {}),
    }
  }

  async function initialize(t: Tool.Info, kind: "builtin" | "plugin", agent?: Agent.Info) {
    const id = t.id
    const init = t.init
    if (kind === "builtin") {
      const expected = nativeDefinitions.get(t)
      if (!expected || expected.id !== id || expected.init !== init) {
        throw new Error(`Unknown or changed native executor definition: ${id}`)
      }
      nativeCapabilities.require(`native.tool.${id}`)
    }
    const item = { id, ...(await init.call(t, { agent })) }
    executorBindings.set(item, { id, execute: item.execute, kind })
    return item
  }

  /** Queued task dispatch uses the genuine native definition, not a name. */
  export async function initializeNative(t: Tool.Info, agent?: Agent.Info) {
    return initialize(t, "builtin", agent)
  }

  export const state = Instance.state(async () => {
    const custom = [] as Tool.Info[]
    const glob = new Bun.Glob("{tool,tools}/*.{js,ts}")

    const matches = await Config.directories().then((dirs) =>
      dirs.flatMap((dir) => [...glob.scanSync({ cwd: dir, absolute: true, followSymlinks: true, dot: true })]),
    )
    if (matches.length) await Config.waitForDependencies()
    for (const match of matches) {
      const namespace = path.basename(match, path.extname(match))
      const mod = await import(match)
      for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
        custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
      }
    }

    const plugins = await Plugin.list()
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def))
      }
    }

    return { custom }
  })

  function fromPlugin(id: string, def: ToolDefinition): Tool.Info {
    return {
      id,
      init: async (initCtx) => ({
        parameters: z.object(def.args),
        description: def.description,
        // A plugin's domain contract is its declared string return. That string
        // is parsed below before it is transformed into DAX transport.
        result: Tool.Result,
        execute: async (args, ctx) => {
          const pluginCtx = {
            ...ctx,
            directory: Instance.directory,
            worktree: Instance.worktree,
          } as unknown as PluginToolContext
          // Plugin tools return a string by contract. Parse it before truncation
          // so a misbehaving plugin cannot become a successful model result.
          const result = z.string().parse(await def.execute(args as any, pluginCtx))
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
  }

  /**
   * Registers a custom tool in the registry.
   * Updates existing tool if same ID, otherwise adds new.
   * @param tool - Tool definition to register
   */
  export async function register(tool: Tool.Info) {
    const { custom } = await state()
    const idx = custom.findIndex((t) => t.id === tool.id)
    if (idx >= 0) {
      custom.splice(idx, 1, tool)
      return
    }
    custom.push(tool)
  }

  async function all() {
    const custom = await state().then((x) => x.custom)
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
    const { custom } = await state()
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
    return result
  }
}
