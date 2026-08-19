import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { isRunEventType } from "./run-event-types"

/**
 * H1b spec: one lifecycle, one vocabulary.
 *
 * The third argument to `transition(runId, status, reason)` *is* the event type —
 * it is written straight into the log. While two lifecycle implementations
 * coexisted, that argument was typed `string`, so the legacy path accepted
 * thirteen reason strings the event vocabulary had never heard of.
 *
 * They were harmless only because they could not reach the event path:
 * `transitionEventAuthority` throws on an unknown type, and every one of the
 * thirteen was reachable exclusively through `Transitions.*`. Retiring the legacy
 * branch removes that accident, and each becomes a runtime error at the moment a
 * previously-legacy workflow starts writing events.
 *
 * This test finds every reason string in the tree and asserts the vocabulary
 * knows it. It is the tripwire, encoded — so it fires here rather than in a run.
 */

const SRC = join(import.meta.dir, "..", "..")

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".dax") continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc)
      continue
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

/** Every literal passed as the third argument of a transition call. */
function reasonStrings(): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const pattern = /\btransition\(\s*[^,()]+,\s*"[^"]+",\s*"([a-z_]+)"/g

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8")
    for (const match of text.matchAll(pattern)) {
      const reason = match[1]
      const where = found.get(reason) ?? []
      where.push(file.slice(SRC.length + 1))
      found.set(reason, where)
    }
  }
  return found
}

describe("H1b — one lifecycle vocabulary", () => {
  test("every transition reason is a member of the run event vocabulary", () => {
    const unknown = [...reasonStrings().entries()]
      .filter(([reason]) => !isRunEventType(reason))
      .map(([reason, files]) => `${reason} (${[...new Set(files)].join(", ")})`)

    expect(unknown).toEqual([])
  })

  test("the reason argument is typed, not a bare string", () => {
    // A `string` parameter is what let the two vocabularies drift apart in the
    // first place. Typing it makes the next divergence a compile error rather
    // than a runtime one.
    const eventTransitions = readFileSync(join(SRC, "state/events/event-transitions.ts"), "utf8")
    const signature = eventTransitions.slice(
      eventTransitions.indexOf("export async function transitionEventAuthority"),
      eventTransitions.indexOf("): Promise<RunState>", eventTransitions.indexOf("transitionEventAuthority")),
    )

    expect(signature).not.toMatch(/eventType:\s*string/)
    expect(signature).toMatch(/eventType:\s*RunEventType/)
  })

  test("no legacy lifecycle implementation remains", () => {
    // The end state. Two implementations of one lifecycle means every invariant
    // in the conformance suite has to be satisfied twice, and only one of them
    // is ever checked.
    const files = sourceFiles(SRC).map((f) => f.slice(SRC.length + 1))

    expect(files).not.toContain("state/hybrid-transitions.ts")
    expect(files).not.toContain("state/transitions.ts")
  })

  test("run creation does not branch on a pilot list", () => {
    // Event authority covered draft_and_approve and worker_run only. The other
    // three workflow classes wrote no run events at all, which is why the
    // execution-boundary meter could not move.
    const runFactory = readFileSync(join(SRC, "execution/run-factory.ts"), "utf8")

    expect(runFactory).not.toContain("EVENT_AUTHORITY_PILOT_WORKFLOWS")
  })
})
