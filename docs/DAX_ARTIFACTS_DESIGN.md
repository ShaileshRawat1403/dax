# DAX Artifacts Design Pass

## 1. Product Definition

An artifact is a retained execution output associated with a session, task, or workflow step, available for inspection and downstream use.

This definition is intentionally narrower than "any file" and broader than "chat output".

Artifacts are not generic file browsing.
Artifacts are not trust verification.
Artifacts are retained outputs with operational meaning.

## 2. Why Artifacts Matter

The current canonical grammar is:

- `plan` defines work
- `run` executes work
- `approvals` exposes checkpoints

The next layer is inspectability.

`artifacts` should answer:

- what was produced
- which session produced it
- what kind of output it is
- what can be inspected or reused later

That makes DAX feel like a delivery system rather than a transient assistant session.

## 3. Scope Boundary

`artifacts` should own:

- retained execution outputs
- session linkage
- artifact metadata
- operator inspection

`artifacts` should not own:

- generic filesystem browsing
- audit or trust semantics
- evidence integrity checks
- release verification

Those belong to later trust surfaces.

## 4. Canonical Sources in the Current Runtime

Artifact behavior likely spans:

- session outputs and generated content
- exported or retained execution products
- diff/review surfaces already present in the TUI
- later release and audit handoff points

This next pass should inspect canonical runtime behavior first and donor behavior second.

## 5. V1 Command Purpose

`dax artifacts` should expose retained outputs in a way that operators can inspect without digging through implementation details.

It should feel like:

- inspect outputs
- review retained work products
- reconnect to prior execution state

Not:

- browse random files
- inspect logs
- verify trust

## 6. V1 Output Questions

The operator should be able to answer:

- what artifacts exist for this session or work item?
- what type of artifact is each one?
- where did it come from?
- what should I inspect next?

## 7. Likely V1 Metadata

At minimum:

- artifact id or stable reference
- session id
- artifact type
- title or summary
- created time
- source or origin step

Possible later fields:

- related approval
- related audit finding
- export path
- retention status

## 8. V1 Output Modes

Human-readable mode:

- concise list for operators
- grouped by session or recency if useful
- clear type and title

JSON mode:

- stable structured output
- suitable for automation and later export workflows

## 9. Non-Goals

- no artifact redesign yet
- no generic file explorer
- no trust/evidence claims
- no release verification folded into artifacts
- no breaking change to current session model

## 10. Relationship To Trust Surfaces

Keep the next two concepts separate:

### `artifacts`

Owns:

- what was produced

### trust / audit / evidence surface

Owns:

- why the output can be trusted
- whether the trace is complete
- whether integrity checks pass

This separation keeps storage and trust from collapsing into one vague surface.

## 11. Acceptance Signals

`dax artifacts` is successful when:

- artifacts feel like retained execution outputs, not files
- operators can inspect outputs by session or workflow context
- the command fits naturally after `plan`, `run`, and `approvals`
- the design does not blur into trust verification

## 12. Next Step

Before implementation:

1. inspect current canonical artifact-related runtime behavior
2. inspect donor `artifacts` behavior for useful product semantics
3. define the v1 command contract and metadata model
