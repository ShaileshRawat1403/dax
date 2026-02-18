import { afterEach, describe, expect, test } from "bun:test"
import { Flag, readEnv } from "../../src/flag/flag"

const keep = [
  "DAX_CLIENT",
  "OPENCODE_CLIENT",
  "DAX_CONFIG_DIR",
  "OPENCODE_CONFIG_DIR",
  "DAX_DISABLE_PROJECT_CONFIG",
  "OPENCODE_DISABLE_PROJECT_CONFIG",
  "DAX_SERVER_PASSWORD",
  "OPENCODE_SERVER_PASSWORD",
]

function reset() {
  keep.forEach((key) => delete process.env[key])
}

const original = Object.fromEntries(keep.map((key) => [key, process.env[key]]))

afterEach(() => {
  keep.forEach((key) => {
    const value = original[key]
    if (value !== undefined) {
      process.env[key] = value
      return
    }
    delete process.env[key]
  })
})

describe("flag env compatibility", () => {
  test("readEnv prefers DAX value over legacy", () => {
    reset()
    process.env.OPENCODE_SERVER_PASSWORD = "legacy"
    process.env.DAX_SERVER_PASSWORD = "primary"
    expect(readEnv("DAX_SERVER_PASSWORD")).toBe("primary")
  })

  test("readEnv falls back to legacy OPENCODE key", () => {
    reset()
    process.env.OPENCODE_SERVER_PASSWORD = "legacy"
    expect(readEnv("DAX_SERVER_PASSWORD")).toBe("legacy")
  })

  test("DAX_CLIENT getter falls back to OPENCODE_CLIENT", () => {
    reset()
    process.env.OPENCODE_CLIENT = "desktop"
    expect(Flag.DAX_CLIENT).toBe("desktop")
  })

  test("DAX_CONFIG_DIR getter falls back to OPENCODE_CONFIG_DIR", () => {
    reset()
    process.env.OPENCODE_CONFIG_DIR = "/tmp/legacy"
    expect(Flag.DAX_CONFIG_DIR).toBe("/tmp/legacy")
  })

  test("DAX_DISABLE_PROJECT_CONFIG getter falls back to OPENCODE_DISABLE_PROJECT_CONFIG", () => {
    reset()
    process.env.OPENCODE_DISABLE_PROJECT_CONFIG = "true"
    expect(Flag.DAX_DISABLE_PROJECT_CONFIG).toBe(true)
  })
})
