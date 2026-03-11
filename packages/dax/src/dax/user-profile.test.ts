import { describe, expect, it } from "bun:test"
import { buildPreferredNamePrompt, resolvePreferredName, sessionPreferredNameKey } from "./user-profile"

describe("user profile helpers", () => {
  it("prefers session name over global name", () => {
    const store = {
      [sessionPreferredNameKey("session_1")]: "Ananya",
      preferred_name_default: "Friend",
    }
    const result = resolvePreferredName({
      sessionID: "session_1",
      configUsername: "machine-user",
      kvGet(key: string, defaultValue?: any) {
        return key in store ? (store as any)[key] : defaultValue
      },
    })
    expect(result).toBe("Ananya")
  })

  it("builds a sparse preferred-name prompt", () => {
    expect(buildPreferredNamePrompt("Ananya")).toContain("addressed as Ananya")
  })
})
