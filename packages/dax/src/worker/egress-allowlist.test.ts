import { describe, expect, test } from "bun:test"
import {
  PROVIDER_EGRESS_HOSTS,
  buildEgressAllowlist,
  isEgressHostAllowed,
  normalizeEgressHost,
} from "./egress-allowlist"

describe("normalizeEgressHost", () => {
  test("passes a bare host through, lowercased", () => {
    expect(normalizeEgressHost("API.Anthropic.com")).toBe("api.anthropic.com")
  })

  test("strips a port from a CONNECT-style authority", () => {
    expect(normalizeEgressHost("api.anthropic.com:443")).toBe("api.anthropic.com")
  })

  test("extracts the host from a full URL", () => {
    expect(normalizeEgressHost("https://api.openai.com/v1/responses")).toBe("api.openai.com")
  })

  test("drops a trailing FQDN dot", () => {
    expect(normalizeEgressHost("api.anthropic.com.")).toBe("api.anthropic.com")
  })

  test("handles a bracketed IPv6 literal with a port", () => {
    expect(normalizeEgressHost("[::1]:8080")).toBe("::1")
  })

  test("returns empty for blank input", () => {
    expect(normalizeEgressHost("   ")).toBe("")
    expect(normalizeEgressHost("")).toBe("")
  })
})

describe("buildEgressAllowlist", () => {
  test("uses the provider defaults when nothing else is supplied", () => {
    const allow = buildEgressAllowlist({ workerId: "claude" })
    expect([...allow]).toEqual(["api.anthropic.com"])
  })

  test("adds the host named by the provider base-URL env var", () => {
    const allow = buildEgressAllowlist({
      workerId: "codex",
      hostEnv: { OPENAI_BASE_URL: "https://gateway.internal.example.com/v1" },
    })
    expect(allow.has("api.openai.com")).toBe(true)
    expect(allow.has("gateway.internal.example.com")).toBe(true)
  })

  test("includes the ChatGPT-auth backend host for codex by default", () => {
    const allow = buildEgressAllowlist({ workerId: "codex" })
    expect(allow.has("api.openai.com")).toBe(true)
    expect(allow.has("chatgpt.com")).toBe(true)
  })

  test("ignores a base-URL env var the provider does not consult", () => {
    const allow = buildEgressAllowlist({
      workerId: "gemini",
      hostEnv: { OPENAI_BASE_URL: "https://gateway.internal.example.com" },
    })
    expect(allow.has("gateway.internal.example.com")).toBe(false)
  })

  test("adds operator-supplied hosts, normalized and deduped", () => {
    const allow = buildEgressAllowlist({
      workerId: "claude",
      allowHosts: ["Registry.NPMjs.org:443", "api.anthropic.com"],
    })
    expect(allow.has("registry.npmjs.org")).toBe(true)
    // the duplicate provider default collapses to a single entry
    expect([...allow].filter((h) => h === "api.anthropic.com")).toHaveLength(1)
  })

  test("skips empties instead of admitting a wildcard", () => {
    const allow = buildEgressAllowlist({ workerId: "claude", allowHosts: ["", "   "] })
    expect([...allow]).toEqual(["api.anthropic.com"])
  })

  test("antigravity uses the exact live-characterized host set without Google wildcards", () => {
    const hosts = buildEgressAllowlist({ workerId: "antigravity" })
    expect([...hosts].sort()).toEqual([
      "antigravity-unleash.goog",
      "daily-cloudcode-pa.googleapis.com",
      "lh3.googleusercontent.com",
      "oauth2.googleapis.com",
      "play.googleapis.com",
      "www.googleapis.com",
    ])
    expect(hosts.has("googleapis.com")).toBe(false)
    expect(hosts.has("*.googleapis.com")).toBe(false)
  })
})

describe("isEgressHostAllowed", () => {
  const allow = buildEgressAllowlist({ workerId: "claude" })

  test("permits the exact provider host, port and all", () => {
    expect(isEgressHostAllowed("api.anthropic.com:443", allow)).toBe(true)
  })

  test("refuses a lookalike subdomain (exact match only)", () => {
    expect(isEgressHostAllowed("api.anthropic.com.evil.example.com:443", allow)).toBe(false)
    expect(isEgressHostAllowed("evil-api.anthropic.com:443", allow)).toBe(false)
  })

  test("refuses an unrelated host", () => {
    expect(isEgressHostAllowed("exfil.example.com:443", allow)).toBe(false)
  })

  test("refuses an unparseable target rather than failing open", () => {
    expect(isEgressHostAllowed("", allow)).toBe(false)
  })
})

describe("PROVIDER_EGRESS_HOSTS", () => {
  test("declares a non-empty host set for every known worker", () => {
    for (const worker of Object.keys(PROVIDER_EGRESS_HOSTS)) {
      expect(PROVIDER_EGRESS_HOSTS[worker as keyof typeof PROVIDER_EGRESS_HOSTS].length).toBeGreaterThan(0)
    }
  })
})
