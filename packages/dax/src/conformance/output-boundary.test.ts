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
 * The asymmetry at v1.3.0 is stark and worth naming precisely: DAX validates what
 * the model sends *in* and trusts everything that comes back *out*. Tool arguments
 * are parsed through a zod schema on every call. Tool results are a TypeScript
 * shape, which is to say they are checked at compile time in a system whose whole
 * problem is what happens at runtime.
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

  test("tool outputs are validated at runtime", () => {
    // Fails at v1.3.0. Tool.Info declares `parameters` (a z.ZodType) but no
    // corresponding output schema; the result is typed as Metadata and never parsed.
    // A tool returning a malformed observation puts it straight into context.
    const tool = source("tool/tool.ts")
    const declaresOutputSchema = /returns\s*[:?]|outputSchema|result\.parse|output\.parse/.test(tool)

    expect(declaresOutputSchema).toBe(true)
  })

  test("event payloads are validated at the append boundary", () => {
    // Partially holds as of H1a. appendEventOnly is generic over RunEventPayload,
    // so a wrong payload for a given event type is a compile error — but the store
    // itself accepts whatever the caller passes at runtime, and a log read from
    // disk is never re-validated against the payload union.
    const store = source("state/events/run-event-store.ts")
    const validatesOnAppend = /parse\(|safeParse\(|validatePayload/.test(store)

    expect(validatesOnAppend).toBe(true)
  })

  test("a log read from disk is validated before projection", () => {
    // Fails at v1.3.0. readRunEvents returns whatever JSON was on disk. H1a made the
    // reducer refuse unknown event *types*; it does not check that a known type's
    // payload matches its declared shape. A truncated or hand-edited events.json
    // projects into state with no complaint.
    const store = source("state/events/run-event-store.ts")
    const validatesOnRead = /RunEventPayload|schema|parse\(/.test(store)

    expect(validatesOnRead).toBe(true)
  })

  test("evidence receipts are validated before they gate completion", () => {
    // verification_recorded payloads carry `checks: unknown[]`. The receipts that
    // decide whether a run may complete are therefore the least-typed thing in the
    // system.
    const types = source("state/events/run-event-types.ts")
    const checksAreTyped = !/checks:\s*unknown\[\]/.test(types)

    expect(checksAreTyped).toBe(true)
  })
})
