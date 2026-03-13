# DAX Run Lifecycle Model

This document defines the runtime lifecycle contract for `dax run`.

It exists because validation exposed a repeated control-plane ambiguity:

```text
run -> visible answer -> session still active
```

That means DAX currently distinguishes execution output from session closure too weakly. This model tightens that boundary before any further UI work.

## Purpose

Define:

- what lifecycle states a run session may enter
- when a visible answer is not enough to mark completion
- what `run` must guarantee before leaving `active`
- how lifecycle state should appear in session, history, trust, and readiness surfaces

## Core Rule

`run` output is not the same thing as session completion.

A session is only complete when DAX can determine that the current execution loop has reached a terminal lifecycle state and no further operator or runtime action is required for the current run.

## Lifecycle States

### `active`

The session exists and remains open, but DAX cannot yet claim terminal completion.

Typical reasons:

- execution is still in progress
- a provider response ended, but the runtime has not finalized the turn
- DAX expects more execution work, tool follow-up, or internal reconciliation
- the session is awaiting an explicit interruption, abandonment, or completion transition

### `executing`

The session is actively processing a run request.

This is a stronger subcondition of `active`, used when DAX has clear evidence that work is still underway:

- model response in progress
- tool calls underway
- approval resolution is pending and execution intends to continue after it

### `completed`

The session reached a terminal successful state for the current run.

Minimum requirements:

- the current run request finished
- no tool work remains outstanding
- no approval gate remains unresolved for the current execution path
- no additional continuation is expected from the runtime
- the session summary can be finalized without ambiguity

Visible assistant output may be part of a completed session, but is not sufficient by itself.

### `interrupted`

Execution was explicitly stopped before normal completion.

Examples:

- operator interrupt
- explicit cancel during execution
- runtime-level stop before terminal success

An interrupted session is terminal for the current run, but not successful.

### `abandoned`

The session remained active without reaching a terminal successful or interrupted state, and DAX later determines it was left incomplete.

Typical cases:

- visible answer returned, but runtime never finalized completion
- operator leaves without resuming or resolving pending work
- the session times out or is superseded without clean closure

`abandoned` is distinct from `interrupted`:

- `interrupted` is explicit
- `abandoned` is inferred

## State Transition Rules

### Start

On `dax run`, DAX creates or resumes a session in:

```text
active -> executing
```

### Successful execution

DAX may only transition:

```text
executing -> completed
```

when all completion guarantees are satisfied.

### Explicit stop

DAX may transition:

```text
executing -> interrupted
active -> interrupted
```

when the operator or runtime explicitly cancels work.

### Inferred incomplete stop

DAX may transition:

```text
active -> abandoned
executing -> abandoned
```

only through a later reconciliation rule, not immediately on a partial or ambiguous provider response.

## Visible Answer vs Session Closure

### Visible answer means

- the model produced user-visible output

### Visible answer does not mean

- the runtime finalized the turn
- tools or post-processing are done
- session outcome is known
- trust or readiness inputs are complete

This distinction must remain explicit in the runtime model and in operator-facing surfaces.

## `run` Completion Guarantees

Before a session leaves `active`, `run` should guarantee:

1. The runtime has finished its current execution loop.
2. Any pending tool result handling is complete.
3. Any approval wait is either resolved or explicitly leaves the session non-terminal.
4. The session outcome is set to a terminal lifecycle state.
5. Session history surfaces can present the run without ambiguity.

If DAX cannot satisfy these guarantees, the session should remain `active` or later become `abandoned`, not be treated as implicitly completed.

## Surface Expectations

### `session show`

Should expose:

- lifecycle state
- whether the session is terminal
- whether completion is explicit or inferred

### `session inspect`

Should explain:

- how the session reached its current lifecycle state
- whether the session finished cleanly, was interrupted, or was abandoned
- which timeline events justify that state

### `verify`

Should not confuse lifecycle incompleteness with trust failure.

Examples:

- `active` or `abandoned` may produce incomplete verification
- `completed` may still fail verification for trust reasons

### `release check`

Should treat non-terminal or abandoned sessions as readiness blockers unless a later workflow explicitly reconciles them.

### Timeline

The timeline should eventually represent lifecycle transitions explicitly:

- `execution_started`
- `execution_completed`
- `execution_interrupted`
- `session_abandoned`

## Non-Goals

This model does not yet define:

- exact timeout rules for abandonment
- provider-specific completion heuristics
- TUI/workstation lifecycle visuals
- automatic session reconciliation jobs

## Acceptance Signal

This model is successful when a real operator can reliably answer:

```text
Did this run actually finish, or did it only produce output?
```

and DAX can distinguish:

- completed work
- interrupted work
- abandoned work

without overloading visible output as proof of completion.
