# DAX Rust Crates

DAX uses Rust only for deterministic proof surfaces around stochastic model execution.

| Crate | Purpose |
| ----- | ------- |
| `dax-core` | Replays canonical run events to reconstruct run state; generates deterministic proof reports |
| `dax-policy` | Evaluates proposed actions against policy context into `allow / ask / deny` decisions |
| `dax-audit` | Evaluates trust posture from six structured run signals |
| `dax-ledger` | Builds and verifies tamper-evident append-only ledger chains |
| `dax-indexer` | Builds deterministic local repo structure indexes for context selection |
| `dax-core-bin` | JSON stdio boundary for `dax-core` (commands: `replay`, `proof`, `version`) |
| `dax-policy-bin` | JSON stdio boundary for `dax-policy` (commands: `evaluate`, `classify`, `version`) |
| `dax-audit-bin` | JSON stdio boundary for `dax-audit` (commands: `evaluate`, `version`) |
| `dax-ledger-bin` | JSON stdio boundary for `dax-ledger` (commands: `append`, `verify`, `append-file`, `export`, `version`) |
| `dax-indexer-bin` | JSON stdio boundary for `dax-indexer` (commands: `build`, `query`, `symbols`, `imports`, `dump`, `version`) |

TypeScript orchestrates. Rust decides deterministic facts.

## Design rules

- Each proof crate is a pure library with no I/O. The `*-bin` companion adds the JSON stdio boundary.
- Each output carries a `schema_version` field so the TypeScript boundary can detect version drift.
- All proof outputs are golden-fixture tested. A code change that alters proof output fails `cargo test --workspace` immediately.

## Sidecar resolution

In development, TypeScript calls `cargo run -q -p dax-{core,policy,audit}-bin` as a fallback.

In release builds, `build.ts` compiles the Rust sidecar binaries for the host platform and places them alongside the `dax` binary in `dist/<target>/bin/`. At runtime, the adapter resolves the sidecar via `process.execPath`-adjacent lookup — it checks the directory containing the running `dax` executable. Set `DAX_RUST_BIN_DIR` to override with a custom directory.

Cross-platform sidecar compilation requires a per-platform build agent (e.g., linux-arm64 CI runner for the ARM Linux sidecar). The `build.ts --single` flag builds only the current host target and its sidecars; full multi-platform release packaging requires running the build on each target platform.

## Schema versions

| Surface | Schema version |
| ------- | -------------- |
| Core proof report | `dax.core.proof.v1` |
| Policy decision | `dax.policy.decision.v1` |
| Audit trust report | `dax.audit.v1` |
| Ledger entry | `dax.ledger.entry.v1` |
| Indexer index | `dax.indexer.index.v1` |

## Running tests

```bash
cargo test --workspace
```

## Adding a new Rust crate

Do not add new crates without a clear proof-surface purpose. The boundary rule is:

- Rust decides deterministic facts.
- TypeScript orchestrates, renders, and integrates.

If a new crate is needed, follow the `*-bin` sidecar pattern and add golden fixtures before merging.
