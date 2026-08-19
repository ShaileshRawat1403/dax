import { describe, expect, test } from "bun:test"
import { expectGap } from "./known-gaps"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { RUN_EVENT_TYPES, type RunEventType } from "@/state/events/run-event-types"

/**
 * Invariant 1 — Durable Authority.
 *
 * Any record required to reconstruct what the model knew, what authority it had,
 * what occurred, or why the result was accepted must be durable.
 *
 * Decision procedure: would a reviewer reach a different conclusion about whether
 * the work was authorised or correct if this record were absent? If yes, it is a
 * durable event. If no, it is telemetry.
 *
 * "Model-visible" is necessary but not sufficient. Sandbox enforcement, path-policy
 * rejection and verification receipts are never model-visible yet are decisive for
 * authorisation and correctness.
 */

/**
 * The authoritative record classes. Each one passes the reviewer test: absent it,
 * a reviewer could reach a different conclusion about authorisation or correctness.
 */
const RECORD_CLASSES = [
  {
    id: "prompt_contribution",
    why: "What the model was told to be. Changes what the output means.",
    eventTypes: [] as string[],
  },
  {
    id: "context_contribution",
    why: "What the model could see. A reviewer cannot judge a decision without its inputs.",
    eventTypes: [],
  },
  {
    id: "assistant_message",
    why: "What the model claimed. The claim is the thing verification is checked against.",
    eventTypes: [],
  },
  {
    id: "tool_invocation",
    why: "What the model attempted, and with what arguments. The authorisation question is about this.",
    eventTypes: [],
  },
  {
    id: "tool_result",
    why: "What actually happened. Distinguishes attempted from effected change.",
    eventTypes: [],
  },
  {
    id: "approval",
    why: "Who permitted the action, on what basis, and what they were shown.",
    eventTypes: ["approval_requested", "approval_resolved", "approval_denied"],
  },
  {
    id: "policy_decision",
    why: "Why an action was allowed or refused. A silent allow and a considered allow are not the same record.",
    eventTypes: [],
  },
  {
    id: "delegation",
    why: "Which actor did the work, under whose authority, at what depth.",
    eventTypes: [],
  },
  {
    id: "compaction_replacement",
    why: "Context that was removed or summarised. Without it, replay reconstructs a context the model never saw.",
    eventTypes: [],
  },
  {
    id: "verification",
    why: "What was independently checked, and what the check returned.",
    eventTypes: ["verification_recorded"],
  },
  {
    id: "completion",
    why: "Whether the objective was judged satisfied, and on what evidence.",
    eventTypes: ["run_completed", "workflow_completed"],
  },
] as const

function isDurable(cls: (typeof RECORD_CLASSES)[number]): boolean {
  if (cls.eventTypes.length === 0) return false
  return cls.eventTypes.every((t) => (RUN_EVENT_TYPES as readonly string[]).includes(t))
}

describe("invariant 1 — durable authority", () => {
  test("every authoritative record class has durable event representation", () => {
    const missing = RECORD_CLASSES.filter((c) => !isDurable(c)).map((c) => c.id)

    // Prompts, context, messages, tool calls, tool results, policy decisions,
    // delegation and compaction all influence authorisation or correctness, and
    // none of them survive as events. This is the H2 block.
    expectGap("inv1.record-classes", () => {
      expect(missing).toEqual([])
    })
  })

  test("meter: durable record-class coverage", () => {
    const covered = RECORD_CLASSES.filter(isDurable).length
    const total = RECORD_CLASSES.length

    // The progress number. It moves as record classes gain events.
    expectGap("inv1.record-classes", () => {
      expect({ covered, total }).toEqual({ covered: total, total })
    })
  })

  test("approval is durable in substance, not only in name", () => {
    // The reviewer test is decisive here: someone shown only the log must be able
    // to tell what the operator was asked to permit. approval_requested carried
    // { approvalId, approvalType, risk } and nothing else, so the answer lived in
    // the ApprovalStore and the log recorded only that an approval had happened.
    //
    // Asserted against the payload union rather than a sample event, so adding a
    // field a reviewer needs cannot be satisfied by one well-formed emit site.
    const declared = readFileSync(join(import.meta.dir, "..", "state/events/run-event-types.ts"), "utf8")
    const approvalRequested = declared.slice(
      declared.indexOf('type: "approval_requested"'),
      declared.indexOf('type: "approval_resolved"'),
    )

    for (const field of ["title", "reason", "expectedConsequence"]) {
      expect(approvalRequested).toContain(field)
    }

    const approvalResolved = declared.slice(declared.indexOf('type: "approval_resolved"'))
    expect(approvalResolved.slice(0, 400)).toContain("actor")
  })

  test("the vocabulary is closed, so absence is detectable", () => {
    // This one passes as of H1a (feat/h1a-closed-event-vocabulary) and is here to
    // stay passing: a closed vocabulary is what makes the failures above legible
    // rather than merely unobserved.
    const types: readonly RunEventType[] = RUN_EVENT_TYPES
    expect(types.length).toBeGreaterThan(0)
    expect(new Set(types).size).toBe(types.length)
  })
})
