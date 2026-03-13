# DAX Write Governance Implementation

This document is the implementation bridge for [DAX_WRITE_GOVERNANCE_MODEL.md](DAX_WRITE_GOVERNANCE_MODEL.md).

It translates the validated write-governance problem into a narrow implementation sequence without mixing in UI or broader workflow redesign.

## Purpose

Define:

- how write intent should be detected
- when approval or a governance gate should appear
- what counts as a retained artifact
- how created files should become canonical artifact truth
- what should happen when write succeeds but artifact indexing fails
- which surfaces must reflect corrected artifact state

## Evidence From Validation

Validation exposed a specific repeatable mismatch:

```text
write intent present
real files created
session completed
artifact_count = 0
verify/release/history still report missing retained artifacts
```

This means lifecycle truth is no longer the primary problem.

The remaining problem is that write results do not reliably propagate into the canonical retained-artifact surfaces.

## Current Problem Boundary

The gap can appear in one of two places:

1. write intent is not recognized strongly enough, so governance and artifact expectations are not attached
2. writes happen, but the resulting files are not indexed into the retained artifact surface used by:
   - `session show`
   - `session inspect`
   - `verify`
   - `release check`

The first implementation should focus on making artifact truth reliable, not on redesigning approvals or policy.

## Canonical Artifact Rule

For this slice, a retained artifact is not “anything a session touched.”

A retained artifact should be something the operator can later inspect as durable work output.

Examples:

- a file created or updated inside the governed project workspace
- an attachment already retained by the runtime
- a diff-backed change that should be visible as produced work

Non-goals for v1:

- indexing every transient temp file
- inventing a second artifact store
- treating all runtime scratch paths as retained outputs

## Write Intent Detection

The implementation should recognize write-intent sessions conservatively.

Signals that should contribute:

- explicit file-write tool use
- diff-producing execution
- new or modified project files after execution
- command/workflow intent that clearly targets file creation or mutation

The first slice does not need to solve the full semantic problem of intent classification.

It only needs enough detection to ensure that when project files are created or updated successfully, artifact truth is not lost.

## Canonical Indexing Strategy

The first write-governance implementation should keep one rule:

```text
if governed execution creates or mutates durable project files,
those outputs must be visible through canonical artifact surfaces
```

Recommended approach:

1. keep using the existing artifact-building path as the canonical read surface
2. extend it so durable project file writes can appear as retained artifacts even when they were not captured as explicit attachments
3. ensure the same derived artifact truth is consumed by history/trust/readiness surfaces

This should remain a read-model correction first, not a storage migration.

## Indexing Failure Rule

If write execution succeeds but artifact indexing fails, the system should not silently behave as if no artifact exists.

The first implementation should choose one of:

- surface an explicit artifact-indexing failure signal
- or derive a fallback retained artifact record from durable project file evidence

Preferred first move:

- derive fallback retained artifact visibility from durable project file evidence

That is less disruptive and keeps the correction local.

## Surface Propagation

The corrected artifact truth must flow into:

### `session show`

Should expose a corrected `artifact_count`.

### `session inspect`

Should include the retained file outputs in the artifact section.

### `verify`

Should stop reporting “No retained artifacts or session diff evidence were recorded” when durable project outputs are clearly present.

### `release check`

Should stop missing artifact evidence when the retained output surface is complete.

## Existing Code Touchpoints

The first narrow implementation likely needs to touch:

- [artifacts.ts](/Users/Shared/MYAIAGENTS/dax/packages/dax/src/cli/cmd/artifacts.ts)
  - canonical artifact read-model helpers
- [session.ts](/Users/Shared/MYAIAGENTS/dax/packages/dax/src/cli/cmd/session.ts)
  - session summary and inspect surfaces consuming artifact truth
- [verify-session.ts](/Users/Shared/MYAIAGENTS/dax/packages/dax/src/trust/verify-session.ts)
  - artifact evidence checks
- [check-session-release.ts](/Users/Shared/MYAIAGENTS/dax/packages/dax/src/release/check-session-release.ts)
  - release evidence checks

Depending on current runtime structure, the correction may also touch the project-file/diff discovery helpers rather than the CLI command module directly.

## Minimal First Slice

The first implementation slice should do only this:

1. define the fallback rule for durable project file outputs
2. make canonical artifact building include those outputs
3. propagate the corrected artifact truth into:
   - `session show`
   - `session inspect`
   - `verify`
   - `release check`
4. verify against the known write-intent sessions from validation

Do not implement yet:

- new approval UX
- policy redesign
- write-specific TUI treatment
- broad artifact taxonomy redesign

## Acceptance Cases

### Case 1: Write-intent session with real created files

Should become:

- `artifact_count > 0`
- retained artifacts visible in `session inspect`
- `verify` no longer claims no retained artifacts exist

### Case 2: Stable artifact-heavy session

Should remain correct and not regress.

### Case 3: Lightweight non-write session

Should not suddenly gain retained artifacts.

## Success Signal

This write-governance implementation is successful when:

1. real created project files reliably appear in canonical artifact surfaces
2. session/trust/readiness outputs stop under-reporting artifact truth
3. artifact-heavy flows remain stable
4. lightweight non-write sessions do not become artifact-noisy
