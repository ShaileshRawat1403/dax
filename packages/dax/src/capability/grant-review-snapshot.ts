import { Config } from "@/config/config"
import type { ExecutionContract } from "@/execution/execution-contract"
import { Instance } from "@/project/instance"
import { listVerificationCommandCapabilities } from "@/sdlc/verification-identity"
import { daxExecutable, executableFacts } from "./implementation-binding"
import { MCP } from "@/mcp"
import { listCommandShellCapabilities } from "@/session/command-shell-identity"
import { listContextAttachmentCapabilities } from "@/session/context-attachment-identity"
import { listOperatorShellCapabilities } from "@/session/operator-shell-identity"
import { listTemplateContextCapabilities } from "@/session/template-context-identity"
import { ToolRegistry } from "@/tool/registry"
import { listFixedWorkflowCapabilities } from "@/workflows/capability-identity"
import { ExternalWorkerId, listBuiltinWorkerCapabilities, workerProfileFacts } from "@/worker/worker-adapter"
import type { McpServerMaterial, ReviewCatalogSnapshot, ReviewToolEntry } from "./grant-proposal"
import { nativeCapabilities } from "./registry"

function mcpMaterial(name: string, config: Config.Mcp): McpServerMaterial {
  // Names only: a binding must never carry a secret value.
  if (config.type === "local") {
    return {
      type: "local",
      command: [...config.command],
      environment: Object.keys(config.environment ?? {}).sort(),
      // As the last launch resolved it: the configured PATH and the instance directory.
      executable: MCP.launchFacts(name) ?? { form: "unresolved" },
    }
  }
  return { type: "remote", url: config.url, headers: Object.keys(config.headers ?? {}).sort() }
}

/**
 * What a proposal for this contract is derived from and bound to, read from
 * this instance as it is now. It initializes the tool registry and MCP clients
 * exactly as a run's birth does, and executes nothing.
 */
export async function captureReviewSnapshot(
  contract: Pick<ExecutionContract, "workflowClass" | "providerHint" | "runtimePolicy">,
): Promise<ReviewCatalogSnapshot> {
  // Discovery first: it republishes the loader catalog from what is loaded now,
  // so the order and the enrolled source and metadata come from one current
  // catalog. Reading the catalog before discovery would see a cold or stale one.
  const order = await ToolRegistry.reviewOrder()
  const plugins = new Map(ToolRegistry.catalogEntries().map((entry) => [entry.alias, entry]))
  const tools: ReviewToolEntry[] = []
  for (const { alias, kind } of order) {
    if (kind === "builtin") {
      const descriptor = nativeCapabilities.list().find((item) => item.id === `native.tool.${alias}`)
      tools.push(descriptor ? { family: "native", alias, descriptor } : { family: "legacy", alias })
      continue
    }
    const entry = plugins.get(alias)
    if (!entry) {
      tools.push({ family: "legacy", alias })
      continue
    }
    tools.push({
      family: "plugin",
      alias,
      descriptor: entry.capability,
      source: entry.source,
      metadata: entry.metadata,
    })
  }

  await MCP.tools()
  for (const entry of await MCP.catalogEntries()) {
    tools.push({
      family: "mcp_tool",
      alias: entry.alias,
      descriptor: entry.capability,
      server: entry.server,
      name: entry.name,
      definition: entry.definition,
    })
  }

  const config = await Config.get()
  const mcpServers: Record<string, McpServerMaterial> = {}
  for (const [name, server] of Object.entries(config.mcp ?? {})) {
    if (server && typeof server === "object" && "type" in server) mcpServers[name] = mcpMaterial(name, server)
  }

  const worker = (() => {
    if (contract.workflowClass !== "worker_run" || !contract.providerHint?.startsWith("worker:")) return undefined
    const id = ExternalWorkerId.safeParse(contract.providerHint.slice("worker:".length))
    if (!id.success) return undefined
    const descriptor = listBuiltinWorkerCapabilities().find((item) => item.id === `worker.profile.${id.data}`)
    return descriptor ? { descriptor, facts: workerProfileFacts(id.data) } : undefined
  })()

  // The workflow's path fixes the runner: worker runs verify in the sandbox,
  // everything else directly. The commands are the reviewed plan, by argument
  // vector, run from the worktree root.
  const planned = contract.runtimePolicy?.postconditions?.validationCommands ?? []
  const runner = contract.workflowClass === "worker_run" ? ("sandboxed" as const) : ("direct" as const)
  const verificationDescriptor = listVerificationCommandCapabilities().find(
    (item) => item.id === `verification.command.${runner}`,
  )
  const verification =
    planned.length > 0 && verificationDescriptor
      ? {
          descriptor: verificationDescriptor,
          runner,
          cwd: ".",
          commands: planned.map((command) => {
            const argv = command.trim().split(/\s+/)
            return { argv, executable: executableFacts(argv[0]!, { cwd: Instance.worktree }) }
          }),
        }
      : undefined

  return {
    daxExecutable: daxExecutable(),
    tools,
    mcpServers,
    session: [
      ...listOperatorShellCapabilities(),
      ...listCommandShellCapabilities(),
      ...listContextAttachmentCapabilities(),
      ...listTemplateContextCapabilities(),
    ],
    workflow: listFixedWorkflowCapabilities().filter((item) =>
      item.id.startsWith(`workflow.${contract.workflowClass}.`),
    ),
    ...(worker ? { worker } : {}),
    ...(verification ? { verification } : {}),
  }
}

/**
 * What would run now for the families that can be bound, without discovery,
 * launching or connecting: the running DAX image, every native capability,
 * the MCP tools this instance already lists, and the configured servers. Used
 * at dispatch, where only the binding of the grant that matched is compared.
 */
export async function captureDispatchSnapshot(
  contract: Pick<ExecutionContract, "workflowClass">,
): Promise<ReviewCatalogSnapshot> {
  const tools: ReviewToolEntry[] = nativeCapabilities
    .list()
    .map((descriptor) => ({ family: "native" as const, alias: descriptor.id.slice("native.tool.".length), descriptor }))
  for (const entry of await MCP.catalogEntries()) {
    tools.push({
      family: "mcp_tool",
      alias: entry.alias,
      descriptor: entry.capability,
      server: entry.server,
      name: entry.name,
      definition: entry.definition,
    })
  }
  const config = await Config.get()
  const mcpServers: Record<string, McpServerMaterial> = {}
  for (const [name, server] of Object.entries(config.mcp ?? {})) {
    if (server && typeof server === "object" && "type" in server) mcpServers[name] = mcpMaterial(name, server)
  }
  return {
    daxExecutable: daxExecutable(),
    tools,
    mcpServers,
    session: [
      ...listOperatorShellCapabilities(),
      ...listCommandShellCapabilities(),
      ...listContextAttachmentCapabilities(),
      ...listTemplateContextCapabilities(),
    ],
    workflow: listFixedWorkflowCapabilities().filter((item) =>
      item.id.startsWith(`workflow.${contract.workflowClass}.`),
    ),
  }
}
