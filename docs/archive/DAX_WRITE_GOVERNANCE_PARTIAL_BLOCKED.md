# DAX Write Governance Partial And Blocked Semantics

This document defines the next policy pass after write classification, enforcement visibility, and bucket-based trust/readiness severity.

The remaining question is narrower:

```text
how should DAX distinguish successful ungated writes from partial, blocked, or non-durable write attempts?
```

## Purpose

Define:

- what counts as a blocked write
- what counts as a partial write
- what counts as a write attempt with no durable result
- how those states differ from a completed ungated write
- why these semantics should be settled before expanding write-governance truth into `session show` and `session inspect`

## Problem Boundary

This layer is not about:

- TUI exposure
- workstation layout
- stream redesign
- broader approval redesign
- artifact indexing basics

This layer is about semantic clarity:

```text
write intent -> write outcome -> governance outcome -> trust consequence
```

## Why This Pass Is Next

DAX can already say:

- a retained workspace write happened
- the write fell into a policy bucket
- governance evidence was present, blocked, or missing
- trust and readiness severity change by write bucket

That is strong for completed writes.

What remains ambiguous is how to treat sessions where the write path was interrupted or never produced durable retained output.

Without this pass, operator surfaces risk flattening several different cases into one broad governance label.

## Core Write Outcome States

### 1. Governed completed write

Definition:

- durable write output exists
- governance evidence exists
- no unresolved pending approval blocks the write path

Meaning:

- the write path completed under visible governance
- trust/readiness severity should be based on the write bucket, but governance itself is not missing

### 2. Ungated completed write

Definition:

- durable write output exists
- governance was expected or required
- no matching governance evidence exists
- the write path still completed

Meaning:

- this is the current primary anomaly surfaced by `verify` and `release check`
- severity depends on the write bucket

### 3. Blocked write

Definition:

- write-capable work existed
- governance did not resolve cleanly
- pending approval or unresolved governance state remained
- DAX should not treat the write path as completed

Meaning:

- blocked write is not just “ungated”
- it represents a governance gate that remained unresolved
- trust/readiness should reflect unresolved control flow, not only missing evidence

### 4. Partial write

Definition:

- at least one durable write occurred
- the write path or session did not reach a clean governance/completion boundary
- the resulting artifact set is incomplete, mixed, or interrupted

Examples:

- one file was written before interruption
- some files were retained, but the broader write batch did not finish
- governance resolution remained incomplete after partial mutation

Meaning:

- partial write is more severe than a harmless completed artifact write
- it is also different from a blocked write with no durable result
- operator surfaces should eventually show this as “mutation happened, but completion/governance did not finish cleanly”

### 5. Write attempt with no durable result

Definition:

- write intent or write-capable execution occurred
- no retained durable workspace write artifact exists
- the attempt may have been blocked, interrupted, or ended before a durable file was recorded

Meaning:

- this should not be confused with a successful ungated write
- trust/readiness should reflect attempted or unresolved write activity, not missing artifact indexing

## Distinguishing Signals

The first implementation pass for these semantics should look at:

1. retained workspace write artifact count
2. pending approval count
3. lifecycle terminal vs non-terminal state
4. governance evidence presence
5. whether write-capable execution occurred at all

Those signals are enough to define first-order behavior without redesigning the approval engine.

## Initial Semantic Rules

### Blocked write

Treat a write as blocked when:

- write-capable activity exists
- governance status is unresolved or pending
- durable completion should not be treated as clean

This is primarily a control-flow problem.

### Partial write

Treat a write as partial when:

- durable retained write artifacts exist
- lifecycle or governance did not reach a clean terminal boundary
- the session indicates incomplete or interrupted mutation

This is primarily a mixed mutation/completion problem.

### No durable result

Treat a write attempt as no durable result when:

- write-capable activity was present
- no retained workspace write artifacts were recorded
- the session should not claim a clean write completion

This is primarily an attempted write problem, not an artifact-truth problem.

## Trust And Readiness Consequences

These semantics should eventually allow DAX to separate:

- completed ungated write
- blocked write
- partial write
- attempted write with no durable result

That matters because they should not all affect trust/readiness equally.

### Completed ungated write

- severity comes mostly from risk bucket

### Blocked write

- severity comes from unresolved governance control flow
- likely remains incomplete or blocked regardless of write bucket

### Partial write

- severity comes from both mutation and incomplete completion
- should often remain degraded or blocked until manually reviewed

### No durable result

- severity should be lower than a sensitive ungated successful write
- but still visible if a governed write path was attempted and not resolved cleanly

## Surface Strategy

Do not push richer write-governance summaries into `session show` / `session inspect` yet.

First settle these distinctions in policy and shared derivation.

Then future surfaces can present:

- governed completed write
- ungated completed write
- blocked write
- partial write
- write attempt with no durable result

without needing another semantic rewrite.

## Minimal Next Implementation Direction

The next narrow code slice after this policy pass should:

1. derive a shared write outcome state
2. distinguish completed vs blocked vs partial vs no-durable-result
3. keep the existing bucket/risk model intact
4. avoid UI expansion in the same slice

Do not yet:

- redesign approval prompts
- change workstation surfaces
- introduce new write bucket types

## Acceptance Signals

This policy pass is successful when:

1. DAX can distinguish completed ungated writes from blocked writes
2. partial writes are treated as their own semantic case
3. attempted writes with no durable result are no longer conflated with completed writes
4. later `session show` / `session inspect` exposure can build on stable write outcome semantics
