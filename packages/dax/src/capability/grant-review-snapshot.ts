import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Config } from "@/config/config"
import type { ExecutionContract } from "@/execution/execution-contract"
import { Installation } from "@/installation"
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

/** The local file a plugin source names, if it names one. */
function entryFile(parts: readonly string[]): string | undefined {
  for (const part of parts) {
    if (part.startsWith("file://")) {
      try {
        return fileURLToPath(part)
      } catch {
        continue
      }
    }
    if (path.isAbsolute(part)) return part
  }
  return undefined
}

async function contentDigest(file: string | undefined): Promise<string | null> {
  if (!file) return null
  try {
    return `sha256:${createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex")}`
  } catch {
    // Unreadable now: bound as absent, so a later readable file is a change.
    return null
  }
}

function mcpMaterial(config: Config.Mcp): McpServerMaterial {
  // Names only: a binding must never carry a secret value.
  if (config.type === "local") {
    return { type: "local", command: [...config.command], environment: Object.keys(config.environment ?? {}).sort() }
  }
  return { type: "remote", url: config.url, headers: Object.keys(config.headers ?? {}).sort() }
}

/**
 * What a proposal for this contract is derived from and bound to, read from
 * this instance as it is now. It initializes the tool registry and MCP clients
 * exactly as a run's birth does, and executes nothing.
 */
export async function captureReviewSnapshot(
  contract: Pick<ExecutionContract, "workflowClass" | "providerHint">,
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
    let parts: string[] = []
    try {
      parts = JSON.parse(entry.source)
    } catch {
      // Not a recorded part list: there is no local file to hash.
    }
    tools.push({
      family: "plugin",
      alias,
      descriptor: entry.capability,
      source: entry.source,
      metadata: entry.metadata,
      entryContent: await contentDigest(entryFile(parts)),
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
    if (server && typeof server === "object" && "type" in server) mcpServers[name] = mcpMaterial(server)
  }

  const worker = (() => {
    if (contract.workflowClass !== "worker_run" || !contract.providerHint?.startsWith("worker:")) return undefined
    const id = ExternalWorkerId.safeParse(contract.providerHint.slice("worker:".length))
    if (!id.success) return undefined
    const descriptor = listBuiltinWorkerCapabilities().find((item) => item.id === `worker.profile.${id.data}`)
    return descriptor ? { descriptor, facts: workerProfileFacts(id.data) } : undefined
  })()

  return {
    daxVersion: Installation.VERSION,
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
  }
}
