import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * The release gates, asserted against the files that actually run them.
 *
 * Three defects motivate this, and all three were invisible to every other test:
 *
 *   - CI's push filter listed `feature/**` but not `feat/**`, which is the prefix
 *     this repository actually uses, so release-candidate branches could be pushed
 *     with no CI run at all.
 *   - The tag release workflow ran `release:check` alone. Typecheck, lint, tests,
 *     smoke evals and the whole Rust toolchain were CI-only, so a tag could publish
 *     a commit that never passed them.
 *   - The declared Bun version differed between the root manifest and CI, and the
 *     release workflow pinned none, so release could build on a different runtime
 *     than the one the candidate was verified against.
 *
 * These are configuration facts, so they are asserted as configuration rather than
 * exercised — but they are asserted against the real files, not a copy.
 */

const root = path.resolve(import.meta.dir, "../../../..")
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8")

const ci = read(".github/workflows/ci.yml")
const release = read(".github/workflows/release.yml")
const manifest = JSON.parse(read("package.json")) as { packageManager: string; scripts: Record<string, string> }

/** The branch prefixes CLAUDE.md and AGENTS.md tell contributors to use. */
const DOCUMENTED_BRANCH_PREFIXES = ["feat", "fix", "chore", "docs", "release", "test"]

/** Build-quality gates every branch push and every tag must pass. */
const SHARED_GATES = [
  "bun run check:repo",
  "bun run guard:legacy",
  "bun run typecheck:dax",
  "bun run --cwd packages/dax lint",
  "bun run test",
  "bun run eval:smoke",
]

/** Release-only gate: validates release inputs, so it has no CI equivalent. */
const RELEASE_ONLY_GATES = ["bun run release:check"]

/** Everything a tag must not be able to bypass. */
const ESSENTIAL_GATES = [...SHARED_GATES, ...RELEASE_ONLY_GATES]

describe("CI branch coverage", () => {
  test("CI runs on every documented branch prefix, including feat/**", () => {
    const pushBranches = ci.split("pull_request:")[0]
    for (const prefix of DOCUMENTED_BRANCH_PREFIXES) {
      expect(pushBranches).toContain(`- ${prefix}/**`)
    }
    expect(pushBranches).toContain("- main")
  })
})

describe("release gate parity", () => {
  test("one reusable root command owns release verification", () => {
    expect(manifest.scripts["release:gates"]).toBeDefined()
    // release:verify must not fork into a second, weaker definition.
    expect(manifest.scripts["release:verify"]).toBe("bun run release:gates")
  })

  test("release:gates covers every essential gate", () => {
    const gates = manifest.scripts["release:gates"]
    for (const gate of ESSENTIAL_GATES) {
      expect(gates).toContain(gate)
    }
    // rust:verify is fmt + clippy + test; assert the composition, not just the name.
    expect(gates).toContain("bun run rust:verify")
    expect(manifest.scripts["rust:verify"]).toContain("bun run rust:fmt")
    expect(manifest.scripts["rust:verify"]).toContain("bun run rust:clippy")
    expect(manifest.scripts["rust:verify"]).toContain("bun run rust:test")
    expect(manifest.scripts["rust:fmt"]).toBe("cargo fmt --all -- --check")
    expect(manifest.scripts["rust:clippy"]).toBe("cargo clippy --workspace --all-targets -- -D warnings")
    expect(manifest.scripts["rust:test"]).toBe("cargo test --workspace")
  })

  test("CI runs the same shared gates the release path runs", () => {
    for (const gate of SHARED_GATES) {
      // CI runs `bun run test --coverage`; match on the command prefix.
      expect(ci).toContain(gate)
    }
    expect(ci).toContain("cargo fmt --all -- --check")
    expect(ci).toContain("cargo clippy --workspace --all-targets -- -D warnings")
    expect(ci).toContain("cargo test --workspace")
  })

  test("the publication path fails before build and upload when a gate fails", () => {
    const gateIndex = release.indexOf("bun run release:gates")
    const buildIndex = release.indexOf("bun run build")
    const uploadIndex = release.indexOf("upload-artifact")
    const publishIndex = release.indexOf("action-gh-release")

    expect(gateIndex).toBeGreaterThan(-1)
    expect(buildIndex).toBeGreaterThan(-1)
    // GitHub Actions steps run in order and stop at the first failure, so gate
    // ordering is the enforcement mechanism.
    expect(gateIndex).toBeLessThan(buildIndex)
    expect(gateIndex).toBeLessThan(uploadIndex)
    expect(gateIndex).toBeLessThan(publishIndex)
  })

  test("release verification is not duplicated alongside the reusable command", () => {
    // release:gates already ends with release:check; a second standalone step
    // would run the same expensive work twice.
    expect(release.split("bun run release:check").length - 1).toBe(0)
  })
})

describe("Bun version consistency", () => {
  const PINNED = "1.3.9"

  test("root manifest, CI and release all declare the same Bun", () => {
    expect(manifest.packageManager).toBe(`bun@${PINNED}`)
    expect(ci).toContain(`bun-version: ${PINNED}`)
    expect(release).toContain(`bun-version: ${PINNED}`)
  })

  test("no workflow leaves Bun unpinned", () => {
    for (const [name, workflow] of [
      ["ci.yml", ci],
      ["release.yml", release],
    ] as const) {
      const setups = workflow.split("oven-sh/setup-bun@v2").slice(1)
      expect(setups.length).toBeGreaterThan(0)
      for (const setup of setups) {
        expect({ name, pinned: setup.slice(0, 120).includes("bun-version:") }).toEqual({ name, pinned: true })
      }
    }
  })
})
