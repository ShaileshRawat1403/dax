import { describe, expect, test } from "bun:test"
import { Config } from "./config"

describe("Config.getPluginName", () => {
  test("extracts name from npm package without scope", () => {
    expect(Config.getPluginName("oh-my-dax@2.4.3")).toBe("oh-my-dax")
  })

  test("extracts name from scoped npm package", () => {
    expect(Config.getPluginName("@scope/pkg@1.0.0")).toBe("@scope/pkg")
  })

  test("extracts name from file URL", () => {
    expect(Config.getPluginName("file:///path/to/plugin/foo.js")).toBe("foo")
  })

  test("returns plugin as-is if no version or file URL", () => {
    expect(Config.getPluginName("some-plugin")).toBe("some-plugin")
  })

  test("handles file URL with complex path", () => {
    expect(Config.getPluginName("file:///Users/test/project/plugins/my-plugin.js")).toBe("my-plugin")
  })
})

describe("Config.deduplicatePlugins", () => {
  test("returns empty array for empty input", () => {
    expect(Config.deduplicatePlugins([])).toEqual([])
  })

  test("returns single item for single item array", () => {
    expect(Config.deduplicatePlugins(["foo@1.0.0"])).toEqual(["foo@1.0.0"])
  })

  test("keeps first occurrence when no duplicates", () => {
    expect(Config.deduplicatePlugins(["plugin-a@1.0.0", "plugin-b@2.0.0"])).toEqual([
      "plugin-a@1.0.0",
      "plugin-b@2.0.0",
    ])
  })

  test("removes duplicates keeping later version", () => {
    expect(Config.deduplicatePlugins(["foo@1.0.0", "bar@1.0.0", "foo@2.0.0"])).toEqual(["bar@1.0.0", "foo@2.0.0"])
  })

  test("handles scoped packages", () => {
    expect(Config.deduplicatePlugins(["@scope/a@1.0.0", "@scope/b@1.0.0", "@scope/a@2.0.0"])).toEqual([
      "@scope/b@1.0.0",
      "@scope/a@2.0.0",
    ])
  })
})
