# DAX vNext Conformance Suite

Six architectural invariants, expressed as tests rather than prose.

A prose invariant drifts — this repository spent 2026-08-19 repairing 66 documents
that had drifted from the code they described. An executable invariant cannot: it
either passes against the tree in front of it or it does not.

Several of these tests **fail against v1.3.0 by design**. A vNext architecture suite
in which everything passes on day one is not specifying an overhaul. The set of
failing tests *is* the overhaul boundary — it is discovered by running the suite,
not settled by argument.

## The six invariants

| # | Invariant | Decision procedure | File |
|---|---|---|---|
| 1 | **Durable Authority** — any record needed to reconstruct what the model knew, what authority it had, what occurred, or why the result was accepted must be durable | Would a reviewer reach a different conclusion about whether the work was authorised or correct if this record were absent? If yes, it is a durable event. If no, it is telemetry. | `event-authority.test.ts` |
| 2 | **Replay Equivalence** — authoritative runtime state must be reproducible from durable event history | Can the state be rebuilt from the log alone, with no access to any sibling store? | `replay-equivalence.test.ts` |
| 3 | **Universal Execution Boundary** — every executable capability passes through the same contract-governed lifecycle | Does this execution path emit the same conformance points as every other? | `execution-pipeline.test.ts` |
| 4 | **Runtime Boundary Validation** — inputs, outputs, observations and evidence are validated at runtime, not trusted because TypeScript says so | Does a malformed value get rejected at runtime, or does it enter state unchecked? | `output-boundary.test.ts` |
| 5 | **Contract-Defined Authority** — capabilities describe what can exist; contracts determine what this run may exercise | Is authority expressed once, in the contract, or does the capability carry a second policy? | `contract-capability.test.ts` |
| 6 | **Evidence-Gated Completion** — execution success cannot independently imply task completion | Can this run reach `completed` without evidence that the objective was satisfied? | `verification-completion.test.ts` |
| 7 | **Scope Authority** — every durable state transition has exactly one authoritative scope and is reconstructable from that scope's journal | If the originating run disappeared, should this fact still govern future behaviour? Yes → project-scoped. No → run-scoped. Doesn't govern behaviour → not authoritative state at all. | `scope-authority.test.ts` |

Plus one gate, which is a process rule rather than an architectural property:

| **Minimality** — every new abstraction states what breaks in the tiny version | `minimality-gate.test.ts` |

## On "one durable truth"

Invariant 7 exists because that phrase was imprecise, and the imprecision only
surfaced when something with a genuinely different lifetime turned up.

Read as *one log*, it forces project memory — which governs sessions unrelated to
the run that discovered it — into a run-scoped journal that dies when the run is
pruned. Read as *one owner per fact, determined by lifetime and scope*, the
principle survives.

So DAX has one event **system** with scope-owned journals, not two event spines:

```
Event journal contract
  ├── run scope      → run vocabulary,     run reducer,     run state
  └── project scope  → project vocabulary, project reducer, project state
```

Run journals stay independently replayable — a run is born at seq 0 with
`contract_compiled`, contiguous, terminating with the run. One project-wide log
with runs as partitions was considered and rejected: unrelated concurrent runs
would contend on a single sequence, today's replay would depend on every
historical run in the project, and retention would couple across runs that have
nothing to do with each other.

Cross-scope relationships are **provenance references, never duplicated
authority**. A project fact caused by run evidence cites that evidence; it does
not write the transition into both journals. Two authoritative copies is the
parallel-state defect wearing different clothes.

Further scopes — workspace, user, organisation — are deliberately not
generalised. Run and project are what exist.

## Scoreboard

Two of the tests are *meters*: they compute a conformance score and assert the
target. They fail with a number, and that number is the progress metric.

- `execution-pipeline.test.ts` scores each execution path against 8 conformance
  points. **14 / 40** across five paths — native session 1/8, worker run 5/8,
  draft-approve-execute 4/8, repo-analyze 2/8, review-and-signoff 2/8.

  It scored 9/24 over three paths until H1b, which is worth recording: two of the
  five execution paths were on a separate lifecycle and the meter simply did not
  count them. A score that ignores the paths least likely to conform is not a
  score. The spread matters as much as the total — an action's governance still
  depends on which door it came through.

- `event-authority.test.ts` scores 11 authoritative record classes for durable
  representation. Baseline at v1.3.0: **3 / 11** (approval, verification, completion).

The record-class meter counts whether a class has *any* durable event type. It is
deliberately generous: approval scores, yet a separate test shows the payload cannot
reproduce what the operator was actually shown. Read the meter as an upper bound.

Both must reach 100% for the overhaul to be complete. Neither should be gamed by
emitting partial events — the points are specific for that reason.

## What this suite is not

It does not measure capability against other harnesses. A capability count is not
an architectural property, and ten shallow capabilities do not equal one invariant.
The question this suite answers is narrower and more useful:

> In how many ways can DAX behave inconsistently?
