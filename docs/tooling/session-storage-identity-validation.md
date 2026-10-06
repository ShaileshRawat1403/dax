# Session storage identity and governing-reference integrity

Base: actual ask checkpoint `1dda15a7abf3fb592b26600e99838c3dab7b9e89`.
Sole-owner validation; no independent review claim.

## Reproduced defects

The shared session getter returned stored JSON without comparing its ID/project
with the storage key. A compiled probe changed only the stored project ownership
claim and submitted through actual SessionPrompt. The baseline made **four model
requests and appended fifteen events**, instead of refusing the corrupt metadata.

A separate probe changed a pending reviewed root's governing pointer to another
activated root. It likewise made **four model requests and appended fifteen
events in the borrowed root**. The pending root's review was bypassed through
mutable metadata. This is a reproduced authority boundary error, not merely a
label discrepancy or a speculative filesystem attack.

## Correction

Session.get now captures the storage project and rejects mismatched IDs or owners
with `session_identity_mismatch`. Explicit governing references must be valid
session identifiers. When the pointer names another root, this session must not
already own an authority marker, journal events or a grant review. Contradictions
raise `session_authority_mismatch`; unreadable ownership evidence raises
`session_authority_unreadable`. Metadata is never silently repaired.

Real derived sessions have no independent run authority and retain inheritance.
Self-governed roots and genuine unbound/v1 sessions retain existing semantics.
The getter checks identity/reference fields without stripping or revalidating
unrelated historical payload fields. It does not add directory equality rules,
rewrite contracts, or claim protection against arbitrary machine-owner writes.

## Controls and validation

Compiled corrupt-owner and corrupt-ID dispatches make no model requests and
leave the journal unchanged. A pending root cannot borrow another active root;
both journals remain unchanged. Restoring the test's original metadata allows
normal reads. The compiled matrix still passes real TaskTool fresh/resume,
MCP dispatch, ask/remember, graph/verification denials and kill/restart checks.

Initial focused inheritance/delegation controls: **18 passed, 0 failed,
97 assertions**. Final authority+compiled controls before promise-style cleanup:
**9 passed, 0 failed, 30 assertions**. Final directly awaited authority assertions:
**8 passed, 0 failed**. Final full Bun 1.4.0 release gates: **2,377 passed,
2 skipped, 0 failed**, with workspace checks, lint, smoke, Rust and release checks.
Exact-SHA platform CI remains required before integration.

The first full run's one failure read malformed metadata before its rejection
assertion. The test now independently asserts reader rejection and directly tests
the resolver using raw stored data. Lint then exposed old promise-matcher usage
in that touched file; directly awaited assertions replace it. Its nine obsolete
await-thenable suppressions were removed; no lint rule or test was weakened.
All failed attempts are retained below. Lockfile/manifests unchanged by this slice.

No merge, release, installed binary replacement or accepted aggregate gap closure.
The final path inventory and explicit debug no-contract boundary remain outstanding.

## Evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `session-identity-owner-red.log.gz` | `228065a3dfa2b28225c033fc60f2966f44887a769b0f64c1f707486a02096082` |
| `session-identity-governing-pointer-red.log.gz` | `0a64c4312bd4bb30d9fe7542c73de178e78bd5510eb097fb956f507158ed6250` |
| `session-identity-initial-focused.log.gz` | `1ef6b17044c297e81ed59f1be1af66ec7ab043aee32d6ce884ccf4f3c74325ed` |
| `session-identity-initial-gates-red.log.gz` | `3c21dcb1327265525a5f8f659d62c3c276585477d67aa0be60e96f480d668e24` |
| `session-identity-lint-red.log.gz` | `685e8558a16c6e1beea27b04d7f5eb93acf62527d79be1a62612c3c468f59dca` |
| `session-identity-unused-suppression-red.log.gz` | `88bcfa14c18e4d15a6ffbefd513fe63e756ae65c7d2e4e9612df984dd567f4b2` |
| `session-identity-final-focused.log.gz` | `568f09fa7b9d0b2e8d689cec639b52f48cbf6a34a517f3f5134cd0403d0cf00e` |
| `session-authority-promise-assertions.log.gz` | `e957754511dad20ceded7aec5359456fb96595831abe1a578c534726567ff9d4` |
| `session-identity-final-gates.log.gz` | `f66ec1a93c667d48eda531d5c583b407c13a597279b1b4c854f2005b78687ec5` |
