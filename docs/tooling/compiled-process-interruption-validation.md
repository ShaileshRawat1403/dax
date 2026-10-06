# Compiled process interruption and recovery acceptance

Base: compiled MCP checkpoint `2102bf119ec06f1d0175be992a65e421072f4132`.
Test-only slice; sole-owner validation, no independent review claim.

## Actual interruption boundary

A compiled fixture creates, approves, publishes, activates and starts a real
reviewed root. Its actual SessionProcessor opens an assistant message and writes
prompt/context dispatch provenance. The controlled local provider holds the
primary request without replying, then atomically signals readiness to the
parent test. Background title requests cannot signal readiness.

The parent terminates only that fixture-owned child with SIGKILL (native process
termination on Windows), waits for exit and drains both output streams. This
bypasses graceful application cancellation/settlement. A fresh process using the
same compiled binary and storage then attempts the actual SessionPrompt loop.

Restart requires `assistant_provenance_recovery_required`, makes zero provider
calls and leaves messages and journal unchanged. Event-only replay reconstructs
one unsettled message and the running run; no artifacts or terminal completion
appear. Parent failure cleanup also targets only its own fixture child. No user
process is stopped.

This establishes one real assistant-dispatch interruption boundary. It does not
prove every possible OS/filesystem crash window, compaction replacement crash,
external side-effect rollback or recovery action. Existing fault-injection
controls retain their separate scope.

## Validation

Bun 1.4.0 compiled acceptance: **1 passed, 0 failed, 23 assertions**.
Final full release gates: **2,377 passed, 2 skipped, 0 failed**, including workspace
checks, lint, smoke, Rust and release checks. No lockfile or manifest changes.
Exact-commit three-platform CI remains required for this interruption slice.

The preceding patched runtime/dependency checkpoint `ad394574d15c390a8e9e536670c130fe4e070f1b`
passed [CI 37399785188](https://github.com/ShaileshRawat1403/dax/actions/runs/37399785188)
on all three platforms. Its retained Windows log records strict recovery fixture
cleanup completing in 165 ms. This does not establish the original timeout's
underlying filesystem/handle cause or guarantee future platform reliability.

No merge, release, installed binary replacement or accepted gap closure. Final
execution-path inventory and exact-candidate platform acceptance remain.

## Evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `process-interruption-focused.log.gz` | `d0faf6a9fbdaaf01adf24f0af94ef60bf46680010f160946a7a84127246ea38f` |
| `process-interruption-owned-kill.log.gz` | `2f34f47d7ae68e8dacc41b042f209bcd8fd84eac720e6a77899f8e5b51fe2cdd` |
| `process-interruption-restart.log.gz` | `5fde98ad54a899bd0a0ed1101942d61c6dbf99e3dc3ff911542d1a1b1a4b5f5b` |
| `process-interruption-gates.log.gz` | `0b3763d01eac7c7d7610448b0f449be1cda74eb48bc5d72669060d8cab27838f` |
| `patched-checkpoint-windows-green.log.gz` | `b3ccf2a5d2dc41d29d8addc911c4943f9c803c7c2f3215fced4cc413b532bf0d` |
