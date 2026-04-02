import { describe, expect, test } from "bun:test"
import { applyPersonaVoice, getPersona, PERSONAS } from "./persona"

describe("persona voice", () => {
  test("auditor voice formalizes and punctuates operator text", () => {
    expect(applyPersonaVoice("i'm still on it and i'll continue automatically", PERSONAS.auditor)).toBe(
      "I am still on it and I will continue automatically.",
    )
  })

  test("commander voice adds a stable tactical prefix", () => {
    expect(applyPersonaVoice("review the waiting decision", PERSONAS.commander)).toBe(
      "Status: review the waiting decision.",
    )
  })

  test("detective voice stays subtle and signal-oriented", () => {
    expect(applyPersonaVoice("the run is waiting on provider output", PERSONAS.detective)).toBe(
      "Signal: the run is waiting on provider output.",
    )
  })

  test("zen voice trims filler and keeps the message calm", () => {
    expect(applyPersonaVoice("the workstation will stay focused on live state", PERSONAS.zen)).toBe(
      "Focus: workstation will stay focused on live state.",
    )
  })

  test("all shipped personas expose the full status label set", () => {
    for (const persona of Object.values(PERSONAS)) {
      expect(persona.ui.statusLabels.interpreting).toBeTruthy()
      expect(persona.ui.statusLabels.critiquing).toBeTruthy()
      expect(persona.ui.statusLabels.executing).toBeTruthy()
      expect(persona.ui.statusLabels.verifying).toBeTruthy()
      expect(persona.ui.statusLabels.recovering).toBeTruthy()
    }
  })

  test("unknown persona ids fall back safely to zen", () => {
    expect(getPersona("not-real").id).toBe("zen")
  })
})
