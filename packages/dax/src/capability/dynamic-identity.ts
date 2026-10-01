import { createHash } from "node:crypto"
import { createCapabilityRegistry } from "./registry"
import type { CapabilityDescriptor } from "./capability-types"
import z from "zod"
import { NamedError } from "@dax-ai/util/error"

export class CapabilityIdentityError extends NamedError.Unknown {
  constructor(public readonly code: "unbound" | "changed" | "stale" | "malformed" | "ambiguous") {
    // Do not retain source locators, arguments, or arbitrary exception text.
    const message = `Capability identity rejected: ${code}`
    super({ message })
    this.message = message
  }
}

export const PLUGIN_TOOL_NAMESPACE = "plugin.tool.v1."
export const MCP_TOOL_NAMESPACE = "mcp.tool.v1."

/** Private source encoding; an opaque logical identity, not a code attestation. */
export function pluginCapability(parts: readonly string[]) {
  return sourceCapability("plugin", parts)
}

export function mcpCapability(parts: readonly string[]) {
  return sourceCapability("mcp", parts)
}

function sourceCapability(kind: "plugin" | "mcp", parts: readonly string[]) {
  if (!parts.length) throw new CapabilityIdentityError("malformed")
  const hash = createHash("sha256").update(`dax.${kind}.tool.v1\0`)
  for (const part of parts) {
    if (
      typeof part !== "string" ||
      !part.length ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(part)
    ) {
      throw new CapabilityIdentityError("malformed")
    }
    const bytes = Buffer.from(part, "utf8")
    hash.update(`${bytes.length}:`).update(bytes)
  }
  const descriptor = createCapabilityRegistry([
    {
      id: `${kind === "plugin" ? `${PLUGIN_TOOL_NAMESPACE}p` : `${MCP_TOOL_NAMESPACE}m`}${hash.digest("hex")}`,
      riskClass: "high",
      scopeSupport: "opaque",
      requiresVerification: true,
    },
  ]).list()[0]
  return { descriptor, source: JSON.stringify(parts) }
}

/** Stable ordering for schema equality, without retaining schema content publicly. */
export function metadataKey(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input
    if (typeof input === "number" && Number.isFinite(input)) return input
    if (Array.isArray(input)) return input.map(canonical)
    if (typeof input === "object" && input && Object.getPrototypeOf(input) === Object.prototype) {
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)]),
      )
    }
    throw new CapabilityIdentityError("malformed")
  }
  return JSON.stringify(canonical(value))
}

/** Include typed Zod validation definitions and callback identity, not function text. */
export function validationMetadata(shape: z.ZodRawShape) {
  const references: object[] = []
  const seen = new Map<object, number>()
  function visit(value: unknown): unknown {
    if (value === undefined) return ["undefined"]
    if (value === null) return ["null"]
    if (typeof value === "string" || typeof value === "boolean") return [typeof value, value]
    if (typeof value === "number" && Number.isFinite(value)) return ["number", value]
    if (typeof value === "function") {
      references.push(value)
      return ["function", references.length - 1]
    }
    if (typeof value !== "object") throw new CapabilityIdentityError("malformed")
    const cycle = seen.get(value)
    if (cycle !== undefined) return ["cycle", cycle]
    seen.set(value, seen.size)
    if (Array.isArray(value)) return ["array", value.map(visit)]
    if (Object.getPrototypeOf(value) === Object.prototype) {
      return [
        "object",
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, visit(item)]),
      ]
    }
    if (value instanceof z.core.$ZodType || value instanceof z.core.$ZodCheck) {
      references.push(value)
      return ["zod", references.length - 1, visit(value._zod.def)]
    }
    if (value instanceof RegExp) return ["regexp", value.source, value.flags, value.lastIndex]
    throw new CapabilityIdentityError("malformed")
  }
  return { key: metadataKey(visit(shape)), references }
}

export type DynamicEntry = {
  alias: string
  source: string
  receiver: object
  executor: object
  metadata: string
  capability?: CapabilityDescriptor
  references?: readonly object[]
}

/**
 * One instance's dynamic catalog. Nothing here resolves execution permission.
 * A catalog that names its namespace refuses enrolled IDs outside it, so two
 * catalogs composed into one vocabulary cannot publish the same identity.
 */
export function createDynamicCatalog(namespace?: string) {
  let latest = 0
  let disposed = false
  const records = new Map<string, { entry: DynamicEntry; active: boolean }>()
  const knownSources = new Map<string, string>()
  function equal(a: DynamicEntry, b: DynamicEntry) {
    return (
      a.source === b.source &&
      a.receiver === b.receiver &&
      a.executor === b.executor &&
      a.metadata === b.metadata &&
      a.capability?.id === b.capability?.id &&
      a.capability?.riskClass === b.capability?.riskClass &&
      a.capability?.scopeSupport === b.capability?.scopeSupport &&
      a.capability?.requiresVerification === b.capability?.requiresVerification &&
      (a.references?.length ?? 0) === (b.references?.length ?? 0) &&
      (a.references ?? []).every((reference, index) => reference === b.references?.[index])
    )
  }
  function checks(entries: readonly DynamicEntry[]) {
    return entries.map((entry) => {
      const alias = entry.alias
      const record = records.get(alias)!
      return () => {
        if (disposed || !record.active || records.get(alias) !== record) throw new CapabilityIdentityError("stale")
      }
    })
  }
  function invalidate(alias: string) {
    const record = records.get(alias)
    if (record) record.active = false
  }
  return {
    begin() {
      if (disposed) throw new CapabilityIdentityError("stale")
      return ++latest
    },
    changed(alias: string) {
      ++latest
      invalidate(alias)
    },
    dispose() {
      disposed = true
      ++latest
      for (const record of records.values()) record.active = false
    },
    /**
     * The currently valid enrolled entries' source and metadata, for binding a
     * reviewed grant to what it was reviewed against. Empty once disposed.
     */
    entries(): readonly { alias: string; source: string; metadata: string; capability: CapabilityDescriptor }[] {
      if (disposed) return Object.freeze([])
      return Object.freeze(
        [...records.values()].flatMap((record) =>
          record.active && record.entry.capability
            ? [
                {
                  alias: record.entry.alias,
                  source: record.entry.source,
                  metadata: record.entry.metadata,
                  capability: record.entry.capability,
                },
              ]
            : [],
        ),
      )
    },
    /** Descriptors of currently valid enrolled entries; empty once disposed. */
    list(): readonly CapabilityDescriptor[] {
      if (disposed) return Object.freeze([])
      return Object.freeze(
        [...records.values()].flatMap((record) =>
          record.active && record.entry.capability ? [record.entry.capability] : [],
        ),
      )
    },
    publish(ticket: number, entries: readonly DynamicEntry[]) {
      if (disposed) throw new CapabilityIdentityError("stale")
      try {
        entries = entries.map((entry) =>
          Object.freeze({
            ...entry,
            capability: entry.capability ? createCapabilityRegistry([entry.capability]).list()[0] : undefined,
            references: Object.freeze([...(entry.references ?? [])]),
          }),
        )
      } catch {
        throw new CapabilityIdentityError("malformed")
      }
      const aliases = new Set<string>()
      const identities = new Map<string, string>()
      for (const entry of entries) {
        if (!entry.alias || aliases.has(entry.alias)) {
          if (ticket === latest) invalidate(entry.alias)
          throw new CapabilityIdentityError("ambiguous")
        }
        aliases.add(entry.alias)
        if (!entry.capability) continue // legacy custom registration, explicitly unenrolled
        if (namespace !== undefined && !entry.capability.id.startsWith(namespace)) {
          throw new CapabilityIdentityError("malformed")
        }
        const previous = identities.get(entry.capability.id)
        if (previous !== undefined) {
          if (ticket === latest) {
            invalidate(entry.alias)
            for (const other of entries) if (other.capability?.id === entry.capability.id) invalidate(other.alias)
          }
          throw new CapabilityIdentityError("ambiguous")
        }
        const known = knownSources.get(entry.capability.id)
        if (known !== undefined && known !== entry.source) throw new CapabilityIdentityError("ambiguous")
        identities.set(entry.capability.id, entry.source)
      }
      // Validate even stale candidates. They may reuse an exactly equal table,
      // never overwrite newer state or resurrect an invalidated generation.
      if (ticket !== latest) {
        if (
          records.size === entries.length &&
          entries.every((entry) => {
            const current = records.get(entry.alias)
            return current?.active && equal(current.entry, entry)
          })
        )
          return checks(entries)
        throw new CapabilityIdentityError("stale")
      }
      // Reuse generations only when all execution-relevant fields are unchanged.
      const next = new Map<string, { entry: DynamicEntry; active: boolean }>()
      for (const entry of entries) {
        const previous = records.get(entry.alias)
        const same = previous?.active && equal(previous.entry, entry)
        next.set(entry.alias, same ? previous! : { entry, active: true })
      }
      for (const [alias, previous] of records) if (next.get(alias) !== previous) previous.active = false
      records.clear()
      for (const [alias, record] of next) records.set(alias, record)
      for (const [id, source] of identities) knownSources.set(id, source)
      return checks(entries)
    },
  }
}
