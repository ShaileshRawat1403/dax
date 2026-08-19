import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariant 3 — Universal Execution Boundary.
 *
 * Every executable capability passes through the same contract-governed lifecycle.
 * Paths may implement execution differently. They may not have different governance
 * semantics.
 *
 * Decision procedure: does this execution path emit the same conformance points as
 * every other?
 *
 * Scored per point rather than per path, because "this path emits events" is gameable
 * by emitting one. Eight points, three paths, twenty-four total.
 */

const SRC = join(import.meta.dir, "..")

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8")
}

/** The eight conformance points every execution path owes. */
type Point =
  | "contract_bound"
  | "input_validated"
  | "policy_emitted"
  | "approval_emitted"
  | "execution_emitted"
  | "output_validated"
  | "verification_emitted"
  | "completion_projected"

const POINTS: Point[] = [
  "contract_bound",
  "input_validated",
  "policy_emitted",
  "approval_emitted",
  "execution_emitted",
  "output_validated",
  "verification_emitted",
  "completion_projected",
]

type PathScore = { path: string; points: Record<Point, boolean> }

function scoreWorkerRun(): PathScore {
  const s = source("workflows/worker-run.ts")
  return {
    path: "worker run",
    points: {
      contract_bound: s.includes('"contract_refined"'),
      // The worker's own tool calls are opaque to DAX; nothing validates them at
      // the boundary DAX owns.
      input_validated: false,
      policy_emitted: /appendEventOnly\(this\.runId, "policy_/.test(s),
      approval_emitted: s.includes("addApproval"),
      execution_emitted: s.includes('"worker_sandbox_recorded"'),
      // computeDiff is kernel-computed, which is stronger than trusting the worker,
      // but the result is not validated against a schema before it becomes evidence.
      output_validated: false,
      verification_emitted: s.includes('"verification_recorded"'),
      completion_projected: s.includes('"workflow_completed"') || s.includes('"run_completed"'),
    },
  }
}

function scoreDraftApproveExecute(): PathScore {
  const s = source("workflows/draft-approve-execute.ts")
  return {
    path: "draft-approve-execute",
    points: {
      contract_bound: s.includes('"contract_refined"'),
      input_validated: false,
      policy_emitted: /appendEventOnly\(this\.runId, "policy_/.test(s),
      approval_emitted: s.includes("addApproval"),
      execution_emitted: s.includes("completeStep"),
      output_validated: false,
      // Records a verification *artifact* and no verification *event*, so it
      // completes without ever engaging the completion gate.
      verification_emitted: s.includes('"verification_recorded"'),
      completion_projected: s.includes('"workflow_completed"'),
    },
  }
}

function scoreNativeSession(): PathScore {
  const processor = source("session/processor.ts")
  const tool = source("tool/tool.ts")
  const emitsRunEvents = /appendEventOnly|RunLifecycle|appendRunEvent/.test(processor)
  return {
    path: "native session",
    points: {
      contract_bound: emitsRunEvents,
      // The one point native execution does own: tool.ts parses arguments through
      // the tool's zod schema on every call, and throws on mismatch.
      input_validated: tool.includes("parameters.parse(args)"),
      policy_emitted: emitsRunEvents,
      // ctx.ask() gates the action, but produces no durable run event.
      approval_emitted: emitsRunEvents,
      execution_emitted: emitsRunEvents,
      output_validated: /returns|outputSchema|result\.parse/.test(tool),
      verification_emitted: emitsRunEvents,
      completion_projected: emitsRunEvents,
    },
  }
}

/**
 * Scored from the workflow's own source, the same way as the others. These two
 * were on the legacy lifecycle until H1b and emitted no run events at all; they
 * are counted now because leaving them out flattered the meter — it measured
 * three of five execution paths and called the result a score.
 */
function scoreWorkflow(path: string, file: string): PathScore {
  const s = source(file)
  return {
    path,
    points: {
      contract_bound: s.includes('"contract_refined"'),
      input_validated: false,
      policy_emitted: /"policy_/.test(s),
      approval_emitted: s.includes("addApproval"),
      execution_emitted: s.includes("completeStep"),
      output_validated: false,
      verification_emitted: s.includes('"verification_recorded"'),
      completion_projected: /"workflow_completed"|"workflow_signed_off"|"run_completed"/.test(s),
    },
  }
}

function scoreAll(): PathScore[] {
  return [
    scoreNativeSession(),
    scoreWorkerRun(),
    scoreDraftApproveExecute(),
    scoreWorkflow("repo-analyze", "workflows/repo-analyze.ts"),
    scoreWorkflow("review-and-signoff", "workflows/review-and-signoff.ts"),
  ]
}

describe("invariant 3 — universal execution boundary", () => {
  test("every execution path emits every conformance point", () => {
    const gaps = scoreAll().flatMap((p) =>
      POINTS.filter((pt) => !p.points[pt]).map((pt) => `${p.path}: ${pt}`),
    )

    // Baseline at v1.3.0: 15 gaps across 3 paths.
    expect(gaps).toEqual([])
  })

  test("meter: conformance points across all execution paths", () => {
    const scores = scoreAll()
    const earned = scores.reduce((n, p) => n + POINTS.filter((pt) => p.points[pt]).length, 0)
    const total = scores.length * POINTS.length

    // The progress number. Five execution paths, eight points each.
    expect({ earned, total }).toEqual({ earned: total, total })
  })

  test("no execution path is governed more weakly than another", () => {
    // The invariant is about *sameness*, not merely coverage. A path scoring 5/8
    // and a path scoring 1/8 means an action's governance depends on which door it
    // came through — which is the thing this invariant exists to forbid.
    const counts = scoreAll().map((p) => POINTS.filter((pt) => p.points[pt]).length)
    const spread = Math.max(...counts) - Math.min(...counts)

    expect(spread).toBe(0)
  })

  test("there is exactly one lifecycle implementation", () => {
    // hybrid-transitions.ts branches every transition on isEventAuthorityRun,
    // keeping two implementations of one lifecycle live simultaneously. Until it
    // is gone, every invariant in this suite has to be satisfied twice.
    let hybridExists = true
    try {
      source("state/hybrid-transitions.ts")
    } catch {
      hybridExists = false
    }

    expect(hybridExists).toBe(false)
  })
})
