import { describe, expect, test } from "bun:test"
import { applyPersonaVoice, getPersona, PERSONAS } from "./persona"

describe("persona voice", () => {
  test("jarvis voice formalizes contractions and trims filler", () => {
    expect(applyPersonaVoice("i'm still on it and i'll continue automatically", PERSONAS.jarvis)).toBe(
      "Report: i am in progress and I will continue automatically.",
    )
  })

  test("mission voice adds Status prefix and tactical lexicon", () => {
    expect(applyPersonaVoice("review the waiting decision", PERSONAS.mission)).toBe(
      "Status: review the holding decision.",
    )
  })

  test("heisenberg voice applies Signal prefix and provider lexicon", () => {
    expect(applyPersonaVoice("the run is waiting on provider output", PERSONAS.heisenberg)).toBe(
      "Signal: the run is waiting on upstream output.",
    )
  })

  test("darwin voice trims filler and adds Focus prefix", () => {
    expect(applyPersonaVoice("the workstation will stay focused on live state", PERSONAS.darwin)).toBe(
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

  test("unknown persona ids fall back safely to mission", () => {
    expect(getPersona("not-real").id).toBe("mission")
  })

  test("exactly 4 personas are defined", () => {
    expect(Object.keys(PERSONAS)).toEqual(["mission", "jarvis", "heisenberg", "darwin"])
  })
})
