# MCP OAuth issuer binding security correction

Base: `b778597b64eed9f756589cd81e685895a53d688c`.
Sole-owner validation; not independent review or release acceptance.

## Cause and change

[CI 37599603085](https://github.com/ShaileshRawat1403/dax/actions/runs/37599603085)
stopped before tests at the existing dependency audit threshold. It reports
[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h)
against MCP SDK 1.29.0. The advisory requires SDK 1.31.0 or later plus preserving
issuer metadata in custom providers and refusing unsafe unstamped credentials.
DAX's provider previously dropped that issuer when persisting and restoring tokens
and client information. The patched SDK alone would therefore be insufficient.

The direct dependency floor is 1.31.0; the frozen lock resolves 1.32.1. Only that
package resolution and its direct range changed. DAX now persists/returns the
issuer for tokens and dynamic client registration. Historical issuerless records
stay on disk but are not supplied to the SDK; a fresh interactive sign-in is
required. Configured clients require `oauth.expectedIssuer` from the operator's
trusted authorization-server configuration, never an inferred MCP discovery URL.
Both remote connection and explicit authentication producers forward that field.
Unstamped new writes fail before changing storage. User credential files and the
installed v1.5.0 binary have not been migrated or replaced by validation.

## Controls and compatibility

Disposable, uniquely named credential records exercise real DAX storage and the
real patched SDK with controlled discovery/token responses. Bound refresh succeeds
at the trusted issuer. Changed-issuer discovery sends none of the old access token,
refresh token or client secret and never calls the token endpoint; the test refuses
the new interactive authorization redirect. Issuerless reads return no credentials
without deleting the underlying records. Pre-registered missing/malformed issuers
and unstamped persistence fail closed. Restoring the old provider makes all five
new regression controls fail. The existing callback privacy regression stays green.

The first test fixture omitted OAuth state, and initial typechecks exposed missing
registration redirect URIs and the Bun fetch type mismatch. These fixture failures
are retained; they are not additional production defects. The final fixtures include
real state, registration metadata and the SDK's FetchLike type.

New interactive sign-in still depends on trusting the selected MCP server, as the
advisory states. These controls do not claim provider receipt attestation, credential
encryption, historical-secret rotation or protection of the already published binary.
This is a compatibility change for pre-registered clients and issuerless history,
recorded under Unreleased.

## Validation

Pinned Bun 1.4.0 frozen install passed with no further changes. Audit retains its
high threshold and passes: 745 packages checked, 21 reports below that threshold.
Focused OAuth/callback controls: **6 passed, 0 failed, 19 assertions**. Full final
release gates: **2,382 passed, 2 skipped, 0 failed**, plus workspace typechecks,
lint, smoke, Rust and release checks. Exact-SHA all-platform CI is required before
integration. No merge, release, installed-binary change or grant-gap closure.

## Retained evidence

Files under `evidence/`; SHA-256 covers decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `mcp-issuer-audit-ci-red.log.gz` | `35eafc39152e0d9feb17fa7c5841a141acabbda6d80bca94c284bed30a4f5c79` |
| `mcp-issuer-install.log.gz` | `ecd50fcf6ca3a869c213f4a6139e51b35130bdf6102964882df4da21d72f494f` |
| `mcp-issuer-frozen.log.gz` | `d3771c5e9f4e1ca7c646b2b3d7ff8aaadc5d34fb2534f013d4b2f310bd4dcce5` |
| `mcp-issuer-audit.log.gz` | `e3e3aec56092049d5ab08a8c4eca015954c51609d2fb10ea3890455c93041748` |
| `mcp-issuer-fixture-red.log.gz` | `90464344fa788094ad08a9885ab2218b794c30a049ba15d400d8d7cf90033cb9` |
| `mcp-issuer-typecheck-red.log.gz` | `6d760f9fcd754bcdc1fefcc807b1037746f0ca52d6a1c2046bfac14df7fd7f08` |
| `mcp-issuer-gates-typecheck-red.log.gz` | `63872920f8286773a22153e9ac70e014d815d05e4c69fa6fde4e41c32528024b` |
| `mcp-issuer-negative.log.gz` | `710cdf162618e58600b7b98278804b5efa1b5731baed10bd74b99d42f4c57b06` |
| `mcp-issuer-focused.log.gz` | `9fa93ce798230fb619e6bead35495ae46c9ef60f4be166f3c4a21f080373edc3` |
| `mcp-issuer-gates.log.gz` | `2d6d893801e620f3aa64a0802330c717cf1b43bf424e9abb97149120225f9b46` |
