import { computeCanonicalCommitment } from "@/execution/canonical-commitment"
import { decideContractTool, ExecutionContractV2, type ExecutionContract } from "@/execution/execution-contract"
import { isNativeToolAlias } from "./native-alias"
import type { CapabilityDescriptor } from "./capability-types"
import type { CapabilityGrant } from "./grant"

/**
 * Stage 3: a proposed grant set, and what it was derived from. A proposal is
 * data. It authorizes nothing, the guardian never reads it, and it becomes a
 * contract only through an operator's approval of its exact digest.
 */

/** One tool the catalog offered, in registry order, with the facts its binding needs. */
export type ReviewToolEntry =
  | { family: "native"; alias: string; descriptor: CapabilityDescriptor }
  | {
      family: "plugin"
      alias: string
      descriptor: CapabilityDescriptor
      /** The loader's source parts, as recorded by the dynamic catalog. */
      source: string
      /** The declared description and schema, canonicalized. */
      metadata: string
      /** SHA-256 of the entry file where it is a local file; null where there is none to hash. */
      entryContent: string | null
    }
  | {
      family: "mcp_tool"
      alias: string
      descriptor: CapabilityDescriptor
      server: string
      /** The server's own tool name, not the model-facing alias. */
      name: string
      /** The listed definition and timeout, canonicalized. */
      definition: string
    }
  /** An executor with no descriptor. It cannot be granted and is listed as excluded. */
  | { family: "legacy"; alias: string }

/** A configured MCP server, without secret values: header and environment names only. */
export type McpServerMaterial =
  | { type: "local"; command: readonly string[]; environment: readonly string[] }
  | { type: "remote"; url: string; headers: readonly string[] }

/** Everything a proposal and its bindings are derived from, captured at one moment. */
export type ReviewCatalogSnapshot = {
  daxVersion: string
  tools: readonly ReviewToolEntry[]
  mcpServers: Readonly<Record<string, McpServerMaterial>>
  /** The session capabilities operator-initiated paths run under, in the vocabulary. */
  session: readonly CapabilityDescriptor[]
  /** The fixed workflow phases for this run's class, if it has one. */
  workflow: readonly CapabilityDescriptor[]
  /** The worker profile this run would launch, if it is a worker run. */
  worker?: { descriptor: CapabilityDescriptor; facts: { profile: string; binary: string | null } }
  /** The verification runner and plan, if the run verifies. */
  verification?: { descriptor: CapabilityDescriptor; commands: readonly string[] }
}

export type ProposalInputs = {
  toolAllowlist: readonly string[]
  toolBlocklist: readonly string[]
  workflowClass: string
  providerHint?: string
  /** Filesystem roots usable as grant scope, only when their provenance was reviewed. */
  writeScope?: { roots: readonly string[]; reviewed: boolean }
}

export type ImplementationBinding = {
  /** The grant subject this binds: a capability ID, or `mcp_source:<family>:<server>`. */
  subject: string
  canonicalization: "sorted-json-v1"
  digest: string
}

export type GrantProposal = {
  runId: string
  candidate: ExecutionContractV2
  inputs: ProposalInputs & { daxVersion: string }
  bindings: readonly ImplementationBinding[]
  /** Executors the run cannot use because they have no identity to grant. */
  excluded: readonly { alias: string; reason: "legacy_unenrolled" }[]
  /** Filesystem or delegation capabilities left ungranted for lack of reviewed scope evidence. */
  needsScope: readonly { capabilityId: string; alias?: string; scopeSupport: CapabilityDescriptor["scopeSupport"] }[]
  /** Grants a reviewer should look at twice. */
  marked: readonly { capabilityId: string; alias: string; note: "non_native_executor_under_native_alias" }[]
  /**
   * MCP resource reads and prompt fetches have no enumerable identity, so none
   * is proposed. Each configured server is listed so the reviewer can choose to
   * add a source selector for it, where its breadth is visible.
   */
  onDemandSources: readonly { server: string; family: "resource" | "prompt" }[]
}

export function subjectKey(subject: CapabilityGrant["subject"]) {
  return subject.kind === "capability" ? subject.capabilityId : `mcp_source:${subject.family}:${subject.server}`
}

/** The facts an implementation binding commits to, for one grant subject. Undefined when unavailable now. */
export function bindingFacts(snapshot: ReviewCatalogSnapshot, subject: CapabilityGrant["subject"]): unknown {
  if (subject.kind === "mcp_source") {
    const server = snapshot.mcpServers[subject.server]
    return server ? { kind: "mcp_source", family: subject.family, server: subject.server, material: server } : undefined
  }
  const id = subject.capabilityId
  for (const entry of snapshot.tools) {
    if (entry.family === "legacy" || entry.descriptor.id !== id) continue
    if (entry.family === "native") return { kind: "native", id, daxVersion: snapshot.daxVersion }
    if (entry.family === "plugin") {
      return { kind: "plugin", id, source: entry.source, metadata: entry.metadata, entryContent: entry.entryContent }
    }
    const server = snapshot.mcpServers[entry.server]
    if (!server) return undefined
    return {
      kind: "mcp_tool",
      id,
      server: entry.server,
      material: server,
      name: entry.name,
      definition: entry.definition,
    }
  }
  if (snapshot.session.some((item) => item.id === id)) return { kind: "session", id, daxVersion: snapshot.daxVersion }
  if (snapshot.workflow.some((item) => item.id === id)) return { kind: "workflow", id, daxVersion: snapshot.daxVersion }
  if (snapshot.worker?.descriptor.id === id) return { kind: "worker", id, ...snapshot.worker.facts }
  if (snapshot.verification?.descriptor.id === id) {
    return { kind: "verification", id, daxVersion: snapshot.daxVersion, commands: snapshot.verification.commands }
  }
  return undefined
}

async function bind(snapshot: ReviewCatalogSnapshot, subject: CapabilityGrant["subject"]) {
  const facts = bindingFacts(snapshot, subject)
  if (facts === undefined) throw new Error(`No binding facts for grant subject ${subjectKey(subject)}`)
  const commitment = await computeCanonicalCommitment(facts)
  return { subject: subjectKey(subject), canonicalization: commitment.canonicalization, digest: commitment.digest }
}

/** Whether what a reviewed binding committed to is still what would run. */
export async function checkBinding(
  binding: ImplementationBinding,
  subject: CapabilityGrant["subject"],
  current: ReviewCatalogSnapshot,
): Promise<"unchanged" | "changed" | "unavailable"> {
  if (subjectKey(subject) !== binding.subject) return "changed"
  const facts = bindingFacts(current, subject)
  if (facts === undefined) return "unavailable"
  return (await computeCanonicalCommitment(facts)).digest === binding.digest ? "unchanged" : "changed"
}

/**
 * Derive the candidate grant set. Deterministic for its inputs, which are
 * returned with it.
 *
 * - A tool alias yields a grant for the executor that would run under it: the
 *   last one the v1 contract covers, as at dispatch. A blocked alias yields none.
 * - MCP tools are granted by exact identity. No server or family selector is
 *   ever proposed.
 * - A filesystem-capable capability is granted only with reviewed roots; without
 *   them it is listed as needing scope. Run scope for it is never proposed.
 * - A delegation capability is listed as needing scope: a v1 contract names no agents.
 * - An executor with no descriptor is listed as excluded.
 */
export async function proposeGrants(input: {
  runId: string
  contract: ExecutionContract
  snapshot: ReviewCatalogSnapshot
  inputs: ProposalInputs
}): Promise<GrantProposal> {
  const { contract, snapshot } = input
  const grants = new Map<string, CapabilityGrant>()
  const excluded = new Map<string, { alias: string; reason: "legacy_unenrolled" }>()
  const needsScope = new Map<string, GrantProposal["needsScope"][number]>()
  const marked = new Map<string, GrantProposal["marked"][number]>()
  const roots = input.inputs.writeScope?.reviewed ? [...new Set(input.inputs.writeScope.roots)].sort() : []

  const propose = (descriptor: CapabilityDescriptor, alias?: string) => {
    if (descriptor.scopeSupport === "filesystem") {
      if (roots.length === 0) {
        needsScope.set(descriptor.id, { capabilityId: descriptor.id, alias, scopeSupport: "filesystem" })
        return
      }
      grants.set(descriptor.id, {
        subject: { kind: "capability", capabilityId: descriptor.id },
        decision: "allow",
        scope: { kind: "filesystem", roots },
      })
      return
    }
    if (descriptor.scopeSupport === "delegation") {
      needsScope.set(descriptor.id, { capabilityId: descriptor.id, alias, scopeSupport: "delegation" })
      return
    }
    grants.set(descriptor.id, {
      subject: { kind: "capability", capabilityId: descriptor.id },
      decision: "allow",
      scope: { kind: "run" },
    })
  }

  // The executor dispatch would select under each alias: the last one covered.
  const selected = new Map<string, ReviewToolEntry>()
  for (const entry of snapshot.tools) {
    const kind = entry.family === "native" ? "builtin" : entry.family === "mcp_tool" ? "mcp" : "plugin"
    if (!decideContractTool(contract, entry.alias, { kind }).allowed) continue
    selected.set(entry.alias, entry)
  }
  for (const [alias, entry] of [...selected].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (entry.family === "legacy") {
      excluded.set(alias, { alias, reason: "legacy_unenrolled" })
      continue
    }
    if (entry.family !== "native" && isNativeToolAlias(alias)) {
      marked.set(entry.descriptor.id, {
        capabilityId: entry.descriptor.id,
        alias,
        note: "non_native_executor_under_native_alias",
      })
    }
    propose(entry.descriptor, alias)
  }

  // Operator-initiated paths, under the aliases a v1 contract can name for them.
  const shellAllowed = decideContractTool(contract, "shell", { kind: "builtin" }).allowed
  for (const descriptor of snapshot.session) {
    if (descriptor.id === "session.shell.operator" || descriptor.id === "session.command.shell") {
      if (shellAllowed) propose(descriptor)
      continue
    }
    propose(descriptor)
  }
  for (const descriptor of snapshot.workflow) propose(descriptor)
  if (snapshot.worker) propose(snapshot.worker.descriptor)
  if (snapshot.verification) propose(snapshot.verification.descriptor)

  const ordered = [...grants.values()].sort((a, b) => (subjectKey(a.subject) < subjectKey(b.subject) ? -1 : 1))
  const candidate = ExecutionContractV2.parse({
    ...contract,
    schemaVersion: "v2",
    capabilityGrants: ordered,
  })
  const bindings = await Promise.all(ordered.map((grant) => bind(snapshot, grant.subject)))
  const sortById = <T extends { capabilityId: string }>(items: Iterable<T>) =>
    [...items].sort((a, b) => (a.capabilityId < b.capabilityId ? -1 : 1))

  return {
    runId: input.runId,
    candidate,
    inputs: {
      toolAllowlist: [...input.inputs.toolAllowlist],
      toolBlocklist: [...input.inputs.toolBlocklist],
      workflowClass: input.inputs.workflowClass,
      ...(input.inputs.providerHint ? { providerHint: input.inputs.providerHint } : {}),
      ...(input.inputs.writeScope ? { writeScope: input.inputs.writeScope } : {}),
      daxVersion: snapshot.daxVersion,
    },
    bindings,
    excluded: [...excluded.values()].sort((a, b) => (a.alias < b.alias ? -1 : 1)),
    needsScope: sortById(needsScope.values()),
    marked: sortById(marked.values()),
    onDemandSources: Object.keys(snapshot.mcpServers)
      .sort()
      .flatMap((server) => [
        { server, family: "resource" as const },
        { server, family: "prompt" as const },
      ]),
  }
}

/** The approval subject's digest: a commitment to the whole proposal, candidate included. */
export async function proposalDigest(proposal: GrantProposal) {
  const commitment = await computeCanonicalCommitment(proposal)
  return { canonicalization: commitment.canonicalization, digest: commitment.digest }
}
