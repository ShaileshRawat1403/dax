import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const runner = path.resolve(import.meta.dir, "../../../script/test.ts")
let fixture: string

beforeEach(async () => {
  fixture = await mkdtemp(path.join(tmpdir(), "dax-test-discovery-"))
})

afterEach(async () => {
  await rm(fixture, { recursive: true, force: true })
})

async function run(...args: string[]) {
  const proc = Bun.spawn([process.execPath, "run", runner, ...args], {
    cwd: fixture,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { output: stdout + stderr, exitCode }
}

describe("repository test runner", () => {
  test("ignored artifacts cannot add tests to the package suite", async () => {
    await Bun.write(path.join(fixture, ".gitignore"), "artifacts/\n")
    await Bun.write(
      path.join(fixture, "packages/main.test.ts"),
      'import { test, expect } from "bun:test"; test("intended package test", () => expect(true).toBe(true))',
    )
    const clean = await run()
    expect(clean.exitCode).toBe(0)
    expect(clean.output).toContain("1 pass")
    expect(clean.output).toContain("1 test across 1 file")

    // The substring deliberately matches the old bare "packages" filter.
    await Bun.write(
      path.join(fixture, "artifacts/packages-probe/canary.test.ts"),
      'throw new Error("ARTIFACT_CANARY_EXECUTED")',
    )
    const contaminated = await run()
    expect(contaminated.exitCode).toBe(0)
    expect(contaminated.output).toContain("1 pass")
    expect(contaminated.output).toContain("1 test across 1 file")
    expect(contaminated.output).not.toContain("ARTIFACT_CANARY_EXECUTED")
  })

  test("forwards test arguments and a failing child exit status", async () => {
    await Bun.write(
      path.join(fixture, "packages/failure.test.ts"),
      `import { test, expect } from "bun:test"
test("selected failure", () => expect(true).toBe(false))
test("excluded success", () => expect(true).toBe(true))`,
    )
    const result = await run("--test-name-pattern", "selected failure")
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain("0 pass")
    expect(result.output).toContain("1 fail")
    expect(result.output).toContain("1 filtered out")
  })
})
