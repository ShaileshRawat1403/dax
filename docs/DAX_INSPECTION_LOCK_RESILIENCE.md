# DAX Inspection Lock Resilience

This document defines the next narrow reliability layer after lifecycle truth and artifact truth.

It focuses on one operator-facing problem:

```text
session inspect
database is locked
```

## Purpose

Define:

- where inspection-path lock contention occurs
- which read surfaces must tolerate concurrent writes
- what retry/backoff or read-isolation behavior is expected
- which commands are affected first

## Evidence From Validation

Real-session evaluation exposed a repeatable inspection-path edge case:

```text
session inspect -> database is locked
```

This happened under read-heavy inspection while the runtime still had concurrent write or state-update activity.

That means the problem is not product semantics anymore. It is read-path reliability.

## Problem Boundary

The affected layer is the inspection/read surface, not execution truth.

Known read surfaces that should tolerate transient lock contention:

- `session inspect`
- `session show`
- `verify`
- `release check`

`release check` already has some lock retry mitigation. The remaining gap is to make the broader inspection paths equally reliable.

## Reliability Rule

Operator inspection commands should not fail immediately on transient database lock contention when the system can reasonably retry and return a stable result.

For this layer, the rule is:

```text
inspection paths should retry transient locked reads before failing
```

## First Implementation Expectation

The first slice should stay narrow:

1. define a shared retry helper for transient lock errors
2. use it on canonical read-heavy inspection paths
3. keep error handling conservative:
   - retry only known transient lock failures
   - do not swallow unrelated errors

## Preferred Behavior

For transient lock errors:

- short retry window
- bounded attempts
- small delay/backoff

If retries still fail:

- return the real error
- do not fabricate partial success

## Commands and Surfaces

### `session inspect`

Highest priority, because this is where validation explicitly found the issue.

### `session show`

Should use the same protection if it depends on the same read path composition.

### `verify`

Should remain resilient because it composes multiple read surfaces and is frequently used during validation.

### `release check`

Already partially mitigated, so this layer should align it with the shared retry strategy rather than leaving one-off behavior.

## Minimal First Slice

The first implementation slice should do only this:

1. introduce a shared transient-lock retry helper
2. apply it to:
   - `session inspect`
   - `session show`
   - `verify`
   - `release check`
3. add focused tests for retry-on-lock behavior where practical

Do not do yet:

- database redesign
- caching layer
- asynchronous materialized summaries
- TUI inspection changes

## Acceptance Signals

This slice is successful when:

1. known inspection paths no longer fail immediately on transient lock contention
2. retry behavior is shared, not duplicated ad hoc
3. non-lock errors still fail normally
4. existing session/trust/readiness behavior does not regress
