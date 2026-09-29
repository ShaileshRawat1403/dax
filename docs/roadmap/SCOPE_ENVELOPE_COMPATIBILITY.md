# Scope-envelope compatibility checkpoint

Branch: `feat/scope-aware-envelope`
Base: `e2ac9cb1746e64b19515b330d77c0dfde957af5f`
Status: v2 reader support only; the aggregate gap remains open.

Historical run events retain their strict v1 schema. Their validated journal
location establishes run ownership for replay, but does not retroactively prove
that an explicit owner was recorded. A v1 event with new scope fields is refused.

The v2 run envelope schema requires `scopeType: "run"` and `scopeId` equal to
`runId`. Optional `sourceRefs` identify evidence in another scope without
transferring authority or retaining its content. Malformed owners, unsafe scope
IDs, duplicate references, and self-references are rejected. A reference is a
provenance pointer, not proof that the cited source still exists after retention.

The production run writer deliberately remains v1. A proposed global cutover to
v2 writes was rejected by workspace safety review because it would change every
new durable run event and older-binary replay behavior. Do not infer that the
parser tests authorize that cutover. A specific compatibility and operator
migration decision is required before changing the run writer. No release or
installed binary is changed by this branch.

Project-owned events and their write-side source verification are a separate
implementation slice. `scope.aware-envelope` cannot close until production
ownership and historical coverage are demonstrated across both scopes.

## Local evidence

Pinned Bun 1.4.0 `release:gates` passed: 2,044 tests passed, 2 skipped, 0
failed, followed by smoke evaluations, Rust verification, and release checks.
The retained log is `artifacts/validation/scope-envelope-20260929/gates.log`.
Focused scope/run-log tests passed (29 tests, 63 assertions), typecheck and lint
passed, and `git diff --check` passed. These are solo checks; exact-SHA platform
CI and Astra's independent review are not yet claimed.
