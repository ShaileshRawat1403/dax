import { describe, expect, test } from "bun:test"
import { PolicyEngine } from "./engine"

describe("policy engine", () => {
  test("evaluate respects last matching wildcard rule", () => {
    const rules = PolicyEngine.fromConfig({
      bash: "allow",
      edit: {
        "*": "ask",
        "src/*": "allow",
        "src/secrets/*": "deny",
      },
    } as any)

    expect(PolicyEngine.evaluate("bash", "package.json", rules).action).toBe("allow")
    expect(PolicyEngine.evaluate("edit", "src/app.ts", rules).action).toBe("allow")
    expect(PolicyEngine.evaluate("edit", "src/secrets/key.ts", rules).action).toBe("deny")
    expect(PolicyEngine.evaluate("edit", "README.md", rules).action).toBe("ask")
  })

  test("disabled collapses edit-family tools behind edit permission", () => {
    const rules = PolicyEngine.fromConfig({
      edit: "deny",
      bash: "allow",
    } as any)

    const disabled = PolicyEngine.disabled(["edit", "write", "patch", "multiedit", "bash"], rules)

    expect(disabled.has("edit")).toBeTrue()
    expect(disabled.has("write")).toBeTrue()
    expect(disabled.has("patch")).toBeTrue()
    expect(disabled.has("multiedit")).toBeTrue()
    expect(disabled.has("bash")).toBeFalse()
  })
})
