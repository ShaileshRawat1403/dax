import { describe, expect, test } from "bun:test"

/**
 * The minimality gate.
 *
 * Not an architectural invariant — a process rule, enforced as a test because the
 * failure it prevents is architectural accretion, and accretion is invisible one
 * commit at a time.
 *
 * DeepSeek teaches sophistication. Codex teaches production hardening.
 * mini-SWE-agent is the reference that matters most here, because it is the
 * reminder of what the irreducible loop actually is.
 *
 * The rule: every new vNext abstraction states, in one sentence, what breaks in the
 * tiny version. If nothing breaks, the abstraction is not justified yet.
 *
 * A registry entry is cheap. The discipline is in being unable to add the
 * abstraction without writing the sentence.
 */

type Justification = {
  /** The abstraction being introduced. */
  abstraction: string
  /** What concretely breaks if you do the obvious tiny thing instead. */
  breaksInTinyVersion: string
  /** Which invariant it serves. Abstractions serving none are the ones to refuse. */
  servesInvariant: 1 | 2 | 3 | 4 | 5 | 6
}

/**
 * Every abstraction introduced by the vNext overhaul. Add an entry before adding
 * the code, not after.
 */
const JUSTIFIED: Justification[] = [
  {
    abstraction: "closed run event vocabulary (RUN_EVENT_TYPES + typed append)",
    breaksInTinyVersion:
      "With a string event type, worker_run wrote four types no reducer handled and no read path refused; evidence appended to the log and projected nowhere, undetectably.",
    servesInvariant: 1,
  },
]

describe("minimality gate", () => {
  test("every justification names what breaks in the tiny version", () => {
    for (const j of JUSTIFIED) {
      expect(j.breaksInTinyVersion.length).toBeGreaterThan(40)
      expect(j.abstraction.length).toBeGreaterThan(0)
    }
  })

  test("every justification serves a numbered invariant", () => {
    for (const j of JUSTIFIED) {
      expect([1, 2, 3, 4, 5, 6]).toContain(j.servesInvariant)
    }
  })

  test("no abstraction is justified by resemblance to another harness", () => {
    // The failure mode this gate exists to catch: "DeepSeek has one" is not a
    // reason. Neither is "Codex does it this way".
    const byImitation = JUSTIFIED.filter((j) =>
      /deepseek|codex|opencode|openhands|claude code|aider|goose/i.test(j.breaksInTinyVersion),
    )

    expect(byImitation).toEqual([])
  })
})
