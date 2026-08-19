import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deriveDefaultValidationCommands } from "./default-validation-commands"

/**
 * Two related defects, both fixed here, both worth holding in place.
 *
 * 1. The verification requirement was keyword-matched against the intent text, so
 *    "Draft a release note" demanded proof because it contained "release" — while
 *    granting no authority to change anything.
 * 2. The validation commands were prose ("run relevant tests"), which the
 *    verification allowlist rejects. A contract could demand evidence and describe
 *    no way to produce any.
 *
 * Together they meant a drafting run failed for reasons unrelated to the draft.
 */

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "dax-validation-"))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content)
  }
  return root
}

describe("default validation commands", () => {
  test("detects the repo's own scripts through its actual package runner", () => {
    const root = repo({
      "package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit", test: "bun test" } }),
      "bun.lock": "",
    })

    expect(deriveDefaultValidationCommands(root)).toEqual(["bun run typecheck", "bun run test"])
  })

  test("infers the runner from the lockfile rather than assuming npm", () => {
    const root = repo({
      "package.json": JSON.stringify({ scripts: { test: "vitest" } }),
      "pnpm-lock.yaml": "",
    })

    expect(deriveDefaultValidationCommands(root)).toEqual(["pnpm run test"])
  })

  test("orders checks by how directly they speak to correctness", () => {
    const root = repo({
      "package.json": JSON.stringify({ scripts: { lint: "eslint .", test: "jest", typecheck: "tsc" } }),
      "bun.lock": "",
    })

    // typecheck before test before lint: a run that can afford one check should
    // run the most decisive one.
    expect(deriveDefaultValidationCommands(root)).toEqual([
      "bun run typecheck",
      "bun run test",
      "bun run lint",
    ])
  })

  test("detects non-JS toolchains", () => {
    const cargo = repo({ "Cargo.toml": "[package]\nname = \"x\"" })
    expect(deriveDefaultValidationCommands(cargo)).toEqual(["cargo check", "cargo test"])

    const python = repo({ "pyproject.toml": "[project]\nname = \"x\"" })
    expect(deriveDefaultValidationCommands(python)).toEqual(["pytest"])
  })

  test("never offers a command the verification allowlist would reject", () => {
    // The original defect in one assertion: "run relevant tests" parses to the
    // executable `run`, which is not on the allowlist, so verification rejected
    // every command the compiler produced.
    const root = repo({
      "package.json": JSON.stringify({ scripts: { typecheck: "tsc", test: "bun test" } }),
      "bun.lock": "",
    })

    for (const command of deriveDefaultValidationCommands(root)) {
      expect(command).not.toMatch(/^run /)
      expect(command.split(/\s+/).length).toBeGreaterThan(1)
    }
  })

  test("a repo with nothing detectable yields nothing rather than a placeholder", () => {
    // Returning a plausible-looking command here would recreate the original bug:
    // evidence that cannot be produced is worse than an honest absence, because it
    // fails runs for the wrong reason.
    expect(deriveDefaultValidationCommands(repo({}))).toEqual([])
  })

  test("a malformed package.json degrades to no detection", () => {
    expect(deriveDefaultValidationCommands(repo({ "package.json": "{ not json" }))).toEqual([])
  })
})
