import { createHash } from "node:crypto"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { createCapabilityRegistry } from "@/capability/registry"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import { CapabilityIdentityError } from "@/capability/dynamic-identity"

export const MCP_RESOURCE_NAMESPACE = "mcp.resource.v1."
export const MCP_PROMPT_NAMESPACE = "mcp.prompt.v1."

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

/** A source-qualified, opaque description of one read; never a grant. */
function descriptor(kind: "resource" | "prompt", clientName: string, uri: string): CapabilityDescriptor {
  const hash = createHash("sha256").update(`dax.mcp.${kind}.v1\0`)
  for (const part of [clientName, uri]) {
    if (
      typeof part !== "string" ||
      !part.length ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(part)
    )
      throw new CapabilityIdentityError("malformed")
    const bytes = Buffer.from(part, "utf8")
    hash.update(`${bytes.length}:`).update(bytes)
  }
  return createCapabilityRegistry([
    {
      id: `${kind === "resource" ? MCP_RESOURCE_NAMESPACE : MCP_PROMPT_NAMESPACE}m${hash.digest("hex")}`,
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
