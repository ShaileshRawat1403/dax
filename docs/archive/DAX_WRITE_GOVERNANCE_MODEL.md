# DAX Write Governance Model

This document defines how DAX should reason about write intent, approval, artifact creation, and artifact visibility.

It exists because validation exposed a repeated trust gap:

```text
write intent -> file created -> artifact_count: 0
```

That means real filesystem effects can currently succeed while history, verification, and readiness surfaces remain blind to them.

## Purpose

Define:

- what qualifies as write intent
- when write approval should appear
- what counts as an artifact
- how created files propagate into timeline, history, verification, and readiness
- what happens when write succeeds but artifact indexing fails

## Core Rule

Successful write execution is not enough.

For governed execution to be trustworthy, DAX must connect:

```text
intent -> approval -> write action -> artifact detection -> artifact visibility -> trust surfaces
```

If any link is missing, the session is operationally incomplete even if the file exists on disk.

## Write Intent

Write intent exists when a run is expected to mutate durable project state.

Common cases:

- create a file
- edit a file
- delete a file
- rename or move a file
- generate output files into a project or artifact directory

Write intent may be:

- explicit in the prompt
- derived from the selected tool path
- inferred from the execution plan

## Approval Expectations

### Approval should appear when

- policy requires confirmation for the write target
- the write affects governed project state
- the write crosses trust-sensitive boundaries

### Approval may not appear when

- policy explicitly allows the write path
- the write occurs in a pre-approved sandboxed output area
- the execution mode already carries an allow decision for that target

The operator surface must still make the governing decision legible, even when no approval prompt appears.

## Artifact Definition

An artifact is a durable output of session work that should remain inspectable after execution.

Artifacts include:

- created files
- updated files when surfaced as diffable or retained outputs
- generated reports
- structured output files
- retained execution outputs already stored by the runtime

Not every write must become a first-class artifact, but every governed write that matters to trust, history, verification, or release readiness must be representable.

## Write-to-Artifact Propagation

When a write succeeds, DAX should attempt to propagate it through these layers:

1. Write execution succeeds.
2. The affected path is observed and classified.
3. Artifact indexing records the output or diff evidence.
4. Timeline receives a meaningful artifact event.
5. Session history surfaces expose the resulting artifact count or evidence.
6. `verify` and `release check` can reason over the artifact presence.

If propagation stops at step 1, the filesystem changed but the control plane did not.

## Surface Expectations

### Timeline

Should eventually represent meaningful write outcomes such as:

- `artifact_produced`
- `files_written`
- `diff_recorded`

### Session History

`session show` and `session inspect` should reflect governed write effects in a way that is consistent with real filesystem state.

Minimum expectation:

- if durable files were created by governed execution, the session should not report zero artifacts unless the system explicitly classifies them as non-artifact writes

### `verify`

Should evaluate artifact presence based on indexed or otherwise trustworthy write evidence.

If files exist but indexing failed, verification should not silently pretend no artifacts were produced.

### `release check`

Should treat missing artifact visibility as missing evidence when write work was expected to produce durable outputs.

## Failure Modes

### Write succeeds, artifact indexing succeeds

Desired path.

Trust surfaces remain consistent with reality.

### Write succeeds, artifact indexing fails

This is a governance reliability issue.

DAX should eventually surface it as:

- missing evidence
- degraded trust posture
- or explicit indexing failure

It should not quietly collapse to:

```text
artifact_count: 0
```

without explaining the mismatch.

### Write blocked or denied

No artifact should be claimed.

The session should instead show:

- approval blocker
- policy denial
- or incomplete execution state

## Trust Implications

Write-governance reliability directly affects:

- timeline accuracy
- session history accuracy
- verification credibility
- release readiness credibility

If DAX cannot reliably connect created files to trust surfaces, the system becomes weaker exactly where a governed control plane should be strongest.

## Design Constraints

- do not assume every filesystem mutation is a meaningful artifact
- do not require UI work to make write-governance coherent
- do not let successful writes disappear from trust surfaces silently
- keep the model compatible with existing artifact-heavy workflows that already behave well

## Non-Goals

This model does not yet define:

- exact artifact-indexing implementation details
- approval policy syntax changes
- TUI artifact visualization
- cross-session artifact correlation

## Acceptance Signal

This model is successful when a real operator can trust the following statement:

```text
If DAX created meaningful files, DAX's history, verification, and release surfaces will either show them or explicitly explain why they are missing.
```
