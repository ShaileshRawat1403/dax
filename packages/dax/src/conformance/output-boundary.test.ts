import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariant 4 — Runtime Boundary Validation.
 *
 * Inputs, outputs, observations and evidence are validated at runtime, not trusted
 * because TypeScript says so.
 *
 * Decision procedure: does a malformed value get rejected at runtime, or does it
 * enter state unchecked?
 *
 * Tool arguments and model-facing tool results are both parsed at the native
 * tool boundary. Canonical event envelopes are parsed with their payload as one
 * discriminated runtime contract before log replay.
 */

const SRC = join(import.meta.dir, "..")

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8")
}

describe("invariant 4 — runtime boundary validation", () => {
  test("tool inputs are validated at runtime", () => {
    // Holds at v1.3.0: tool.ts parses args through the declared zod schema before
    // execute() runs, and converts ZodError into a message the model can act on.
    const tool = source("tool/tool.ts")
    expect(tool).toContain("parameters.parse(args)")
  })

  test("a log read from disk is validated before projection", () => {
    // readRunEvents used to return whatever JSON was on disk under a TypeScript
    // annotation that asserted its shape without checking it.
    const store = source("state/events/run-event-store.ts")

    expect(store).toContain("parseRunEventLog")
  })

  test("evidence receipts are validated before they gate completion", () => {
    // verification_recorded payloads carry `checks: unknown[]`. The receipts that
    // decide whether a run may complete are therefore the least-typed thing in the
    // system.
    const types = source("state/events/run-event-types.ts")

    expect(types).toContain("checks: z.array(CheckResult.strict())")
  })
})
