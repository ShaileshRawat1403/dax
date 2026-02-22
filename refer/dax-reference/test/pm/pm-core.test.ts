import { describe, expect, test } from "bun:test"
import { PM } from "../../src/pm"
import { ulid } from "ulid"

describe("pm core", () => {
  test("stores state, preferences, constraints, and rao events", async () => {
    const project_id = "pm_" + ulid()

    const state = await PM.touch_state({
      project_id,
      risk_mode: "conservative",
    })
    expect(state.project_id).toBe(project_id)
    expect(state.risk_mode).toBe("conservative")

    await PM.set_preference({
      project_id,
      pref_key: "eli12_default",
      pref_value: "on",
    })
    const prefs = await PM.list_preferences({ project_id })
    expect(prefs.find((x) => x.pref_key === "eli12_default")?.pref_value).toBe("on")

    const rule = await PM.add_constraint({
      project_id,
      rule_type: "require_approval",
      pattern: "migrations/**",
      action: "ask",
      source: "user",
    })
    const rules = await PM.list_constraints({ project_id, limit: 10 })
    expect(rules.some((x) => x.id === rule.id)).toBeTrue()

    const event = await PM.append_event({
      project_id,
      event_type: "run",
      session_id: "ses_test",
      message_id: "msg_test",
      payload: {
        agent: "build",
      },
    })
    const events = await PM.list_events({ project_id, limit: 10 })
    expect(events.some((x) => x.id === event.id && x.event_type === "run")).toBeTrue()
  })
})
