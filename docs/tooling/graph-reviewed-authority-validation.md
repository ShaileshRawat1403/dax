# Task-graph reviewed authority correction

Sole-owner correction based on `41b42991195df57108262afdd41c41727a2a01c2`.
No main integration, release, installed-binary change or aggregate gap closure.

## Reproduced production boundary

`runGraph` selected an executor identity then invoked it directly. Real reviewed
root and inherited child fixtures, including loss of the private review record,
executed a controlled effect before the correction. Those three regressions
failed on the base. Additional controls independently reproduced fallback from
an explicit missing governing contract and a deleted child session record.

Graph dispatch now resolves the actual session/storage owner and its governing
contract, then calls the existing shared action resolver with the selected
operator descriptor before invoking its captured executor. An activated reviewed
run without an operator grant records an enforced denial in its own journal.
Pending, corrupt, missing or uncertain authority refuses before operator effects.
The captured executor still rechecks handle identity immediately before execution.

Synthetic noncanonical CLI graphs and existing no-contract sessions keep explicit
legacy compatibility. A session-shaped identifier with no backing session is now
refused rather than silently interpreted as legacy. Graph lifecycle bus messages
remain presentation; this correction does not manufacture canonical transitions.
Graph implementations still have no supported reviewed binding and are not granted.
This is fail-closed mediation, not positive support for those executors.

## Controls and compatibility

- Real root and inherited child review, lost private review, malformed/wrong-owner
  session, missing explicit governing contract and deleted session: zero operator
  effects; canonical journal unchanged before activation.
- Genuine compiled DAX producer, approved/published/activated/claimed run, root
  and child graph: one durable enforced denial per attempt, replay agrees, zero
  operator/provider effects. No image, authority, dispatch or provider spies.
- The same compiled producer's actual no-contract session executes its graph once.
- Existing selected-handle mutation, native Git dispatch and legacy/custom graph
  controls remain green. This does not assert OS process-kill recovery.
- The added `operator_graph` resolution path is a journal vocabulary change;
  older binaries reject it. Do not use v1.5.0 against these development journals.

## Validation

Bun 1.4.0, repo-root preload, isolated DAX/XDG homes, disabled model/config
fetch/install and CI's 4 GiB Node heap setting.
Focused graph/compiled/action/identity suite: **35 passed, 0 failed, 200 assertions**.
Final full release gates: **2,374 passed, 2 skipped, 0 failed**; workspace
checks, lint, smoke, Rust, integrity and release checks passed. An earlier complete
run passed before the additional missing-contract/session controls; it is retained
as intermediate evidence, not the final-source result. Lockfile/manifests unchanged.
Exact-correction hosted CI is required before integration.

The preceding settings compatibility correction passed all three platforms at
`41b4299`: https://github.com/ShaileshRawat1403/dax/actions/runs/37316385756.

## Retained evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `graph-reviewed-authority-baseline-bypass.log.gz` | `3757f6b86e5b47a86f3adbb19f9638590a952756731d04566d2687f39e6ff2dc` |
| `graph-reviewed-authority-missing-contract.log.gz` | `d6b98b7c84a7f229d3970d3651c7b7faa662d1a86c6fd7d249051c7f050cc368` |
| `graph-reviewed-authority-missing-session.log.gz` | `bf0c4230a87f0c9bb84892af3fee18e8341d21e880c930fc88ab002e12e6e8fc` |
| `graph-reviewed-authority-focused.log.gz` | `842cef0e60dfba1dd27247a6a508adb26cc3cd6bba8d3f2cb334f3a1da558cd7` |
| `graph-reviewed-authority-intermediate-gates.log.gz` | `2a34ac5d7ff443c1eac48960f4075201a9205094c55d3efea6f9f104cf482fb9` |
| `graph-reviewed-authority-final-gates.log.gz` | `7a9774d82d2ae5de9a03315eb2dd40bf4d10bac0e4fe5df3781824b2cc642ef2` |
