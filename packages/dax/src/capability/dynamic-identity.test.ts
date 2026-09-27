import { describe, expect, test } from "bun:test"
import {
  CapabilityIdentityError,
  createDynamicCatalog,
  metadataKey,
  pluginCapability,
  validationMetadata,
  type DynamicEntry,
} from "./dynamic-identity"
import z from "zod"

function entry(alias = "probe"): DynamicEntry {
  const { descriptor, source } = pluginCapability(["directory", "/private/source", alias])
  return { alias, source, receiver: {}, executor: async () => {}, metadata: "v1", capability: descriptor }
}

describe("dynamic descriptive identity and catalog generations", () => {
  test("source tuple encoding is ordered, length-delimited, opaque and strict", () => {
    const id = pluginCapability(["a.b", "c"]).descriptor.id
    expect(id).not.toBe(pluginCapability(["a", "b.c"]).descriptor.id)
    expect(id).not.toBe(pluginCapability(["c", "a.b"]).descriptor.id)
    expect(pluginCapability(["é"]).descriptor.id).not.toBe(pluginCapability(["é"]).descriptor.id)
    expect(id).toMatch(/^plugin\.tool\.v1\.p[0-9a-f]{64}$/)
    expect(id).not.toContain("source")
    for (const parts of [[], [""], ["\ud800"], ["\udc00"]]) expect(() => pluginCapability(parts)).toThrow("malformed")
    expect(pluginCapability(["😀"]).descriptor.scopeSupport).toBe("opaque")
    expect(Object.isFrozen(pluginCapability(["x"]).descriptor)).toBe(true)
  })

  test("metadata equality is canonical; unsupported objects are rejected", () => {
    expect(metadataKey({ b: 2, a: { d: [], c: null } })).toBe(metadataKey({ a: { c: null, d: [] }, b: 2 }))
    for (const value of [new Map([["key", 1]]), new Date(), undefined, Infinity])
      expect(() => metadataKey(value)).toThrow("malformed")
  })

  test("validation equality preserves plain defaults and detects changed refinement callbacks", () => {
    const shape = { value: z.string().refine(() => true), defaults: z.object({}).default({}) }
    const first = validationMetadata(shape)
    const same = validationMetadata(shape)
    expect(same.key).toBe(first.key)
    expect(same.references).toEqual(first.references)
    Reflect.set(shape.value.def.checks![0]._zod.def, "fn", () => false)
    expect(validationMetadata(shape).references).not.toEqual(first.references)
    const literal = z.unknown().default({ _zod: { def: { fn: "literal, not a schema" } } })
    expect(() => validationMetadata({ literal })).not.toThrow()
  })

  test("unchanged rediscovery preserves an existing generation", () => {
    const catalog = createDynamicCatalog()
    const original = entry()
    const [old] = catalog.publish(catalog.begin(), [original])
    const [fresh] = catalog.publish(catalog.begin(), [{ ...original }])
    expect(() => old()).not.toThrow()
    expect(() => fresh()).not.toThrow()
  })

  for (const change of ["source", "receiver", "executor", "metadata"] as const) {
    test(`changed ${change} invalidates only the affected source`, () => {
      const catalog = createDynamicCatalog()
      const a = entry("a")
      const b = entry("b")
      const [oldA, oldB] = catalog.publish(catalog.begin(), [a, b])
      const changed = { ...a, [change]: change === "executor" ? async () => {} : change === "receiver" ? {} : "v2" }
      if (change === "source") {
        const source = pluginCapability(["directory", "/replacement/source", a.alias])
        changed.source = source.source
        changed.capability = source.descriptor
      }
      const [newA] = catalog.publish(catalog.begin(), [changed, b])
      expect(() => oldA()).toThrow("stale")
      expect(() => oldB()).not.toThrow()
      expect(() => newA()).not.toThrow()
    })
  }

  test("older overlapping result cannot overwrite a newer changed catalog", () => {
    const catalog = createDynamicCatalog()
    const original = entry()
    const oldTicket = catalog.begin()
    const latest = catalog.begin()
    const [current] = catalog.publish(latest, [{ ...original, metadata: "v2" }])
    expect(() => catalog.publish(oldTicket, [original])).toThrow("stale")
    expect(() => current()).not.toThrow()
  })

  test("older equal discovery can reuse but not overwrite healthy current bindings", () => {
    const catalog = createDynamicCatalog()
    const original = entry()
    const oldTicket = catalog.begin()
    const [current] = catalog.publish(catalog.begin(), [original])
    const [old] = catalog.publish(oldTicket, [{ ...original }])
    expect(() => current()).not.toThrow()
    expect(() => old()).not.toThrow()
  })

  test("legacy/enrolled duplicate alias is ambiguous; no partial publication", () => {
    const catalog = createDynamicCatalog()
    const a = entry("a")
    const b = entry("b")
    const [oldA, oldB] = catalog.publish(catalog.begin(), [a, b])
    expect(() => catalog.publish(catalog.begin(), [a, b, { ...entry("a"), capability: undefined }])).toThrow(
      "ambiguous",
    )
    expect(() => oldA()).toThrow("stale")
    expect(() => oldB()).not.toThrow()
  })

  test("duplicate capability and malformed descriptor fail closed", () => {
    const catalog = createDynamicCatalog()
    const a = entry("a")
    expect(() => catalog.publish(catalog.begin(), [a, { ...a, alias: "other" }])).toThrow("ambiguous")
    const malformed = { ...a, capability: { ...a.capability!, grants: [] } }
    expect(() => catalog.publish(catalog.begin(), [malformed])).toThrow("malformed")
  })

  test("stale duplicate discovery cannot damage or bypass the current catalog", () => {
    const catalog = createDynamicCatalog()
    const a = entry("a")
    const b = entry("b")
    const oldTicket = catalog.begin()
    const [healthyA, healthyB] = catalog.publish(catalog.begin(), [a, b])
    expect(() => catalog.publish(oldTicket, [a, a])).toThrow("ambiguous")
    expect(() => healthyA()).not.toThrow()
    expect(() => healthyB()).not.toThrow()
  })

  test("one digest cannot be rebound to another source across successive snapshots", () => {
    const catalog = createDynamicCatalog()
    const original = entry()
    catalog.publish(catalog.begin(), [original])
    expect(() => catalog.publish(catalog.begin(), [{ ...original, source: "different full tuple" }])).toThrow(
      "ambiguous",
    )
  })

  test("explicit invalidation/disposal never resurrect old generations", () => {
    const catalog = createDynamicCatalog()
    const original = entry()
    const oldTicket = catalog.begin()
    const [old] = catalog.publish(oldTicket, [original])
    catalog.changed(original.alias)
    expect(() => catalog.publish(oldTicket, [original])).toThrow("stale")
    const [fresh] = catalog.publish(catalog.begin(), [original])
    expect(() => old()).toThrow("stale")
    catalog.dispose()
    catalog.dispose()
    expect(() => fresh()).toThrow("stale")
    expect(() => catalog.begin()).toThrow("stale")
    expect(new CapabilityIdentityError("changed").message).toBe("Capability identity rejected: changed")
  })
})
