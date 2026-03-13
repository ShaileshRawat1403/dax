# DAX Donor Assessment

## 1. Overview

This document assesses the root legacy surfaces as donor material for canonical DAX.

Sources reviewed:

- `cli/`
- `core/`
- `tui/`

Assessment principle:

- extract product behavior
- compare it to canonical `packages/dax`
- migrate or refactor useful ideas
- delete only clearly redundant code later

This is not a cleanup-first exercise.
It is a behavior and product-intelligence extraction exercise.

## 2. Assessment Method

The review uses three passes.

### Pass 1: Product Behavior Discovery

For each legacy area, identify:

- user workflows
- execution model
- state handling
- command semantics
- UX narrative

### Pass 2: Capability Comparison

For each discovered behavior, compare against canonical `packages/dax`.

Classification values:

- native capability
- missing capability
- better implementation
- legacy artifact

### Pass 3: Final Disposition

Only after the comparison, assign:

- keep as donor reference
- migrate concept
- refactor into canonical surface
- delete as redundant

## 3. CLI Donor Analysis

### Behaviors Discovered

- flat command router with explicit operator-facing verbs
- direct command surfaces for:
  - `audit`
  - `policy`
  - `run`
  - `tools`
  - `tool`
  - `verify`
  - `config`
  - `memory`
  - `sessions`
  - `approvals`
  - `artifacts`
  - `tui`
  - `stream`
- explicit “run a JSON plan” behavior
- explicit “prompt to plan” behavior
- explicit split between execution, approvals, artifacts, sessions, and memory

### Product Intelligence Embedded Here

- CLI semantics are simple and operator-readable
- the command set reflects an execution system, not just a chat interface
- there is value in the explicit nouns:
  - session
  - approval
  - artifact
  - memory
  - policy
  - verify

### Comparison Against Canonical DAX

- modern `packages/dax` CLI is richer and more complete
- but some legacy command semantics are cleaner and more direct
- the explicit “plan file execution” concept is weaker in canonical messaging
- the “verify ledger” framing may still be useful for enterprise trust surfaces

### Disposition

| Behavior | Classification | Decision | Notes |
| --- | --- | --- | --- |
| flat operator verb set | better implementation idea | migrate concept | useful for simplifying command discoverability |
| explicit approvals/sessions/artifacts commands | native capability | refactor docs/UX | canonical DAX has equivalents but should preserve explicit operator language |
| `run <plan.json>` flow | missing or underexposed capability | migrate concept | useful for deterministic/replayable execution workflows |
| `--prompt` to plan generation | partial capability | refactor | canonical DAX already does NL work; legacy framing may help plan-mode UX |
| simple command router implementation | legacy artifact | keep as donor reference | behavior matters more than code |

## 4. Core Donor Analysis

### Behaviors Discovered

- session engine built around:
  - run
  - audit
  - override
  - execute
- explicit session persistence
- explicit plan validation
- explicit tool registry
- explicit policy evaluation before execution
- simple storage and JSON-first persistence model
- direct ledger/event recording

### Product Intelligence Embedded Here

- the root `core/` makes the execution loop very legible
- it expresses DAX as a governed executor more plainly than some modern surfaces
- the separation between:
  - validation
  - audit
  - execution
  - session result
  is strong product thinking

### Comparison Against Canonical DAX

- `packages/dax` is more advanced and operationally real
- but legacy `core/` expresses the mental model more cleanly
- canonical DAX should absorb that clarity in:
  - docs
  - naming
  - review surfaces
  - test organization

### Disposition

| Behavior | Classification | Decision | Notes |
| --- | --- | --- | --- |
| explicit RAO loop in session engine | native capability with clearer expression | migrate concept | use this as the canonical teaching model |
| plan validation before execution | native capability | keep as reference | useful as a conceptual baseline |
| simple policy-before-execution model | native capability | refactor docs/tests | modern engine is richer, but should preserve this legibility |
| JSON-first storage/session semantics | legacy artifact with product value | keep as donor reference | useful for import/export or replay product ideas |
| minimalist tool registry | legacy artifact | delete later if redundant | only after extraction of conceptual lessons |

## 5. TUI Donor Analysis

### Behaviors Discovered

- terminal home screen with recent sessions
- strong setup/onboarding emphasis
- explicit provider configuration flow
- simple permission dialog with:
  - approve once
  - always allow
  - deny
- transcript-centered chat view
- status-oriented top-level framing

### Product Intelligence Embedded Here

- TUI contains the strongest operator UX signal in the legacy roots
- the best ideas are:
  - execution status as a primary UI signal
  - approval as a first-class interaction
  - session recency and continuity on the home view
  - setup readiness as part of the product, not an afterthought

### Comparison Against Canonical DAX

- canonical DAX TUI is much more advanced
- but legacy TUI still contains valuable primitives:
  - simple permission-dialog clarity
  - immediate session visibility
  - onboarding/readiness framing

### Disposition

| Behavior | Classification | Decision | Notes |
| --- | --- | --- | --- |
| simple permission dialog semantics | better implementation idea | migrate concept | clarity of “approve once / always / deny” is excellent |
| recent sessions home view | native capability with useful framing | refactor | canonical home should preserve simple session continuity cues |
| provider setup UX | partial capability | migrate concept | setup/readiness should remain highly visible |
| transcript-centric operator view | native capability | keep and refine | this is aligned with final DAX direction |
| old React/Ink/blessed implementation | legacy artifact | keep as donor reference | product behavior matters more than implementation |

## 6. Reuse Matrix

## Reuse First

These should be reused as concepts or behavior:

- explicit operator command nouns from `cli/`
- clear RAO mental model from `core/`
- simple approval semantics from `tui/`
- session continuity cues from `tui/`
- setup/readiness visibility from `tui/`

## Refactor Into Canonical DAX

These belong in `packages/dax`, but re-expressed there:

- plan-file execution workflow
- ledger verification trust surface
- clearer session and artifact operator commands
- simpler approval dialog wording
- home/recent-session framing

## Keep As Donor Reference For Now

These should remain until absorption work is complete:

- root `cli/`
- root `core/`
- root `tui/`

Reason:

- they still contain product semantics worth mining
- docs in the repo still reflect older models in places
- deletion now would lose context before absorption is specified

## Delete Later Only If Redundant

Candidate redundancy exists in:

- minimal tool-registry implementations
- old wiring/bootstrap code
- obsolete UI shell code

But deletion should happen only after:

- target behavior is either migrated or rejected
- no docs or tests still reference the old concept

## 7. Migration Candidates

Highest-value migration candidates:

1. Plan-file execution and replay-oriented workflows
2. Approval UX wording and interaction model
3. Session continuity and recent-session home view cues
4. Setup/readiness-first operator onboarding
5. Trust-oriented verification and ledger language

## 8. Confirmed Redundancies

Confirmed redundancy exists at the implementation level, but not yet at the behavior level.

That means:

- code duplication exists
- product duplication is not fully resolved

So the current safe conclusion is:

- do not delete by directory
- delete only after behavior-level absorption decisions are made

## 9. Next Absorption Steps

1. Convert this donor assessment into an updated absorption strategy.
2. Identify one migration candidate from each donor area:
   - CLI
   - core
   - TUI
3. Implement those in `packages/dax` without copying large legacy trees.
4. Update docs to reflect the absorbed behavior.
5. Reassess what remains truly redundant.

## 10. As-Is vs To-Be

## As-Is

- DAX has a strong canonical runtime in `packages/dax`
- legacy roots still contain useful product semantics
- repo duplication is partly behavioral, not only structural
- the product message is improving, but the execution model should become even clearer

## To-Be

- canonical DAX keeps all runtime ownership in `packages/dax`
- legacy roots are treated as donor material until their behavior is either absorbed or rejected
- only redundant code is deleted
- DAX expresses one clear operator model:
  - intent
  - plan
  - action
  - approval
  - verification
  - evidence
