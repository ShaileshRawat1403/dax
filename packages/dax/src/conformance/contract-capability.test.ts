import { describe, expect, test } from "bun:test"
import { expectGap } from "./known-gaps"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariant 5 — Contract-Defined Authority.
 *
 * Capabilities describe what can exist. Contracts determine what this run may
 * exercise.
 *
 *     Contract   = operator-approved execution authority
 *     Capability = vocabulary used to express that authority
 *     Grant      = contract-specific permission to exercise a capability
 *
 * Decision procedure: is authority expressed once, in the contract, or does the
 * capability carry a second policy?
 *
 * This invariant exists to prevent a specific failure: two overlapping policy
 * systems under cleaner names. A capability may declare intrinsic properties
 * (risk class, whether it supports scoping, whether it requires verification). It
 * may not declare authority. Authority belongs to the contract, because the
 * contract is the artifact an operator reviews.
 *
 * Nothing here exists at v1.3.0. This file specifies the shape rather than
 * measuring drift — it is the only test in the suite that fails because a thing is
 * absent rather than wrong.
 */

const SRC = join(import.meta.dir, "..")

describe("invariant 5 — contract-defined authority", () => {
  test("a capability vocabulary exists", () => {
    // Expected: a single registry naming every executable capability —
    // filesystem.write, shell.execute, git.patch, codex.delegate, repo.inspect, …
    // Today these are separate architectural categories (tool, worker, agent,
    // plugin, sandbox, provider) with no shared vocabulary between them.
    expectGap("inv5.capability-vocabulary", () => {
      expect(existsSync(join(SRC, "capability"))).toBe(true)
    })
  })

  test("capabilities declare intrinsic properties but not authority", () => {
    const path = join(SRC, "capability/capability-types.ts")

    expectGap("inv5.capability-properties", () => {
      const declared = readFileSync(path, "utf8")

      // Intrinsic — what this capability is:
      expect(declared).toMatch(/risk_class|riskClass/)
      expect(declared).toMatch(/requires_verification|requiresVerification/)
      expect(declared).toMatch(/supports_scope|supportsScope/)

      // Not intrinsic — what this run may do. A capability naming concrete paths,
      // budgets or hosts has become a second policy system.
      expect(declared).not.toMatch(/writeScope|forbiddenPaths|mutation_budget|allowHosts/)
    })
  })

  test("the contract expresses authority as capability grants", () => {
    // The execution contract already carries writeScope, forbiddenPaths,
    // verification, egress and provenance. Under this invariant those become the
    // fields of a grant against a named capability, rather than a flat policy blob
    // whose relationship to any particular action is implicit.
    expectGap("inv5.contract-grants", () => {
      expect(existsSync(join(SRC, "capability/grant.ts"))).toBe(true)
    })
  })

  test("every execution path resolves authority through the same grant lookup", () => {
    // The point of the vocabulary. A native edit, a worker patch and a delegated
    // subagent action should all answer "am I permitted?" by resolving a grant,
    // not by consulting three different mechanisms.
    expectGap("inv5.grant-resolution", () => {
      expect(existsSync(join(SRC, "capability/resolve-grant.ts"))).toBe(true)
    })
  })
})
