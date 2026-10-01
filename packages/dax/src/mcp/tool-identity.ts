import { asSchema, dynamicTool, jsonSchema, type JSONSchema7, type Tool } from "ai"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import type { CapabilityDescriptor } from "@/capability/capability-types"
import {
  CapabilityIdentityError,
  createDynamicCatalog,
  mcpCapability,
  MCP_TOOL_NAMESPACE,
  metadataKey,
} from "@/capability/dynamic-identity"

type Connection = {
  name: string
  client: Client
  timeout?: number
  check(): void
  failed(error: unknown): Promise<void>
}

// The SDK object is not an enrollment credential. Only this owner's genuine
// adapters have a private binding; copies and name matches cannot acquire one.
const bindings = new WeakMap<
  object,
  {
    capability: CapabilityDescriptor
    execute: NonNullable<Tool["execute"]>
    summary: { server: string; name: string; description?: string }
    check(): void
  }
>()

export function mcpExecutionIdentity(tool: Tool) {
  const binding = bindings.get(tool)
  if (!binding) throw new CapabilityIdentityError("unbound")
  binding.check()
  return { kind: "mcp" as const, capability: binding.capability, execute: binding.execute }
}

export function mcpToolSummary(tool: Tool) {
  const binding = bindings.get(tool)
  if (!binding) throw new CapabilityIdentityError("unbound")
  binding.check()
  return { ...binding.summary }
}

/** Private instance-owned catalog; descriptions never authorize an effect. */
export function createMcpToolCatalog() {
  const catalog = createDynamicCatalog(MCP_TOOL_NAMESPACE)
  const epochs = new Map<string, number>()
  const listings = new Map<string, number>()
  const pending = new Map<string, AbortController>()
  type Published = {
    capability: CapabilityDescriptor
    alias: string
    server: string
    name: string
    /** The listed definition and timeout, canonicalized: what a review of this tool saw. */
    definition: string
    current(): void
  }
  let published: Published[] = []
  let disposed = false

  function invalidate(name: string) {
    epochs.set(name, (epochs.get(name) ?? 0) + 1)
    pending.get(name)?.abort(new CapabilityIdentityError("stale"))
  }

  return {
    invalidate,
    /** Valid published tools with the server, raw name and listed definition they came from. */
    entries(): readonly Omit<Published, "current">[] {
      if (disposed) return Object.freeze([])
      return Object.freeze(
        published.flatMap(({ current, ...entry }) => {
          try {
            current()
            return [entry]
          } catch {
            return []
          }
        }),
      )
    },
    /** Descriptors whose catalog generation and connection epoch are both current. */
    list(): readonly CapabilityDescriptor[] {
      if (disposed) return Object.freeze([])
      return Object.freeze(
        published.flatMap((item) => {
          try {
            item.current()
            return [item.capability]
          } catch {
            return []
          }
        }),
      )
    },
    dispose() {
      disposed = true
      catalog.dispose()
      for (const controller of pending.values()) controller.abort(new CapabilityIdentityError("stale"))
    },
    async discover(connections: readonly Connection[]): Promise<Record<string, Tool>> {
      const ticket = catalog.begin()
      const connectionChecks: (() => void)[] = []
      const candidates = (
        await Promise.all(
          connections.map(async (connection) => {
            const { name, client, timeout } = connection
            const epoch = epochs.get(name) ?? 0
            const currentEpoch = () => {
              if (disposed || (epochs.get(name) ?? 0) !== epoch) throw new CapabilityIdentityError("stale")
            }
            const listing = (listings.get(name) ?? 0) + 1
            listings.set(name, listing)
            // listTools also mutates the SDK's output/task validation cache.
            // Abort the older request before that side effect can occur.
            pending.get(name)?.abort(new CapabilityIdentityError("stale"))
            const controller = new AbortController()
            pending.set(name, controller)
            const callTool = client.callTool
            const listTools = client.listTools
            const transport = client.transport
            const checkConnection = () => {
              if (disposed || (epochs.get(name) ?? 0) !== epoch) throw new CapabilityIdentityError("stale")
              connection.check()
              if (!transport || client.transport !== transport) {
                invalidate(name)
                throw new CapabilityIdentityError("stale")
              }
              if (client.callTool !== callTool || client.listTools !== listTools) {
                invalidate(name)
                throw new CapabilityIdentityError("changed")
              }
            }
            checkConnection()
            const result = await listTools
              .call(client, undefined, { signal: controller.signal })
              .catch(async (error) => {
                checkConnection()
                if (listings.get(name) !== listing) throw new CapabilityIdentityError("stale")
                invalidate(name)
                await connection.failed(error)
                return undefined
              })
              .finally(() => {
                if (pending.get(name) === controller) pending.delete(name)
              })
            if (!result) return []
            checkConnection()
            // Include empty lists: invalidation must not publish a stale removal.
            connectionChecks.push(checkConnection)
            try {
              return result.tools.map((definition) => {
                const alias =
                  name.replace(/[^a-zA-Z0-9_-]/g, "_") + "_" + definition.name.replace(/[^a-zA-Z0-9_-]/g, "_")
                const identity = mcpCapability(["mcp", name, definition.name])
                const rawName = definition.name
                const schema: JSONSchema7 = {
                  ...(definition.inputSchema as JSONSchema7),
                  type: "object",
                  properties: (definition.inputSchema.properties ?? {}) as JSONSchema7["properties"],
                  additionalProperties: false,
                }
                const metadata = () =>
                  metadataKey({
                    definition,
                    timeout: timeout ?? null,
                  })
                let original: string
                try {
                  original = metadata()
                } catch {
                  if (listings.get(name) === listing) invalidate(name)
                  throw new CapabilityIdentityError("malformed")
                }
                return {
                  connection,
                  listing,
                  alias,
                  schema,
                  definition,
                  original,
                  metadata,
                  identity,
                  checkConnection,
                  currentEpoch,
                  entry: {
                    alias,
                    source: identity.source,
                    receiver: client,
                    executor: callTool,
                    metadata: original,
                    capability: identity.descriptor,
                  },
                  call(args: unknown) {
                    return callTool.call(
                      client,
                      { name: rawName, arguments: (args || {}) as Record<string, unknown> },
                      CallToolResultSchema,
                      { resetTimeoutOnProgress: true, timeout },
                    )
                  },
                }
              })
            } catch (error) {
              if (listings.get(name) === listing) invalidate(name)
              throw error instanceof CapabilityIdentityError ? error : new CapabilityIdentityError("malformed")
            }
          }),
        )
      ).flat()
      // The entire candidate table is checked before any adapter is offered.
      for (const check of connectionChecks) check()
      const offered = new Map<string, (typeof candidates)[number]>()
      for (const candidate of candidates) {
        const previous = offered.get(candidate.alias)
        if (previous) {
          for (const source of [previous, candidate]) {
            if (listings.get(source.connection.name) === source.listing) invalidate(source.connection.name)
          }
          throw new CapabilityIdentityError("ambiguous")
        }
        offered.set(candidate.alias, candidate)
      }
      const checks = catalog.publish(
        ticket,
        candidates.map((candidate) => candidate.entry),
      )
      published = candidates.map((candidate, index) => ({
        capability: candidate.identity.descriptor,
        alias: candidate.alias,
        server: candidate.connection.name,
        name: candidate.definition.name,
        definition: candidate.original,
        current() {
          checks[index]()
          candidate.currentEpoch()
        },
      }))
      return Object.fromEntries(
        candidates.map((candidate, index) => {
          const description = candidate.definition.description ?? ""
          const check = () => {
            checks[index]()
            candidate.checkConnection()
            if (
              candidate.metadata() !== candidate.original ||
              tool.description !== description ||
              tool.execute !== execute ||
              tool.inputSchema !== inputSchema ||
              metadataKey(asSchema(tool.inputSchema).jsonSchema) !== schemaKey
            ) {
              catalog.changed(candidate.alias)
              throw new CapabilityIdentityError("changed")
            }
          }
          const execute: NonNullable<Tool["execute"]> = async (args) => {
            check()
            return candidate.call(args)
          }
          const inputSchema = jsonSchema(candidate.schema)
          const schemaKey = metadataKey(candidate.schema)
          const tool = dynamicTool({ description, inputSchema, execute })
          bindings.set(tool, {
            capability: candidate.identity.descriptor,
            execute,
            summary: {
              server: candidate.connection.name,
              name: candidate.definition.name,
              ...(candidate.definition.description === undefined
                ? {}
                : { description: candidate.definition.description }),
            },
            check,
          })
          return [candidate.alias, tool]
        }),
      )
    },
  }
}
