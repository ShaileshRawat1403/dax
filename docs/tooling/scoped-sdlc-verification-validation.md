# Explicit-session SDLC verification mediation

Base: real interruption checkpoint `0cbb890cb7b2a4dd3a4ed05ce0d7c078acec41c7`.
Sole-owner runtime correction; no independent review claim.

## Reproduced boundary

The exported `verifySdlc` helper accepted an activated reviewed session ID as its
receipt run ID, then discovered and launched repository checks without consulting
that authority. A real compiled probe passed a reviewed root lacking a supported
verifier grant. The owned package test command still created its effect file;
there was no capability denial. The retained baseline log reports
`effectExists: true`.

## Correction and compatibility

Identifiers in the reserved session namespace (prefix `ses`, matching the existing
session identifier convention) are now treated as references, not unscoped receipt
labels. The shared resolver validates session/storage ownership and governing
authority. It records a direct verification-command decision before repository
inspection and refreshes the decision before each command.

Reviewed verifier bindings are not supported by this candidate, so the actual
scoped request is durably denied before effects. Missing or unreadable session
references fail closed. Nothing invents a verifier grant or executor binding.

The ordinary `dax sdlc verify` CLI supplies no session reference and remains an
unscoped operator operation. Non-session IDs remain receipt correlation labels;
they grant no authority. A genuine explicitly bound v1 session retains existing
compatibility and successfully executes the same owned test command. A caller
previously using a `ses`-prefixed string only as an arbitrary correlation label
must use a non-session label or supply a real session in its project context.
No stored contract is migrated or silently reinterpreted.

The scoped resolver is imported lazily: unscoped report/helpers do not initialize
the session authority graph just to format or execute ordinary operator checks.

## Production controls and validation

Compiled SDK-free verification probe: activated reviewed reference yields one
durable enforced denial and zero command effects; missing reference yields
`authority_unreadable` and zero effects; unscoped and bound-v1 checks genuinely
create the controlled effect file. There are no authority/executor/image spies.
Event replay equals the reviewed run projection; no model call occurs.

Final focused: **3 passed, 0 failed, 30 assertions**. Bun 1.4.0 full release gates:
**2,377 passed, 2 skipped, 0 failed**, including workspace checks, lint, smoke, Rust,
repository and release checks. Lockfile/manifests unchanged by this slice.
Exact-SHA platform CI remains required. No merge, release, installed binary
replacement or accepted gap closure. Final path inventory remains outstanding.

## Evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `scoped-sdlc-red.log.gz` | `96c73028e37a857719973991811267983e63c62d53fde76d271f29070b9f64f0` |
| `scoped-sdlc-final-focused.log.gz` | `274072fe4e45d3c7a36b9f4dea9ea1f3d4d31735558f42228d0684e546e43aed` |
| `scoped-sdlc-gates.log.gz` | `8cb5d7e10ffbb7a437a95564543e5434b242c236cb6d3acad37162137cd21b1f` |
