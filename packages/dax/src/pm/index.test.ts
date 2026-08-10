import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { mkdtempSync, rmSync } from "fs"

// PM opens its SQLite file at module load from Global.Path.state, so the test
// home has to be pinned before the import. Everything below therefore imports
// PM lazily.
const testHome = mkdtempSync(path.join(os.tmpdir(), "dax-pm-"))
const previousHome = process.env.DAX_TEST_HOME
process.env.DAX_TEST_HOME = testHome

const pm = async () => (await import("./index")).PM

let counter = 0
const project = () => `proj_${Date.now().toString(36)}_${++counter}`

beforeAll(() => {
  process.env.DAX_TEST_HOME = testHome
})

afterAll(() => {
  if (previousHome === undefined) delete process.env.DAX_TEST_HOME
  else process.env.DAX_TEST_HOME = previousHome
  rmSync(testHome, { recursive: true, force: true })
})

describe("project memory state", () => {
  test("an unseen project reads as balanced defaults without being written", async () => {
    const PM = await pm()
    const id = project()

    const state = await PM.get_state({ project_id: id })

    expect(state.project_id).toBe(id)
    expect(state.risk_mode).toBe("balanced")
    expect(state.pm_rev).toBe(1)
  })

  test("risk mode persists and survives a re-read", async () => {
    const PM = await pm()
    const id = project()

    await PM.touch_state({ project_id: id, risk_mode: "conservative" })

    expect((await PM.get_state({ project_id: id })).risk_mode).toBe("conservative")
  })
})

describe("pm_rev provenance", () => {
  // Every RAO event is stamped with pm_rev so a reader can tell which revision
  // of project memory was in force when it was recorded. It was never
  // incremented, so every event in every database carried pm_rev 1 no matter
  // how much the constraints had changed underneath it.

  test("writing decision-relevant memory advances the revision", async () => {
    const PM = await pm()
    const id = project()
    await PM.touch_state({ project_id: id })
    const start = (await PM.get_state({ project_id: id })).pm_rev

    await PM.add_constraint({ project_id: id, rule_type: "never_touch", pattern: ".env", action: "deny", source: "user" })
    const afterConstraint = (await PM.get_state({ project_id: id })).pm_rev

    await PM.set_preference({ project_id: id, pref_key: "tone", pref_value: "terse" })
    const afterPreference = (await PM.get_state({ project_id: id })).pm_rev

    expect(afterConstraint).toBeGreaterThan(start)
    expect(afterPreference).toBeGreaterThan(afterConstraint)
  })

  test("reading memory does not advance the revision", async () => {
    const PM = await pm()
    const id = project()
    await PM.add_constraint({ project_id: id, rule_type: "deny_tool", pattern: "shell", action: "deny", source: "user" })
    const before = (await PM.get_state({ project_id: id })).pm_rev

    await PM.list_constraints({ project_id: id, limit: 100 })
    await PM.list_memory({ project_id: id, limit: 20 })
    await PM.list_preferences({ project_id: id })

    expect((await PM.get_state({ project_id: id })).pm_rev).toBe(before)
  })

  test("changing risk mode counts as a change, setting it to the same value does not", async () => {
    const PM = await pm()
    const id = project()
    await PM.touch_state({ project_id: id, risk_mode: "balanced" })
    const before = (await PM.get_state({ project_id: id })).pm_rev

    await PM.touch_state({ project_id: id, risk_mode: "balanced" })
    expect((await PM.get_state({ project_id: id })).pm_rev).toBe(before)

    await PM.touch_state({ project_id: id, risk_mode: "aggressive" })
    expect((await PM.get_state({ project_id: id })).pm_rev).toBeGreaterThan(before)
  })

  test("an event records the revision that was in force when it was appended", async () => {
    const PM = await pm()
    const id = project()

    const early = await PM.append_event({ project_id: id, event_type: "run", payload: { step: "first" } })
    await PM.add_constraint({ project_id: id, rule_type: "require_approval", pattern: "src/**", action: "ask", source: "user" })
    const late = await PM.append_event({ project_id: id, event_type: "run", payload: { step: "second" } })

    expect(late.pm_rev).toBeGreaterThan(early.pm_rev)
  })
})

describe("constraints and preferences", () => {
  test("constraints round-trip and are scoped to their project", async () => {
    const PM = await pm()
    const mine = project()
    const theirs = project()

    await PM.add_constraint({ project_id: mine, rule_type: "never_touch", pattern: "secrets/**", action: "deny", source: "user" })
    await PM.add_constraint({ project_id: theirs, rule_type: "deny_tool", pattern: "shell", action: "deny", source: "user" })

    const rows = await PM.list_constraints({ project_id: mine, limit: 100 })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.pattern).toBe("secrets/**")
    expect(rows[0]?.source).toBe("user")
  })

  test("setting the same preference key twice updates rather than duplicating", async () => {
    const PM = await pm()
    const id = project()

    await PM.set_preference({ project_id: id, pref_key: "tone", pref_value: "terse" })
    await PM.set_preference({ project_id: id, pref_key: "tone", pref_value: "warm" })

    const prefs = await PM.list_preferences({ project_id: id })
    expect(prefs).toHaveLength(1)
    expect(prefs[0]?.pref_value).toBe("warm")
  })
})

describe("memory retrieval", () => {
  // session/prompt.ts injects these into the model's context, so ordering and
  // the limit are what decide which memories the model actually sees.

  test("memories come back newest first and honour the limit", async () => {
    const PM = await pm()
    const id = project()

    for (const title of ["oldest", "middle", "newest"]) {
      await PM.save_memory({ project_id: id, category: "decision", title, content: `${title} body`, source: "user" })
    }

    const all = await PM.list_memory({ project_id: id, limit: 20 })
    expect(all.map((row) => row.title)).toEqual(["newest", "middle", "oldest"])

    const limited = await PM.list_memory({ project_id: id, limit: 1 })
    expect(limited.map((row) => row.title)).toEqual(["newest"])
  })

  test("category filtering only returns that category", async () => {
    const PM = await pm()
    const id = project()

    await PM.save_memory({ project_id: id, category: "decision", title: "d", content: "d", source: "user" })
    await PM.save_memory({ project_id: id, category: "pattern", title: "c", content: "c", source: "user" })

    const decisions = await PM.list_memory({ project_id: id, category: "decision", limit: 20 })
    expect(decisions.map((row) => row.title)).toEqual(["d"])
  })

  test("titles and content are trimmed on the way in", async () => {
    const PM = await pm()
    const id = project()

    await PM.save_memory({
      project_id: id,
      category: "decision",
      title: "  padded title  ",
      content: "  padded body  ",
      source: "user",
    })

    const [row] = await PM.list_memory({ project_id: id, limit: 20 })
    expect(row?.title).toBe("padded title")
    expect(row?.content).toBe("padded body")
  })
})

describe("rao events", () => {
  test("events come back newest first and can be filtered by type", async () => {
    const PM = await pm()
    const id = project()

    await PM.append_event({ project_id: id, event_type: "run", payload: { n: 1 } })
    await PM.append_event({ project_id: id, event_type: "audit", payload: { n: 2 } })
    await PM.append_event({ project_id: id, event_type: "override", payload: { n: 3 } })

    const all = await PM.list_events({ project_id: id, limit: 100 })
    expect(all).toHaveLength(3)
    expect(all[0]?.event_type).toBe("override")

    const audits = await PM.list_events({ project_id: id, event_type: "audit", limit: 100 })
    expect(audits).toHaveLength(1)
  })

  test("schema setup is idempotent across repeated opens", async () => {
    // `create table if not exists` runs on every import. A second open of the
    // same file must not throw or lose rows.
    const PM = await pm()
    const id = project()
    await PM.append_event({ project_id: id, event_type: "run", payload: { survives: true } })

    const again = (await import("./index")).PM
    expect(await again.list_events({ project_id: id, limit: 100 })).toHaveLength(1)
  })
})
