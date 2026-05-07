import { describe, expect, test } from "bun:test"
import { PolicyEngine } from "../governance/policy-engine"
import { SENSITIVE_PATH_RULES } from "./agent"

/**
 * These tests pin the default sensitive-path gates that protect file
 * discovery and content tools. The same SENSITIVE_PATH_RULES set is
 * applied to read, glob, list, grep, codesearch, webfetch, websearch
 * in the agent defaults. If a future change loosens any of these gates,
 * the test that pins it will fail and force a deliberate decision.
 *
 * The user's own `cfg.permission` overrides still take precedence at
 * runtime (PolicyEngine.evaluate walks the merged ruleset and the last
 * matching rule wins). These tests verify the *defaults*, which apply
 * when the user has not opted out.
 */
describe("default sensitive-path gates", () => {
  // Build a ruleset using the shared rules — same shape used for every
  // discovery/content permission in agent.ts.
  function buildRules(permission: string) {
    return PolicyEngine.fromConfig({
      [permission]: SENSITIVE_PATH_RULES,
    } as any)
  }

  // Pin the rule against every file-discovery / file-content permission
  // so each tool gets the same protection class.
  const PROTECTED_PERMISSIONS: string[] = [
    "read",
    "glob",
    "list",
    "grep",
    "codesearch",
    "webfetch",
    "websearch",
  ]

  describe("each protected permission gates .env files", () => {
    test.each(PROTECTED_PERMISSIONS)("%s asks on bare .env", (perm) => {
      const rules = buildRules(perm)
      expect(PolicyEngine.evaluate(perm, ".env", rules).action).toBe("ask")
    })

    test.each(PROTECTED_PERMISSIONS)("%s asks on .env.production", (perm) => {
      const rules = buildRules(perm)
      expect(PolicyEngine.evaluate(perm, ".env.production", rules).action).toBe("ask")
    })

    test.each(PROTECTED_PERMISSIONS)("%s allows .env.example", (perm) => {
      const rules = buildRules(perm)
      expect(PolicyEngine.evaluate(perm, ".env.example", rules).action).toBe("allow")
    })
  })

  describe("each protected permission gates other secret markers", () => {
    test.each(PROTECTED_PERMISSIONS)("%s asks on path containing 'secrets'", (perm) => {
      const rules = buildRules(perm)
      expect(PolicyEngine.evaluate(perm, "config/secrets/db.json", rules).action).toBe("ask")
    })

    test.each(PROTECTED_PERMISSIONS)("%s asks on path containing 'credentials'", (perm) => {
      const rules = buildRules(perm)
      expect(PolicyEngine.evaluate(perm, "src/credentials.ts", rules).action).toBe("ask")
    })

    test.each(PROTECTED_PERMISSIONS)("%s asks on SSH private key paths", (perm) => {
      const rules = buildRules(perm)
      expect(PolicyEngine.evaluate(perm, "/home/user/.ssh/id_rsa", rules).action).toBe("ask")
      expect(PolicyEngine.evaluate(perm, "/home/user/.ssh/id_ed25519", rules).action).toBe("ask")
      expect(PolicyEngine.evaluate(perm, "/home/user/.ssh/id_ecdsa", rules).action).toBe("ask")
    })

    test.each(PROTECTED_PERMISSIONS)("%s asks on TLS / cert files", (perm) => {
      const rules = buildRules(perm)
      expect(PolicyEngine.evaluate(perm, "certs/server.pem", rules).action).toBe("ask")
      expect(PolicyEngine.evaluate(perm, "certs/server.key", rules).action).toBe("ask")
      expect(PolicyEngine.evaluate(perm, "certs/server.p12", rules).action).toBe("ask")
      expect(PolicyEngine.evaluate(perm, "certs/server.pfx", rules).action).toBe("ask")
    })
  })

  describe("non-sensitive paths remain freely allowed", () => {
    test.each(PROTECTED_PERMISSIONS)("%s allows package.json", (perm) => {
      const rules = buildRules(perm)
      expect(PolicyEngine.evaluate(perm, "package.json", rules).action).toBe("allow")
    })

    test.each(PROTECTED_PERMISSIONS)("%s allows source files", (perm) => {
      const rules = buildRules(perm)
      expect(PolicyEngine.evaluate(perm, "src/app.ts", rules).action).toBe("allow")
      expect(PolicyEngine.evaluate(perm, "packages/dax/README.md", rules).action).toBe("allow")
    })
  })

  test("regression: bare 'glob .env' is no longer auto-allowed", () => {
    // The original bug: glob fell through to a wildcard "*": "allow" rule
    // and the model could enumerate sensitive files without any prompt.
    // This test pins the fix.
    const rules = buildRules("glob")
    expect(PolicyEngine.evaluate("glob", ".env", rules).action).toBe("ask")
    expect(PolicyEngine.evaluate("glob", "**/*.env", rules).action).toBe("ask")
  })
})
