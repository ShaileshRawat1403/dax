# Explicit debug no-contract boundary

Base: session integrity correction `c08fc211521139ee10477c205d877ea978849e41`.
Sole-owner validation; no independent review claim.

## Production boundary

The debug agent command deliberately creates its own fresh session and accepts
no caller-provided session/run reference. Before executing the captured tool,
it now proves absence of grant review, governing contract, authority marker and
canonical events. Unexpected authority refuses dispatch rather than being
borrowed or silently converted into compatibility.

It calls the same capability lookup with a positively established null contract,
the actual captured descriptor/alias and operator initiator. The JSON diagnostic
includes the resulting `basis: no_contract` and `enforcement: record_only`;
this grants no canonical authority and creates no run journal. Existing tool
permissions, denials, descriptor binding and result validation are unchanged.
Operator-supplied JS object literals remain the existing trusted debug interface,
not a model or reviewed-run ingress. No new execution session selector is added.

## Genuine compiled acceptance

The real AgentCommand handler reads the owned evidence file. Its stdout reports
no-contract lookup and the actual read result. Exactly one fresh session is
created; it has no governing reference, contract or event journal, and makes no
provider call. Native/plugin dispatch regressions also retain executor mutation
and permission controls.

The first combined focused run timed out in the compiled matrix. Its reported
elapsed time substantially exceeded the configured deadline; the cause is not
established. The isolated run used CI's disabled startup notice and passed in
20 seconds. That change and isolation do not prove a causal explanation.
The passing full CI-style gate below is separate evidence; no failure is hidden.

## Validation

Bun 1.4.0 isolated compiled acceptance: **1 passed, 0 failed**. Full release gates:
**2,377 passed, 2 skipped, 0 failed**, including workspace checks, lint, all smoke,
Rust and release checks. No lockfile/manifests changed. Exact-commit platform CI
remains required. No merge, release, installed binary change or accepted gap
closure; final inventory and ledger reconciliation remain outstanding.

## Evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `debug-boundary-initial-timeout.log.gz` | `f8575a551714b97e77794e4bbaf08e8d373a851ddf223b1b69b4d31bffe2da79` |
| `debug-boundary-isolated.log.gz` | `b866bae31e9c01c7f7af95779c19a1a50e5cc7d6952251b7a5bf40784544e5db` |
| `debug-boundary-gates.log.gz` | `17fea28c2099ab1d98b358b4c98e1b51b7e400a73d4d103dff1ca7d58bdcf348` |
