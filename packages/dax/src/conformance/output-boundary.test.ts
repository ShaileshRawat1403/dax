import { describe, expect, test } from "bun:test"
import { expectGap } from "./known-gaps"
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

    expectGap("inv4.tool-output-validation", () => {
      expect(declaresOutputSchema).toBe(true)
    })
  })

  test("event payloads are validated at the append boundary", () => {
    // Still open, and deliberately so. appendEventOnly is generic over
    // RunEventPayload, so a wrong payload for a given event type is a compile
    // error — but nothing parses the payload per type at runtime.
    //
    // Closing this needs a zod schema per event type mirroring the TS union.
    // Doing a few and waving the rest through would report a guarantee the system
    // does not provide, which is the failure mode this whole suite exists to catch.
    const types = source("state/events/run-event-types.ts")
    const hasPerTypePayloadSchemas = /RunEventPayloadSchema|z\.discriminatedUnion/.test(types)

    expectGap("inv4.payload-schemas", () => {
      expect(hasPerTypePayloadSchemas).toBe(true)
    })
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

    expect(types).not.toMatch(/checks:\s*unknown\[\]/)
    expect(types).toContain("checks: CheckResult[]")
  })
})
