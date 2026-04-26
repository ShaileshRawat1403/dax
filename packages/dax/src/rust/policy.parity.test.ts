import { describe, expect, test } from "bun:test"
import { evaluatePolicyWithRust, type DaxPolicyRequest } from "./policy"

const DEFAULT_BUDGET = {
  total_allowed: 8,
  mutating_allowed: 6,
  external_allowed: 4,
  total_used: 0,
  mutating_used: 0,
  external_used: 0,
}

// Expected decisions for canonical scenarios — these are the ground truth this
// branch proves. The Rust engine must match these invariants exactly.
const CANONICAL_SCENARIOS: Array<{
  name: string
  request: DaxPolicyRequest
  expected: { decision: string; risk: string }
}> = [
  {
    name: "allow: read_file on repo-safe path (standard)",
    request: {
      session_id: "parity-allow-read",
      action: { type: "tool", tool: "read_file", path: "/project/src/lib.rs" },
      context: { profile: "standard", budget: DEFAULT_BUDGET },
    },
    expected: { decision: "allow", risk: "low" },
  },
  {
    name: "allow: grep on repo-safe path (standard)",
    request: {
      session_id: "parity-allow-grep",
      action: { type: "tool", tool: "grep", path: "/project/src" },
      context: { profile: "standard", budget: DEFAULT_BUDGET },
    },
    expected: { decision: "allow", risk: "low" },
  },
  {
    name: "ask: read_file on .env file (standard)",
    request: {
      session_id: "parity-ask-env",
      action: { type: "tool", tool: "read_file", path: "/project/.env" },
      context: { profile: "standard", budget: DEFAULT_BUDGET },
    },
    expected: { decision: "ask", risk: "high" },
  },
  {
    name: "ask: write_file on repo-safe path (standard — medium risk)",
    request: {
      session_id: "parity-ask-write",
      action: { type: "tool", tool: "write_file", path: "/project/src/new_module.rs" },
      context: { profile: "standard", budget: DEFAULT_BUDGET },
    },
    expected: { decision: "ask", risk: "medium" },
  },
  {
    name: "deny: rm -rf blocklisted",
    request: {
      session_id: "parity-deny-blocked",
      action: { type: "command", command: "rm -rf /" },
      context: { profile: "standard", blocklist: ["rm -rf"], budget: DEFAULT_BUDGET },
    },
    expected: { decision: "deny", risk: "critical" },
  },
  {
    name: "deny: /etc/passwd forbidden path even under permissive",
    request: {
      session_id: "parity-deny-forbidden",
      action: { type: "tool", tool: "read_file", path: "/etc/passwd" },
      context: { profile: "permissive", budget: DEFAULT_BUDGET },
    },
    expected: { decision: "deny", risk: "critical" },
  },
  {
    name: "deny: git commit under strict profile",
    request: {
      session_id: "parity-deny-commit-strict",
      action: { type: "command", command: "git commit -m 'ship it'" },
      context: { profile: "strict", budget: DEFAULT_BUDGET },
    },
    expected: { decision: "deny", risk: "high" },
  },
  {
    name: "deny: budget exhausted",
    request: {
      session_id: "parity-deny-budget",
      action: { type: "command", command: "bun test" },
      context: {
        profile: "standard",
        budget: { ...DEFAULT_BUDGET, total_allowed: 3, total_used: 3 },
      },
    },
    expected: { decision: "deny", risk: "high" },
  },
  {
    name: "allow: cargo build on allowlist bypasses standard ask",
    request: {
      session_id: "parity-allow-allowlist",
      action: { type: "command", command: "cargo build --release" },
      context: { profile: "standard", allowlist: ["cargo build"], budget: DEFAULT_BUDGET },
    },
    expected: { decision: "allow", risk: "medium" },
  },
  {
    name: "allow: git status (verify) under strict profile",
    request: {
      session_id: "parity-allow-status-strict",
      action: { type: "command", command: "git status" },
      context: { profile: "strict", budget: DEFAULT_BUDGET },
    },
    expected: { decision: "allow", risk: "low" },
  },
]

describe(
  "policy parity: Rust engine matches canonical decisions",
  () => {
    for (const { name, request, expected } of CANONICAL_SCENARIOS) {
      test(name, async () => {
        const result = await evaluatePolicyWithRust(request)
        expect(result.decision, `decision mismatch for "${name}"`).toBe(expected.decision)
        expect(result.risk, `risk mismatch for "${name}"`).toBe(expected.risk)
      })
    }
  },
  { timeout: 120_000 },
)
