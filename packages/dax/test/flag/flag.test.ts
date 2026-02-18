import { afterEach, describe, expect, test } from "bun:test"
import { Flag, readEnv } from "../../src/flag/flag"

const keep = [
  "DAX_CLIENT",
  "DAX_CONFIG_DIR",
  "DAX_DISABLE_PROJECT_CONFIG",
  "DAX_SERVER_PASSWORD",
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

describe("flag env", () => {
  test("readEnv reads DAX value", () => {
    reset()
    process.env.DAX_SERVER_PASSWORD = "primary"
    expect(readEnv("DAX_SERVER_PASSWORD")).toBe("primary")
  })

  test("readEnv returns undefined when not set", () => {
    reset()
    expect(readEnv("DAX_SERVER_PASSWORD")).toBeUndefined()
  })

  test("DAX_CLIENT getter returns default cli", () => {
    reset()
    expect(Flag.DAX_CLIENT).toBe("cli")
  })

  test("DAX_CONFIG_DIR getter reads DAX_CONFIG_DIR", () => {
    reset()
    process.env.DAX_CONFIG_DIR = "/tmp/dax"
    expect(Flag.DAX_CONFIG_DIR).toBe("/tmp/dax")
  })

  test("DAX_DISABLE_PROJECT_CONFIG getter reads DAX_DISABLE_PROJECT_CONFIG", () => {
    reset()
    process.env.DAX_DISABLE_PROJECT_CONFIG = "true"
    expect(Flag.DAX_DISABLE_PROJECT_CONFIG).toBe(true)
  })
})
