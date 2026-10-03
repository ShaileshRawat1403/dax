import { computeCanonicalCommitment } from "@/execution/canonical-commitment"
import { decideContractTool, ExecutionContractV2, type ExecutionContract } from "@/execution/execution-contract"
import { isNativeToolAlias } from "./native-alias"
import type { CapabilityDescriptor } from "./capability-types"
import type { CapabilityGrant } from "./grant"
import {
  nativeBinding,
  type Attestation,
  type BoundFacts,
  type DaxExecutable,
  type ExecutableFacts,
} from "./implementation-binding"

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
      /**
       * Plugin and loader modules have no supported binding form: their
       * dependency closure cannot be established. They are listed, never granted.
       */
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
  | { type: "local"; command: readonly string[]; environment: readonly string[]; executable: ExecutableFacts }
  | { type: "remote"; url: string; headers: readonly string[] }

/** Everything a proposal and its bindings are derived from, captured at one moment. */
export type ReviewCatalogSnapshot = {
  /** The running DAX implementation, which every DAX-native capability is bound to. */
  daxExecutable: DaxExecutable
  tools: readonly ReviewToolEntry[]
  mcpServers: Readonly<Record<string, McpServerMaterial>>
  /** The session capabilities operator-initiated paths run under, in the vocabulary. */
  session: readonly CapabilityDescriptor[]
  /** The fixed workflow phases for this run's class, if it has one. */
  workflow: readonly CapabilityDescriptor[]
  /** The worker profile this run would launch, if it is a worker run. */
  worker?: { descriptor: CapabilityDescriptor; facts: { profile: string; executable: ExecutableFacts } }
  /**
   * The verification plan, if the run verifies: the runner the workflow's path
   * dispatches through, each command as an argument vector with the executable
   * it resolves to, and the working directory relative to the worktree.
   */
  verification?: {
    descriptor: CapabilityDescriptor
    runner: "direct" | "sandboxed"
    cwd: string
    commands: readonly { argv: readonly string[]; executable: ExecutableFacts }[]
  }
}

export type ProposalInputs = {
  toolAllowlist: readonly string[]
  toolBlocklist: readonly string[]
  workflowClass: string
  providerHint?: string
  /** Filesystem roots usable as grant scope, only when their provenance was reviewed. */
  writeScope?: { roots: readonly string[]; reviewed: boolean }
  /**
   * Capability IDs and source subject keys whose external, unattested
   * implementation the operator explicitly accepts. Never set by the proposal.
   */
  acknowledgedExternal?: readonly string[]
  /**
   * Source selectors the operator chose from `onDemandSources`, for MCP reads
   * that have no enumerable identity. Each is granted only when its subject key
   * (`mcp_source:<family>:<server>`) is also in `acknowledgedExternal`.
   */
  sourceSelections?: readonly { server: string; family: "tool" | "resource" | "prompt" }[]
  /** Grant subjects the operator wants asked about each time rather than allowed. */
  askSubjects?: readonly string[]
}

export type ImplementationBinding = {
  /** The grant subject this binds: a capability ID, or `mcp_source:<family>:<server>`. */
  subject: string
  /** Exact only for the compiled DAX binary's running image; external only for a remote MCP server. */
  attestation: Attestation
  canonicalization: "sorted-json-v1"
  digest: string
}

export type GrantProposal = {
  runId: string
  candidate: ExecutionContractV2
  inputs: ProposalInputs & { daxExecutable: DaxExecutable }
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
  /** Capabilities whose implementation cannot be bound in a supported form. Never granted. */
  unbindable: readonly { capabilityId: string; alias?: string }[]
  /** Capabilities bound only as a reviewed external source, awaiting the operator's acknowledgement. */
  needsTrust: readonly { capabilityId: string; alias?: string }[]
}

export function subjectKey(subject: CapabilityGrant["subject"]) {
  return subject.kind === "capability" ? subject.capabilityId : `mcp_source:${subject.family}:${subject.server}`
}

/**
 * What an implementation binding commits to for one grant subject, and how far
 * that is attested. Undefined when no supported form describes it now.
 */
export function bindingFacts(
  snapshot: ReviewCatalogSnapshot,
  subject: CapabilityGrant["subject"],
): BoundFacts | undefined {
  // Remote MCP is the only external exception; a local server's program has no supported form.
  const remote = (server: string) => {
    const material = snapshot.mcpServers[server]
    return material?.type === "remote" ? material : undefined
  }
  if (subject.kind === "mcp_source") {
    const material = remote(subject.server)
    if (!material) return undefined
    return {
      attestation: "external",
      facts: { kind: "mcp_source", family: subject.family, server: subject.server, material },
    }
  }
  const id = subject.capabilityId
  for (const entry of snapshot.tools) {
    if (entry.family === "legacy" || entry.descriptor.id !== id) continue
    if (entry.family === "native") return nativeBinding(id, snapshot.daxExecutable)
    if (entry.family === "plugin") return undefined
    const material = remote(entry.server)
    if (!material) return undefined
    return {
      attestation: "external",
      facts: { kind: "mcp_tool", id, server: entry.server, material, name: entry.name, definition: entry.definition },
    }
  }
  if (snapshot.session.some((item) => item.id === id) || snapshot.workflow.some((item) => item.id === id)) {
    return nativeBinding(id, snapshot.daxExecutable)
  }
  // Workers and verification commands launch programs with no supported form yet.
  return undefined
}

async function bind(
  snapshot: ReviewCatalogSnapshot,
  subject: CapabilityGrant["subject"],
): Promise<ImplementationBinding> {
  const bound = bindingFacts(snapshot, subject)
  if (bound === undefined) throw new Error(`No binding facts for grant subject ${subjectKey(subject)}`)
  const commitment = await computeCanonicalCommitment(bound.facts)
  return {
    subject: subjectKey(subject),
    attestation: bound.attestation,
    canonicalization: commitment.canonicalization,
    digest: commitment.digest,
  }
}

/**
 * Whether what a reviewed binding committed to is still what would run. Always
 * a full content comparison: nothing is taken as unchanged from its size or
 * modification time.
 */
export async function checkBinding(
  binding: ImplementationBinding,
  subject: CapabilityGrant["subject"],
  current: ReviewCatalogSnapshot,
): Promise<"unchanged" | "changed" | "unavailable"> {
  if (subjectKey(subject) !== binding.subject) return "changed"
  const bound = bindingFacts(current, subject)
  if (bound === undefined) return "unavailable"
  if (bound.attestation !== binding.attestation) return "changed"
  return (await computeCanonicalCommitment(bound.facts)).digest === binding.digest ? "unchanged" : "changed"
}

/**
 * Whether a check about to run is one the reviewed verification plan covers:
 * the same runner, working directory, argument vector and executable content.
 * The runner comes from the genuine dispatch, not from the workflow class that
 * proposed it.
 */
export function matchesReviewedVerification(
  reviewed: NonNullable<ReviewCatalogSnapshot["verification"]>,
  dispatch: { runner: string; cwd: string; argv: readonly string[]; executable: ExecutableFacts },
): boolean {
  if (dispatch.runner !== reviewed.runner || dispatch.cwd !== reviewed.cwd) return false
  if (dispatch.executable.form !== "described") return false
  const executable = dispatch.executable
  return reviewed.commands.some(
    (command) =>
      command.argv.length === dispatch.argv.length &&
      command.argv.every((arg, index) => arg === dispatch.argv[index]) &&
      command.executable.form === "described" &&
      command.executable.path === executable.path &&
      command.executable.target === executable.target &&
      command.executable.digest === executable.digest,
  )
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
 * - A capability with no supported binding is listed as unbindable. One bound
 *   only as an external source is listed as needing trust, unless the operator
 *   acknowledged it in the inputs, and is then granted with that acknowledgement.
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
  const unbindable = new Map<string, GrantProposal["unbindable"][number]>()
  const needsTrust = new Map<string, GrantProposal["needsTrust"][number]>()
  const acknowledged = new Set(input.inputs.acknowledgedExternal ?? [])
  const trust = new Map<string, true>()

  const propose = (descriptor: CapabilityDescriptor, alias?: string) => {
    const bound = bindingFacts(snapshot, { kind: "capability", capabilityId: descriptor.id })
    if (!bound) {
      unbindable.set(descriptor.id, { capabilityId: descriptor.id, ...(alias ? { alias } : {}) })
      return
    }
    if (bound.attestation === "external") {
      if (!acknowledged.has(descriptor.id)) {
        needsTrust.set(descriptor.id, { capabilityId: descriptor.id, ...(alias ? { alias } : {}) })
        return
      }
      trust.set(descriptor.id, true)
    }
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
  for (const selection of input.inputs.sourceSelections ?? []) {
    const subject = { kind: "mcp_source" as const, server: selection.server, family: selection.family }
    const key = subjectKey(subject)
    if (!bindingFacts(snapshot, subject)) {
      unbindable.set(key, { capabilityId: key })
      continue
    }
    if (!acknowledged.has(key)) {
      needsTrust.set(key, { capabilityId: key })
      continue
    }
    trust.set(key, true)
    grants.set(key, { subject, decision: "allow", scope: { kind: "run" } })
  }
  if (snapshot.worker) propose(snapshot.worker.descriptor)
  if (snapshot.verification) propose(snapshot.verification.descriptor)

  const asked = new Set(input.inputs.askSubjects ?? [])
  const ordered = [...grants.values()]
    .map((grant) =>
      trust.has(subjectKey(grant.subject)) ? { ...grant, acknowledgesExternalTrust: true as const } : grant,
    )
    .map((grant) => (asked.has(subjectKey(grant.subject)) ? { ...grant, decision: "ask" as const } : grant))
    .sort((a, b) => (subjectKey(a.subject) < subjectKey(b.subject) ? -1 : 1))
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
      ...(input.inputs.acknowledgedExternal
        ? { acknowledgedExternal: [...new Set(input.inputs.acknowledgedExternal)].sort() }
        : {}),
      ...(input.inputs.askSubjects ? { askSubjects: [...new Set(input.inputs.askSubjects)].sort() } : {}),
      ...(input.inputs.sourceSelections
        ? {
            sourceSelections: [...input.inputs.sourceSelections]
              .map((item) => ({ server: item.server, family: item.family }))
              .sort((a, b) => (`${a.family}:${a.server}` < `${b.family}:${b.server}` ? -1 : 1)),
          }
        : {}),
      daxExecutable: snapshot.daxExecutable,
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
    unbindable: sortById(unbindable.values()),
    needsTrust: sortById(needsTrust.values()),
  }
}

/** The approval subject's digest: a commitment to the whole proposal, candidate included. */
export async function proposalDigest(proposal: GrantProposal) {
  const commitment = await computeCanonicalCommitment(proposal)
  return { canonicalization: commitment.canonicalization, digest: commitment.digest }
}
