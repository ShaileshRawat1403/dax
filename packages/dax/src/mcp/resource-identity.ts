import { createHash } from "node:crypto"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { createCapabilityRegistry } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"

export const MCP_RESOURCE_NAMESPACE = "mcp.resource.v1."
export const MCP_PROMPT_NAMESPACE = "mcp.prompt.v1."
/**
 * Version 2 read identities carry a commitment to their server, so a grant's
 * server can be checked on replay without the item name. Minted only for reads
 * decided under an activated reviewed run; v1 is unchanged everywhere else.
 */
export const MCP_RESOURCE_V2_NAMESPACE = "mcp.resource.v2."
export const MCP_PROMPT_V2_NAMESPACE = "mcp.prompt.v2."

type Snapshot = {
  clientName: string
  uri: string
  client: Client
  transport: NonNullable<Client["transport"]>
  readResource: Client["readResource"]
  descriptor: CapabilityDescriptor
  checkOwner(): void
}

const bindings = new WeakMap<object, Snapshot>()
export type McpResourceBinding = object

/**
 * The descriptor one read of a named resource or prompt on a named server has.
 * Pure: it lets a caller that holds the source prove which identity it minted.
 */
export function mcpReadDescriptor(kind: "resource" | "prompt", clientName: string, name: string): CapabilityDescriptor {
  return descriptor(kind, clientName, name)
}

/** Length-prefixed, UTF-8, well-formed parts after a domain prefix: the same rule for every version. */
function digestParts(domain: string, parts: readonly string[]): string {
  const hash = createHash("sha256").update(`${domain}\0`)
  for (const part of parts) {
    if (
      typeof part !== "string" ||
      !part.length ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(part)
    )
      throw new CapabilityIdentityError("malformed")
    const bytes = Buffer.from(part, "utf8")
    hash.update(`${bytes.length}:`).update(bytes)
  }
  return hash.digest("hex")
}

/** The v2 server commitment: a digest of the server name alone, domain-separated per family. */
export function mcpServerCommitment(kind: "resource" | "prompt", server: string): string {
  return digestParts(`dax.mcp.${kind}.server.v2`, [server])
}

/**
 * A v2 read identity: `mcp.<family>.v2.s<server digest>.m<item digest>`. The
 * item digest covers the server and the item; neither name is recoverable from
 * it except by guessing, and nothing here authenticates the server.
 */
export function mcpReadDescriptorV2(kind: "resource" | "prompt", server: string, item: string): CapabilityDescriptor {
  const namespace = kind === "resource" ? MCP_RESOURCE_V2_NAMESPACE : MCP_PROMPT_V2_NAMESPACE
  const serverDigest = mcpServerCommitment(kind, server)
  const itemDigest = digestParts(`dax.mcp.${kind}.v2`, [server, item])
  return createCapabilityRegistry([
    {
      id: `${namespace}s${serverDigest}.m${itemDigest}`,
      riskClass: "low",
      scopeSupport: "opaque",
      requiresVerification: false,
    },
  ]).list()[0]
}

const V2_READ = /^mcp\.(resource|prompt)\.v2\.s([0-9a-f]{64})\.m([0-9a-f]{64})$/

/** Parses a complete v2 read identity, or undefined for anything else, v1 included. */
export function parseMcpReadV2(
  id: string,
): { family: "resource" | "prompt"; serverDigest: string; itemDigest: string } | undefined {
  const match = V2_READ.exec(id)
  return match
    ? { family: match[1] as "resource" | "prompt", serverDigest: match[2]!, itemDigest: match[3]! }
    : undefined
}

/** A source-qualified, opaque description of one read; never a grant. */
function descriptor(kind: "resource" | "prompt", clientName: string, uri: string): CapabilityDescriptor {
  const digest = digestParts(`dax.mcp.${kind}.v1`, [clientName, uri])
  return createCapabilityRegistry([
    {
      id: `${kind === "resource" ? MCP_RESOURCE_NAMESPACE : MCP_PROMPT_NAMESPACE}m${digest}`,
      riskClass: "low",
      scopeSupport: "opaque",
      requiresVerification: false,
    },
  ]).list()[0]
}

/** Bind the connected SDK client and its read method before transport effects. */
export function bindMcpResourceRead(input: {
  clientName: string
  uri: string
  client: Client
  checkOwner(): void
}): McpResourceBinding {
  input.checkOwner()
  const transport = input.client.transport
  if (!transport || typeof input.client.readResource !== "function") throw new CapabilityIdentityError("malformed")
  const binding = Object.freeze({})
  bindings.set(binding, {
    clientName: input.clientName,
    uri: input.uri,
    client: input.client,
    transport,
    readResource: input.client.readResource,
    descriptor: descriptor("resource", input.clientName, input.uri),
    checkOwner: input.checkOwner,
  })
  return binding
}

/** Recheck owner generation and receiver immediately before effect and after response. */
export function requireMcpResourceRead(input: {
  binding: McpResourceBinding
  clientName: string
  uri: string
  client: Client
}): CapabilityDescriptor {
  const snapshot = bindings.get(input.binding)
  if (!snapshot) throw new CapabilityIdentityError("unbound")
  snapshot.checkOwner()
  if (
    snapshot.clientName !== input.clientName ||
    snapshot.uri !== input.uri ||
    snapshot.client !== input.client ||
    snapshot.transport !== input.client.transport ||
    snapshot.readResource !== input.client.readResource
  )
    throw new CapabilityIdentityError("changed")
  return snapshot.descriptor
}

type PromptSnapshot = {
  clientName: string
  name: string
  client: Client
  transport: NonNullable<Client["transport"]>
  getPrompt: Client["getPrompt"]
  descriptor: CapabilityDescriptor
  checkOwner(): void
}

const promptBindings = new WeakMap<object, PromptSnapshot>()
export type McpPromptBinding = object

/** Bind the connected SDK client and its prompt method before transport effects. */
export function bindMcpPromptRead(input: {
  clientName: string
  name: string
  client: Client
  checkOwner(): void
}): McpPromptBinding {
  input.checkOwner()
  const transport = input.client.transport
  if (!transport || typeof input.client.getPrompt !== "function") throw new CapabilityIdentityError("malformed")
  const binding = Object.freeze({})
  promptBindings.set(binding, {
    clientName: input.clientName,
    name: input.name,
    client: input.client,
    transport,
    getPrompt: input.client.getPrompt,
    descriptor: descriptor("prompt", input.clientName, input.name),
    checkOwner: input.checkOwner,
  })
  return binding
}

/** Recheck owner generation and receiver immediately before effect and after response. */
export function requireMcpPromptRead(input: {
  binding: McpPromptBinding
  clientName: string
  name: string
  client: Client
}): CapabilityDescriptor {
  const snapshot = promptBindings.get(input.binding)
  if (!snapshot) throw new CapabilityIdentityError("unbound")
  snapshot.checkOwner()
  if (
    snapshot.clientName !== input.clientName ||
    snapshot.name !== input.name ||
    snapshot.client !== input.client ||
    snapshot.transport !== input.client.transport ||
    snapshot.getPrompt !== input.client.getPrompt
  )
    throw new CapabilityIdentityError("changed")
  return snapshot.descriptor
}
