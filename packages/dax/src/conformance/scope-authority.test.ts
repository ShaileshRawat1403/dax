import { RUN_EVENT_TYPES } from "@/state/events/run-event-types"
import { ProjectEventPayloadSchema } from "@/state/events/project-event-types"
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import os from "node:os"
import { Instance } from "@/project/instance"
import { initializeRunEventAuthority, readRunEvents } from "@/state/events/run-event-store"
import { appendProjectEvent, initializeProjectJournal, readProjectEvents } from "@/state/events/project-journal"
import { PM } from "@/pm"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { proposeProjectFact, reviewProjectFact } from "@/pm/project-fact-producer"
import { clearRunEvents } from "@/state/events/run-event-store"

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
 * The run and project stores share journal machinery and explicitly owned new
 * envelopes. Production PM migration and governed memory promotion remain open.
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
  {
    fact: "promoted project memory",
    owner: "project",
    why: "governs sessions that have no relation to the run that discovered it",
  },
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
    // journal.test.ts exercises concurrency, replay rejection, duplicate
    // commands, and interrupted publication. The production run and project
    // stores must both instantiate that protocol; their own suites exercise it.
    expect(source("state/events/run-event-store.ts")).toContain('from "./journal"')
    expect(source("state/events/project-journal.ts")).toContain('from "./journal"')
  })

  test("a newly produced canonical run event explicitly names its owner", async () => {
    // The v2 parser accepts explicitly owned events and continues to read old
    // v1 history. Exercise the actual initializer, not a constructed envelope.
    const testHome = await mkdtemp(join(os.tmpdir(), "dax-scope-owner-"))
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome
    try {
      await Instance.provide({
        directory: join(import.meta.dir, "../../../../.."),
        async fn() {
          const runId = `run_scope_${crypto.randomUUID().replaceAll("-", "")}`
          await initializeRunEventAuthority(runId, {
            contractId: "ctr_scope",
            verificationRequired: false,
            guardEnforcementMode: "warn",
          })
          const events = await readRunEvents(runId)
          expect(events).toHaveLength(1)
          expect(events[0]).toMatchObject({ schemaVersion: "v2", scopeType: "run", scopeId: runId })
        },
      })
    } finally {
      await Instance.disposeAll()
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      await rm(testHome, { recursive: true, force: true })
    }
  })

  test("an unrelated run event cannot authorize a project fact", async () => {
    // Storage-level approval binding is a normal regression, not proof that a
    // production operator flow now owns the project-memory read/write path.
    const testHome = await mkdtemp(join(os.tmpdir(), "dax-project-authority-"))
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome
    try {
      await Instance.provide({
        directory: join(import.meta.dir, "../../../../.."),
        async fn() {
          const runId = `run_project_${crypto.randomUUID().replaceAll("-", "")}`
          await initializeRunEventAuthority(runId, {
            contractId: "ctr_project",
            verificationRequired: false,
            guardEnforcementMode: "warn",
          })
          const [source] = await readRunEvents(runId)
          await initializeProjectJournal()
          const before = await readProjectEvents()
          let rejected = false
          try {
            await appendProjectEvent({
              type: "project_fact_promoted",
              payload: {
                fact: {
                  factId: "fact_unapproved",
                  kind: "memory",
                  category: "decision",
                  title: "Unapproved",
                  content: "No operator approved this fact",
                  tags: [],
                },
              },
              sourceRefs: [{ scopeType: "run", scopeId: runId, eventId: source.eventId }],
              commandId: "unapproved_project_fact",
            })
          } catch (error) {
            rejected = true
            expect((error as Error).message).toBe("project_fact_authorization_required")
          }
          expect(rejected).toBe(true)
          expect(await readProjectEvents()).toEqual(before)
        },
      })
    } finally {
      await Instance.disposeAll()
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      await rm(testHome, { recursive: true, force: true })
    }
  })

  test("reviewed project settings outlive their source run and have one effective authority", async () => {
    const testHome = await mkdtemp(join(os.tmpdir(), "dax-project-settings-authority-"))
    await mkdir(join(testHome, ".config", "dax"), { recursive: true })
    const previousHome = process.env.DAX_TEST_HOME
    process.env.DAX_TEST_HOME = testHome
    try {
      await Instance.provide({ directory: join(import.meta.dir, "../../../../.."), async fn() {
        const owner = await Session.create({ title: "Review project settings" })
        await SessionPrompt.ensureCanonicalRunBirth({ sessionID: owner.id, intent: "Review project settings" })
        const project_id = Instance.project.id
        const legacy = await PM.settings_review_input({ project_id })
        const candidate = await proposeProjectFact({ runId: owner.id,
          candidateId: `pfc_${crypto.randomUUID().replaceAll("-", "")}`, change: {
            type: "project_settings_adopted", payload: { priorLegacyDigest: legacy.legacyDigest!,
              snapshot: { riskMode: "conservative", preferences: [{ key: "authority", value: "reviewed" }], constraints: [] } },
          } })
        expect((await PM.settings_review_input({ project_id })).authority).toBe("legacy")
        await reviewProjectFact({ candidateId: candidate.candidateId, digest: candidate.subject.digest,
          actor: "operator", decision: "approved" })
        await clearRunEvents(owner.id)
        expect((await PM.list_preferences({ project_id })).map((item) => item.pref_value)).toEqual(["reviewed"])
        expect((await PM.settings_review_input({ project_id })).authority).toBe("journal")
        let failure: unknown
        try { await PM.set_preference({ project_id, pref_key: "authority", pref_value: "unreviewed" }) }
        catch (error) { failure = error }
        expect((failure as Error).message).toBe("project_settings_review_required")
        expect((await readProjectEvents()).filter((event) => event.type === "project_settings_adopted")).toHaveLength(1)
      } })
    } finally {
      await Instance.disposeAll()
      if (previousHome === undefined) delete process.env.DAX_TEST_HOME
      else process.env.DAX_TEST_HOME = previousHome
      await rm(testHome, { recursive: true, force: true })
    }
  })

  test("no state transition is authoritative in two scopes at once", () => {
    // The corollary. A project fact caused by run evidence cites that evidence as
    // provenance; it does not write the transition into both journals. Two
    // authoritative copies is the same defect as a store beside a log, wearing
    // different clothes.
    //
    // Asserted against the run vocabulary directly: no run event may name a
    // project-scoped transition.
    // Inspect authoritative event discriminants, not incidental provenance labels.
    const runVocabulary = RUN_EVENT_TYPES
    const projectOwned = OWNERSHIP.filter((entry) => entry.owner === "project")

    for (const variant of ProjectEventPayloadSchema.options) {
      expect(runVocabulary).not.toContain(variant.shape.type.value)
    }
    for (const entry of projectOwned) {
      const eventish = entry.fact.replace(/\s+/g, "_")
      expect(runVocabulary).not.toContain(eventish)
      expect(runVocabulary).not.toContain("memory_promoted")
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
