# DAX Rust Crates

DAX uses Rust only for deterministic proof surfaces around stochastic model execution.

| Crate | Purpose |
| ----- | ------- |
| `dax-core` | Replays canonical run events to reconstruct run state; generates deterministic proof reports |
| `dax-policy` | Evaluates proposed actions against policy context into `allow / ask / deny` decisions |
| `dax-audit` | Evaluates trust posture from six structured run signals |
| `dax-core-bin` | JSON stdio boundary for `dax-core` (commands: `replay`, `proof`, `version`) |
| `dax-policy-bin` | JSON stdio boundary for `dax-policy` (commands: `evaluate`, `version`) |
| `dax-audit-bin` | JSON stdio boundary for `dax-audit` (commands: `evaluate`, `version`) |

TypeScript orchestrates. Rust decides deterministic facts.

## Design rules

- Each proof crate is a pure library with no I/O. The `*-bin` companion adds the JSON stdio boundary.
- Each output carries a `schema_version` field so the TypeScript boundary can detect version drift.
- All proof outputs are golden-fixture tested. A code change that alters proof output fails `cargo test --workspace` immediately.

## Sidecar resolution

In development, TypeScript calls `cargo run -q -p dax-{core,policy,audit}-bin` as a fallback.

In release builds, pre-built binaries are placed under `packages/dax/dist/bin/` and the adapters use those instead. Set `DAX_RUST_BIN_DIR` to point at a custom directory of pre-built binaries.

## Schema versions

| Surface | Schema version |
| ------- | -------------- |
| Core proof report | `dax.core.proof.v1` |
| Policy decision | `dax.policy.decision.v1` |
| Audit trust report | `dax.audit.v1` |

## Running tests

```bash
cargo test --workspace
```

## Adding a new Rust crate

Do not add new crates without a clear proof-surface purpose. The boundary rule is:

- Rust decides deterministic facts.
- TypeScript orchestrates, renders, and integrates.

If a new crate is needed, follow the `*-bin` sidecar pattern and add golden fixtures before merging.
