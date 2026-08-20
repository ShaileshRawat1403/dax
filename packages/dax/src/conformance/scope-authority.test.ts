import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expectGap } from "./known-gaps"

/**
 * Invariant 7 — Scope Authority.
 *
 * Every durable state transition has exactly one authoritative scope, and must be
 * reconstructable from that scope's journal.
 *
 * Decision procedure: **if the originating run disappeared, should this fact still
 * govern future behaviour?**
 *
 *   No  → run-scoped.
 *   Yes → project-scoped.
 *   It does not govern behaviour at all → telemetry or artifact, not authoritative
 *         state, and it does not belong in a journal.
 *
 * This invariant exists because "one durable truth" was stated imprecisely. Taken
 * as "one log", it forces facts with genuinely different lifetimes into the same
 * container: project memory outlives every run that contributes to it, so a
 * run-scoped log cannot own it without the fact dying when the run is pruned.
 * Taken as "one owner per fact, determined by lifetime", the principle survives
 * contact with entities whose lifetimes differ.
 *
 * The corollary that keeps this from reintroducing parallel state: cross-scope
 * relationships are expressed as **provenance references, never duplicated
 * authority**. A project fact caused by run evidence cites that evidence; it does
 * not write a second copy of the transition into the run journal.
 *
 * None of this is implemented. The tests below describe the architecture rather
 * than measuring drift from it, and are recorded as gaps so the shape is settled
 * before code is written against a vaguer version of it.
 */

const SRC = join(import.meta.dir, "..")

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8")
}

/**
 * Facts DAX holds durably, and the scope that must own each under the decision
 * procedure above. Recorded here because the classification is the architectural
 * content — the tests only check that the code agrees with it.
 */
const OWNERSHIP = [
  { fact: "tool invocation", owner: "run", why: "meaningless once its run is gone" },
  { fact: "approval for one mutation", owner: "run", why: "authorises one execution, not future ones" },
  { fact: "verification receipt", owner: "run", why: "attests one run's checks" },
  { fact: "completion judgement", owner: "run", why: "concerns whether that run's objective was met" },
  { fact: "workspace mutation", owner: "run", why: "the change belongs to the run that made it" },
  { fact: "promoted project memory", owner: "project", why: "governs sessions that have no relation to the run that discovered it" },
  { fact: "project convention", owner: "project", why: "outlives every run that observed it" },
  { fact: "retired project memory", owner: "project", why: "its retirement must survive the run that superseded it" },
] as const

describe("invariant 7 — scope authority", () => {
  test("every durable fact is classified to exactly one owning scope", () => {
    // The classification itself must be unambiguous. A fact with two owners is
    // the parallel-state defect this codebase spent a workstream removing.
    for (const entry of OWNERSHIP) {
      expect(["run", "project"]).toContain(entry.owner)
      expect(entry.why.length).toBeGreaterThan(20)
    }

    const facts = OWNERSHIP.map((entry) => entry.fact)
    expect(new Set(facts).size).toBe(facts.length)
  })

  test("the journal primitive is generic over scope, not copied per scope", () => {
    // The failure mode to avoid: run-event-store.ts and project-event-store.ts
    // drifting into two almost-equivalent implementations of append, sequence
    // validation, locking, envelope validation and replay. The machinery is
    // already generic in everything but its path and vocabulary.
    expectGap("scope.journal-primitive", () => {
      expect(existsSync(join(SRC, "state/events/journal.ts"))).toBe(true)
    })
  })

  test("the envelope names the scope that owns the event", () => {
    // Today RunEventEnvelope carries runId and nothing else, so an event cannot
    // say which scope it belongs to — the answer is implied by which file it was
    // read from. A project-scoped event needs to state its own ownership, and to
    // carry provenance into the run that caused it without being owned by it.
    expectGap("scope.aware-envelope", () => {
      const types = source("state/events/run-event-types.ts")
      expect(types).toMatch(/scopeType|scope_type/)
    })
  })

  test("a project-scoped journal exists for facts that outlive their run", () => {
    // Project memory is the first concrete instance: it is read by intent
    // interpretation on every session, and has nowhere to be written that does
    // not die with a run.
    expectGap("scope.project-journal", () => {
      expect(existsSync(join(SRC, "state/events/project-journal.ts"))).toBe(true)
    })
  })

  test("no state transition is authoritative in two scopes at once", () => {
    // The corollary. A project fact caused by run evidence cites that evidence as
    // provenance; it does not write the transition into both journals. Two
    // authoritative copies is the same defect as a store beside a log, wearing
    // different clothes.
    //
    // Asserted against the run vocabulary directly: no run event may name a
    // project-scoped transition.
    const runVocabulary = source("state/events/run-event-types.ts")
    const projectOwned = OWNERSHIP.filter((entry) => entry.owner === "project")

    for (const entry of projectOwned) {
      const eventish = entry.fact.replace(/\s+/g, "_")
      expect(runVocabulary).not.toContain(`"${eventish}"`)
      expect(runVocabulary).not.toContain(`"memory_promoted"`)
    }
  })

  test("run journals stay independently replayable", () => {
    // The reason for rejecting one project-wide log with runs as partitions.
    // A run's history is currently self-contained: born at seq 0 with
    // contract_compiled, contiguous, terminating with the run. Interleaving
    // unrelated concurrent runs into one sequence would make today's replay
    // depend on every historical run in the project, and couple their retention.
    const store = source("state/events/run-event-store.ts")
    expect(store).toContain('["run_events", Instance.project.id, runId]')

    const reducer = source("state/events/run-reducer.ts")
    expect(reducer).toContain("First event must be contract_compiled")
  })
})
