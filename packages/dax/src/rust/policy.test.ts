import { describe, expect, it } from "bun:test"
import { evaluatePolicyWithRust, DaxPolicyError } from "./policy"

const DEFAULT_BUDGET = {
  total_allowed: 8,
  mutating_allowed: 6,
  external_allowed: 4,
  total_used: 0,
  mutating_used: 0,
  external_used: 0,
}

describe(
  "dax-policy Rust adapter",
  () => {
    it("allows read_file on a safe repo path", async () => {
      const result = await evaluatePolicyWithRust({
        session_id: "test-allow-read",
        action: { type: "tool", tool: "read_file", path: "/project/src/main.rs" },
        context: { profile: "standard", budget: DEFAULT_BUDGET },
      })
      expect(result.decision).toBe("allow")
      expect(result.risk).toBe("low")
    })

    it("asks for approval on a sensitive path", async () => {
      const result = await evaluatePolicyWithRust({
        session_id: "test-ask-sensitive",
        action: { type: "tool", tool: "read_file", path: "/project/.env.production" },
        context: { profile: "standard", budget: DEFAULT_BUDGET },
      })
      expect(result.decision).toBe("ask")
      expect(result.risk).toBe("high")
      expect(result.gate).toBe("human_approval")
    })

    it("denies a blocklisted command", async () => {
      const result = await evaluatePolicyWithRust({
        session_id: "test-deny-blocked",
        action: { type: "command", command: "rm -rf /" },
        context: { profile: "standard", blocklist: ["rm -rf"], budget: DEFAULT_BUDGET },
      })
      expect(result.decision).toBe("deny")
      expect(result.risk).toBe("critical")
    })

    it("denies when budget is exhausted", async () => {
      const result = await evaluatePolicyWithRust({
        session_id: "test-deny-budget",
        action: { type: "command", command: "cargo test" },
        context: {
          profile: "standard",
          budget: { ...DEFAULT_BUDGET, total_allowed: 5, total_used: 5 },
        },
      })
      expect(result.decision).toBe("deny")
    })

    it("denies git commit in strict profile", async () => {
      const result = await evaluatePolicyWithRust({
        session_id: "test-deny-commit-strict",
        action: { type: "command", command: "git commit -m 'release'" },
        context: { profile: "strict", budget: DEFAULT_BUDGET },
      })
      expect(result.decision).toBe("deny")
      expect(result.risk).toBe("high")
    })

    it("denies access to forbidden path even with permissive profile", async () => {
      const result = await evaluatePolicyWithRust({
        session_id: "test-deny-forbidden",
        action: { type: "tool", tool: "read_file", path: "/etc/passwd" },
        context: { profile: "permissive", budget: DEFAULT_BUDGET },
      })
      expect(result.decision).toBe("deny")
      expect(result.risk).toBe("critical")
    })

    it("allows allowlisted command past normal ask threshold", async () => {
      const result = await evaluatePolicyWithRust({
        session_id: "test-allow-allowlist",
        action: { type: "command", command: "cargo build --release" },
        context: { profile: "standard", allowlist: ["cargo build"], budget: DEFAULT_BUDGET },
      })
      expect(result.decision).toBe("allow")
    })

    it("throws DaxPolicyError on invalid request JSON", async () => {
      await expect(
        evaluatePolicyWithRust({ session_id: "", action: null as never }),
      ).rejects.toBeInstanceOf(DaxPolicyError)
    })
  },
  { timeout: 120_000 },
)
