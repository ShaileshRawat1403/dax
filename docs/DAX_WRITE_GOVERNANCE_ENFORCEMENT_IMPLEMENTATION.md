# DAX Write Governance Enforcement Implementation

This document defines the first narrow implementation slice for write-governance enforcement.

It follows:

- validation evidence
- write-governance model
- write-governance enforcement model

The goal is to expose enforcement truth before redesigning broader approval or workflow behavior.

## Purpose

Define:

- which write classes are enforced first
- where approval expectations are checked
- how enforcement outcomes propagate into operator surfaces
- what counts as governed, ungated, partial, or blocked write behavior in the first slice

## First Slice Boundary

This slice should stay narrow.

It should do only this:

1. detect when a session contains write-capable activity
2. determine whether governance evidence for that write is present
3. surface missing governance evidence as a trust/readiness concern

It should not yet:

- redesign approval policy matching
- add new approval prompts
- redesign artifact storage
- change TUI behavior
- infer deep risk from file content

## Write Classes In Scope

### 1. Governed write candidate

A session should be treated as a governed-write candidate when:

- a write-capable tool path is present, or
- durable workspace files were created as retained artifacts

This first slice can be conservative. It is better to classify borderline write sessions as governed candidates than to miss real write activity.

### 2. Ungated write anomaly

A governed-write candidate becomes anomalous when:

- retained workspace-file artifacts exist, but
- there is no visible approval or policy-governance evidence explaining that write path

This does not necessarily mean the runtime behaved incorrectly. It means DAX cannot yet prove the write was governed cleanly.

### 3. Blocked write

If pending approvals remain for a write-capable path, the session should continue to be treated as blocked or incomplete.

This mostly aligns with existing lifecycle/readiness behavior and does not require a new execution rule in this slice.

### 4. Partial write

If write artifacts exist but session completion or governance evidence is incomplete, the session should remain incomplete/degraded rather than silently clean.

## Enforcement Inputs

The first slice should derive enforcement truth from existing canonical inputs:

- retained artifacts from session inspection
- approval counts / approval records
- override records
- existing policy/audit presence
- lifecycle state

Avoid creating a parallel write-governance store in this slice.

## Shared Derived Signal

Introduce a shared derived evaluator that answers:

- does this session contain governed-write activity?
- is governance evidence present?
- is governance still blocked?
- is there an ungated-write anomaly?

Suggested shape:

```text
collectWriteGovernanceStatus(...)
```

Possible output:

```text
safe
governed
blocked
anomalous
incomplete
```

The exact labels may differ, but the logic must be shared rather than reimplemented separately in trust and readiness surfaces.

## Surface Propagation

### `session show`

Expose a compact write-governance summary only if it adds real operator value.

For the first slice, this may remain internal if `show` would become noisy.

### `session inspect`

Should be able to expose the write-governance status in a way that explains:

- write artifacts exist
- governance evidence is present, missing, blocked, or anomalous

### `verify`

This is the highest-value first surface.

The first slice should add a write-governance check that can say:

- writes were governed cleanly
- write governance is incomplete
- write governance is anomalous

### `release check`

Should reflect unresolved or anomalous write governance as:

- missing evidence, or
- blocker

depending on severity

## First Implementation Direction

Recommended order:

1. add shared write-governance derivation
2. integrate it into `verify`
3. reflect it in `release check`
4. optionally expose a compact status in `session inspect`

Do not start with UI or approval-flow mutation.

## Acceptance Cases

### Safe/governed write

When retained workspace-file artifacts exist and governance evidence is present:

- `verify` should not flag missing write governance
- `release check` should not block on write-governance anomaly alone

### Ungated write

When retained workspace-file artifacts exist but governance evidence is absent:

- `verify` should surface a write-governance concern
- `release check` should not silently treat the session as clean

### Blocked write

When write-capable work has pending approval:

- `verify` remains incomplete or blocked
- `release check` remains not ready

### Partial write

When write artifacts exist but lifecycle or governance evidence is incomplete:

- the session should remain degraded/incomplete
- the write should still be visible

## Non-Goals

Not in this slice:

- broader policy redesign
- explicit safe-write allowlists
- new approval UX
- workstation/TUI exposure
- stream redesign

## Success Criteria

This slice is successful when:

1. write-capable sessions can be judged as governed vs ungated vs blocked using shared logic
2. `verify` surfaces write-governance anomalies explicitly
3. `release check` no longer treats ungated writes as silently clean
4. existing lifecycle, artifact, and inspection behavior does not regress
