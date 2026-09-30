import { describe, expect, test } from "bun:test"
import { createDynamicCatalog, CapabilityIdentityError, pluginCapability, mcpCapability } from "./dynamic-identity"
import { composeCapabilityVocabulary, CapabilityVocabularyError, type CapabilityFamily } from "./vocabulary"

const descriptor = (id: string) => ({ id, riskClass: "low", scopeSupport: "none", requiresVerification: false })
const family = (name: string, namespace: string, ids: string[]): CapabilityFamily => ({
  name,
  namespace,
  enumeration: "listed",
  descriptors: ids.map(descriptor),
})

function rejection(run: () => unknown) {
  let reason: unknown
  try {
    run()
  } catch (error) {
    reason = error
  }
  expect(reason).toBeInstanceOf(Error)
  return reason
}

describe("composed capability vocabulary", () => {
  test("composes families into one immutable listing with family ownership", () => {
    const vocabulary = composeCapabilityVocabulary([
      family("alpha", "alpha.tool.", ["alpha.tool.one", "alpha.tool.two"]),
      family("beta", "beta.", ["beta.one"]),
      { name: "gamma", namespace: "gamma.read.", enumeration: "on_demand", descriptors: [] },
    ])
    expect(vocabulary.list().map((item) => item.id)).toEqual(["alpha.tool.one", "alpha.tool.two", "beta.one"])
    expect(vocabulary.require("beta.one").riskClass).toBe("low")
    expect(vocabulary.familyOf("alpha.tool.two")).toBe("alpha")
    expect(vocabulary.familyOf("delta.one")).toBeUndefined()
    expect(vocabulary.covers("alpha.tool.one")).toBe(true)
    // A listed family covers only what it lists; an on-demand family covers its namespace.
    expect(vocabulary.covers("alpha.tool.unlisted")).toBe(false)
    expect(vocabulary.covers("gamma.read.anything")).toBe(true)
    expect(() => vocabulary.require("gamma.read.anything")).toThrow("Unknown capability")
    expect(() => vocabulary.require("alpha.tool.unlisted")).toThrow("Unknown capability")
    expect(Object.isFrozen(vocabulary)).toBe(true)
    expect(Object.isFrozen(vocabulary.list())).toBe(true)
    expect(Object.isFrozen(vocabulary.require("beta.one"))).toBe(true)
  })

  test("rejects an ID claimed by two families through overlapping namespaces", () => {
    for (const [first, second] of [
      ["shared.", "shared."],
      ["shared.", "shared.tool."],
      ["shared.tool.", "shared."],
    ]) {
      expect(
        rejection(() =>
          composeCapabilityVocabulary([
            family("alpha", first, ["shared.tool.one"]),
            family("beta", second, ["shared.tool.one"]),
          ]),
        ),
      ).toMatchObject({ code: "namespace_conflict" })
    }
  })

  test("rejects an ID outside its family's namespace, so no family can mint another's identity", () => {
    expect(
      rejection(() =>
        composeCapabilityVocabulary([family("alpha", "alpha.", ["alpha.one"]), family("beta", "beta.", ["alpha.one"])]),
      ),
    ).toMatchObject({ code: "outside_namespace" })
    // A sibling prefix is not the namespace.
    expect(
      rejection(() => composeCapabilityVocabulary([family("alpha", "alpha.tool.", ["alpha.toolbox.one"])])),
    ).toMatchObject({ code: "outside_namespace" })
  })

  test("rejects duplicate IDs, duplicate family names, and malformed families or descriptors", () => {
    expect(() => composeCapabilityVocabulary([family("alpha", "alpha.", ["alpha.one", "alpha.one"])])).toThrow(
      "Duplicate capability",
    )
    expect(
      rejection(() =>
        composeCapabilityVocabulary([family("alpha", "alpha.", ["alpha.one"]), family("alpha", "beta.", ["beta.one"])]),
      ),
    ).toMatchObject({ code: "malformed_family" })
    for (const namespace of ["alpha", "Alpha.", ".", "", "alpha..", "alpha.*."]) {
      expect(rejection(() => composeCapabilityVocabulary([family("alpha", namespace, [])]))).toBeInstanceOf(
        CapabilityVocabularyError,
      )
    }
    expect(
      rejection(() =>
        composeCapabilityVocabulary([
          { name: "alpha", namespace: "alpha.", enumeration: "on_demand", descriptors: [descriptor("alpha.one")] },
        ]),
      ),
    ).toMatchObject({ code: "malformed_family" })
    // Authority-bearing fields are rejected by the strict descriptor schema.
    expect(() =>
      composeCapabilityVocabulary([
        { ...family("alpha", "alpha.", []), descriptors: [{ ...descriptor("alpha.one"), grants: ["*"] }] },
      ]),
    ).toThrow()
  })

  test("a rejected composition publishes nothing and leaves earlier snapshots unchanged", () => {
    const first = composeCapabilityVocabulary([family("alpha", "alpha.", ["alpha.one"])])
    rejection(() =>
      composeCapabilityVocabulary([family("alpha", "alpha.", ["alpha.one", "alpha.two"]), family("beta", "alpha.", [])]),
    )
    expect(first.list().map((item) => item.id)).toEqual(["alpha.one"])
    const second = composeCapabilityVocabulary([family("alpha", "alpha.", ["alpha.two"])])
    expect(first.covers("alpha.two")).toBe(false)
    expect(second.covers("alpha.one")).toBe(false)
  })

  test("a dynamic catalog refuses identities outside its namespace and lists only valid entries", () => {
    const plugin = pluginCapability(["directory", "/tmp/probe.js", "default"])
    const mcp = mcpCapability(["mcp", "alpha", "probe"])
    const entry = (alias: string, identity: typeof plugin) => ({
      alias,
      source: identity.source,
      receiver: {},
      executor: {},
      metadata: "m",
      capability: identity.descriptor,
    })
    const catalog = createDynamicCatalog("plugin.tool.v1.")
    expect(rejection(() => catalog.publish(catalog.begin(), [entry("probe", mcp)]))).toMatchObject({
      code: "malformed",
    })
    expect(catalog.list()).toEqual([])

    const legacy = { alias: "legacy", source: "legacy_custom", receiver: {}, executor: {}, metadata: "legacy" }
    catalog.publish(catalog.begin(), [entry("probe", plugin), legacy])
    // Legacy registration has no descriptor and is never listed as enrolled.
    expect(catalog.list().map((item) => item.id)).toEqual([plugin.descriptor.id])
    catalog.changed("probe")
    expect(catalog.list()).toEqual([])
    catalog.publish(catalog.begin(), [entry("probe", plugin)])
    expect(catalog.list().map((item) => item.id)).toEqual([plugin.descriptor.id])
    catalog.dispose()
    expect(catalog.list()).toEqual([])
    expect(rejection(() => catalog.begin())).toBeInstanceOf(CapabilityIdentityError)
  })
})
