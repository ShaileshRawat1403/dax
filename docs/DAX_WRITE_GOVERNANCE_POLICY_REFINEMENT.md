# DAX Write Governance Policy Refinement

This document defines the next semantic layer after basic write-governance enforcement visibility.

The previous slice established:

- write activity can be detected
- missing governance evidence can be surfaced
- trust and readiness can reflect ungated writes

The next question is stricter:

```text
which writes should actually require stronger governance?
```

## Purpose

Define:

- harmless vs governed write classes
- which thresholds should trigger approval expectation
- what partial writes mean
- how ungated writes should influence trust and readiness severity

## Problem Boundary

This layer is not about:

- TUI exposure
- workstation layout
- stream redesign
- artifact indexing
- inspection lock resilience

This layer is about policy depth:

```text
write class -> governance expectation -> trust consequence
```

## Current State

DAX can now say:

- a retained workspace write happened
- governance evidence was present, blocked, or missing
- trust/readiness should reflect that

That is enough for baseline visibility, but not enough for durable policy quality.

Right now, write-governance classification is still intentionally conservative and shallow.

## Why Policy Refinement Is Next

Without policy refinement, DAX still risks treating very different write scenarios too similarly:

- harmless report generation
- normal documentation output
- meaningful project source edits
- config mutation
- broad file rewrites
- partial or mixed write outcomes

Those should not all carry the same governance expectation.

## Write Classes

### 1. Harmless writes

Writes that are low-risk and should not normally require approval.

Examples:

- generating reports in known artifact directories
- writing derived summaries
- creating disposable local outputs

Expected policy treatment:

- approval usually not required
- trust should not degrade solely because these writes occurred
- retained artifacts should still be visible

### 2. Normal workspace writes

Writes inside the project workspace that materially modify project-owned content.

Examples:

- documentation updates
- source file edits
- test updates

Expected policy treatment:

- may be allowed without approval depending on policy
- must still leave visible governance evidence when policy is evaluated
- ungated writes here are more concerning than harmless artifact writes

### 3. Sensitive writes

Writes that should usually trigger approval.

Examples:

- protected files
- environment or config files
- release-related files
- writes outside expected project-owned paths
- broad destructive rewrites

Expected policy treatment:

- approval expected before execution
- missing approval should be treated as stronger governance failure

### 4. Partial writes

Writes where some file changes occurred but governance or completion remained incomplete.

Expected policy treatment:

- artifacts remain visible
- trust remains incomplete or degraded
- readiness should not treat the session as clean

## First Policy Thresholds

The first refinement should answer these questions:

1. Is the write confined to a known safe artifact path?
2. Is the write modifying normal project content?
3. Is the write touching a sensitive or protected path?
4. Did approval remain pending or missing when policy expected it?
5. Did the session create only harmless outputs, or did it mutate governed project state?

These thresholds do not need perfect semantic classification yet. They do need to distinguish obviously different risk levels.

## Trust Severity Guidance

### Harmless ungated write

If a harmless write occurs without explicit governance evidence:

- trust may remain incomplete
- release readiness should usually remain in review territory, not hard-block solely on that fact

### Normal workspace ungated write

If project-modifying writes occur without governance evidence:

- trust should degrade more visibly
- release readiness should treat this as a stronger missing-governance concern

### Sensitive ungated write

If sensitive writes occur without approval or clear policy basis:

- trust should move toward failure rather than mild degradation
- release readiness should treat this as a blocker

### Partial write

If files were written but the session did not complete governance cleanly:

- trust remains incomplete or degraded
- readiness remains blocked or review-limited depending on the severity of the path

## Surface Consequences

This policy refinement should eventually influence:

### `verify`

Verification should be able to say more than:

- write governed
- write blocked
- write ungated

It should eventually distinguish severity by write class.

### `release check`

Readiness should eventually distinguish:

- harmless missing governance evidence
- meaningful project-write governance concern
- sensitive write blocker

### `session show` / `session inspect`

These should only become more explicit after policy semantics stabilize, not before.

## Minimal Next Implementation Direction

After this policy refinement doc, the first deeper slice should still stay narrow:

1. classify retained workspace writes by a small number of path/risk buckets
2. adjust trust/readiness severity based on that class
3. avoid UI expansion in the same slice

Do not yet:

- redesign the approval engine
- build a full path classification framework
- add workstation exposure

## Acceptance Signals

This layer is successful when:

1. harmless writes and meaningful project writes are no longer treated identically
2. sensitive ungated writes can become stronger blockers than normal missing-governance cases
3. partial writes remain visible without being mislabeled as clean completion
4. `verify` and `release check` gain better severity discrimination without broad redesign
