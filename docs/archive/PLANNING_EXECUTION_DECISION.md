# Planning vs Execution Decision

## Current State

- `dax run` now reads as governed execution instead of assistant interaction.
- `dax run` shows a pre-execution preview so the operator can inspect the request before work begins.
- prompt-derived execution still exists as a convenience path.
- there is no explicit plan-file runner yet.
- there is no first-class `dax plan` command yet.

## Decision Question

Should plan creation remain embedded inside `dax run`, or should planning become a separate first-class command?

## Recommended Direction

Long-term direction:

- `dax plan` owns intent-to-plan conversion
- `dax run` owns execution of prepared work
- validation can remain implicit for now and become more explicit later as plan governance matures

Short-term direction:

- keep prompt-driven `dax run` working as a convenience path
- do not overload Wave 1 with plan-file execution
- treat explicit planning as the next design surface

Future execution path:

- `dax plan`
- `dax run <plan-file>` or `dax run --plan <plan-file>`

## Why This Direction

- it preserves a clean control-plane grammar
- it makes planning a visible object instead of a hidden pre-step
- it fits the DAX execution model:
  - intent
  - plan
  - action
  - approval
  - verification
  - evidence
- it avoids overloading `run` with both planning and execution identity

## Product Rule

`run` owns execution.

`plan` owns intent-to-plan conversion.

`validate` stays implicit for now unless plan review/governance becomes rich enough to justify a first-class command.

## Acceptance Signal

DAX should make it obvious whether the operator is:

- defining work
- reviewing work
- executing work

## Implementation Order

1. Keep Wave 1 closed as complete.
2. Design `plan` as a first-class command.
3. Decide whether `run <plan-file>` lands before or alongside `plan`.
4. Add explicit validation surfaces only when the plan object becomes reviewable.
