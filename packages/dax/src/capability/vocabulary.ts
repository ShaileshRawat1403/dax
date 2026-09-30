import type { CapabilityDescriptor } from "./capability-types"
import { createCapabilityRegistry } from "./registry"

/**
 * One family's contribution to the vocabulary. `namespace` is the ID prefix
 * the family owns. An `on_demand` family mints source-qualified IDs at the
 * moment of use (one MCP resource read, for example) and cannot be enumerated
 * in advance; it still owns its namespace exclusively.
 */
export type CapabilityFamily = {
  name: string
  namespace: string
  enumeration: "listed" | "on_demand"
  descriptors: readonly unknown[]
}

export class CapabilityVocabularyError extends Error {
  constructor(
    public readonly code: "malformed_family" | "namespace_conflict" | "outside_namespace",
    detail: string,
  ) {
    super(`Capability vocabulary rejected: ${code} (${detail})`)
  }
}

const NAMESPACE = /^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*\.$/

/**
 * Compose family catalogs into one validated, immutable vocabulary.
 *
 * The whole input is validated before anything is returned, so a rejected
 * family publishes nothing. The result is a value, not shared state: callers
 * that need the current dynamic entries compose a fresh snapshot. Like every
 * registry here it describes what can exist and never decides what may run.
 */
export function composeCapabilityVocabulary(families: readonly CapabilityFamily[]) {
  const entries = new Map<string, CapabilityDescriptor>()
  const namespaces: { name: string; namespace: string; enumeration: CapabilityFamily["enumeration"] }[] = []

  for (const family of families) {
    if (
      !family ||
      typeof family.name !== "string" ||
      !family.name ||
      typeof family.namespace !== "string" ||
      !NAMESPACE.test(family.namespace) ||
      (family.enumeration !== "listed" && family.enumeration !== "on_demand") ||
      !Array.isArray(family.descriptors) ||
      (family.enumeration === "on_demand" && family.descriptors.length > 0)
    )
      throw new CapabilityVocabularyError("malformed_family", String(family?.name))
    for (const other of namespaces) {
      if (other.name === family.name) throw new CapabilityVocabularyError("malformed_family", family.name)
      // A prefix relation in either direction would let two families mint the same ID.
      if (other.namespace.startsWith(family.namespace) || family.namespace.startsWith(other.namespace))
        throw new CapabilityVocabularyError("namespace_conflict", `${other.name}, ${family.name}`)
    }
    namespaces.push({ name: family.name, namespace: family.namespace, enumeration: family.enumeration })

    // Validates each descriptor strictly and rejects duplicates within the family.
    // Disjoint namespaces then make a cross-family duplicate impossible.
    for (const descriptor of createCapabilityRegistry(family.descriptors).list()) {
      if (!descriptor.id.startsWith(family.namespace))
        throw new CapabilityVocabularyError("outside_namespace", `${family.name}: ${descriptor.id}`)
      entries.set(descriptor.id, descriptor)
    }
  }

  function familyOf(id: string): string | undefined {
    return namespaces.find((item) => id.startsWith(item.namespace))?.name
  }

  return Object.freeze({
    /** A listed descriptor. On-demand IDs are not enumerable and do not resolve here. */
    require(id: string): CapabilityDescriptor {
      const descriptor = entries.get(id)
      if (!descriptor) throw new Error(`Unknown capability: ${id}`)
      return descriptor
    },
    list(): readonly CapabilityDescriptor[] {
      return Object.freeze([...entries.values()])
    },
    familyOf,
    /** True when the ID is listed, or belongs to an on-demand family's namespace. */
    covers(id: string): boolean {
      if (entries.has(id)) return true
      const family = namespaces.find((item) => id.startsWith(item.namespace))
      return family?.enumeration === "on_demand"
    },
    families(): readonly { name: string; namespace: string; enumeration: CapabilityFamily["enumeration"] }[] {
      return Object.freeze(namespaces.map((item) => Object.freeze({ ...item })))
    },
  })
}

export type CapabilityVocabulary = ReturnType<typeof composeCapabilityVocabulary>
