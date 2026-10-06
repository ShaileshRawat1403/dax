# Genuine compiled MCP producer acceptance

Base: patched dependency checkpoint `ad394574d15c390a8e9e536670c130fe4e070f1b`.
Test-only slice; solo validation, no independent review claim.

## Actual production paths

The compiled fixture starts two controlled HTTP SDK servers, uses real production
MCP discovery/client/transport, creates and activates operator-reviewed source
grants only for gamma, and dispatches through SessionPrompt. It substitutes no
implementation image, authority, executor or provider method.

- A model-selected gamma tool receives exactly one actual SDK call and its
  returned content reaches the session with completed invocation evidence.
- A gamma resource attachment receives exactly one actual read through the real
  user-message producer and its returned text reaches the session.
- A gamma MCP prompt command receives exactly one actual fetch through the real
  command producer and its returned text reaches the session.
- Delta requests on all three paths receive durable enforced denials and zero
  tool/resource/prompt server calls. The gamma source grants cover none of them.
- Allow/deny records exist for each path. Event-only replay equals projected
  state; the resource URI and private prompt name are absent from the journal.
  Returned text is checked in session storage, not advertised as journal-retained.

Initial red runs had fixture mistakes: an incomplete resource source shape and
an incorrect command alias (`_` instead of the actual `:` convention). Both were
corrected to production inputs. No runtime defect was established by those runs.

## Validation

Pinned Bun 1.4.0 with the fresh patched dependency installation. Compiled and
MCP identity regression controls: **7 passed, 0 failed, 84 assertions**.
Final full release gates: **2,377 passed, 2 skipped, 0 failed**, including all
workspace checks, lint, smoke, Rust and release checks. The full log retains the
actual MCP effect counters and compiled delegation/graph control results.
Lockfile and manifests are unchanged by this test-only slice.
Exact-SHA three-platform CI remains required before integration.

The fixture proves DAX adapter dispatch and shared mediation, not attestation
of external server implementation or OAuth behavior. OS process interruption
acceptance and the final path inventory remain outstanding. No merge, release,
installed binary replacement or accepted gap closure. v1.5.0 is unchanged.

## Evidence

Compressed files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `compiled-mcp-fixture-shape-red.log.gz` | `85eb8056476ebf4237db55675468f9874544e358209777f471e143bab39e12ac` |
| `compiled-mcp-fixture-alias-red.log.gz` | `995fee45f62f4fdd25aceb1ac4ed81edb2f6a4cdefb78519661698dc339fbadd` |
| `compiled-mcp-final-focused.log.gz` | `71f0c910a0bb545e9794386859f8b6a9116b1c5339eb27afeeca8f1d9af77966` |
| `compiled-mcp-gates.log.gz` | `89629ee2c12449ac745dc72122a0b6fb4348a8cfb3acfab102c8ae90bae82327` |
