import { describe, expect, it } from "bun:test"
import os from "os"
import { buildPreferredNamePrompt, resolvePreferredName, sessionPreferredNameKey } from "./user-profile"

describe("user profile helpers", () => {
  it("prefers session name over global name", () => {
    const store: Record<string, string> = {
      [sessionPreferredNameKey("session_1")]: "Ananya",
      preferred_name_default: "Friend",
    }
    const result = resolvePreferredName({
      sessionID: "session_1",
      configUsername: "machine-user",
      kvGet: (key, defaultValue) => store[key] ?? defaultValue,
    })
    expect(result).toBe("Ananya")
  })

  it("falls back to the global name when the session has no override", () => {
    const store: Record<string, string> = { preferred_name_default: "Friend" }

    const result = resolvePreferredName({
      sessionID: "session_without_override",
      kvGet: (key, defaultValue) => store[key] ?? defaultValue,
    })

    expect(result).toBe("Friend")
  })

  it("ignores a config username that is just the OS account name", () => {
    // The config default mirrors the machine account, which is not a name the
    // operator chose to be addressed by.
    const result = resolvePreferredName({
      configUsername: os.userInfo().username,
      kvGet: () => undefined,
    })

    expect(result).toBeUndefined()
  })

  it("builds a sparse preferred-name prompt", () => {
    expect(buildPreferredNamePrompt("Ananya")).toContain("addressed as Ananya")
  })
})
