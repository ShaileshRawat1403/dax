# DAX 2.0.0 publication handoff

Prepared runtime/tag source: **`87029cbd57dd16c330f677b8cc699c3404ecd45f`**,
published on `release/2.0.0-candidate`. Integrate the separate
`docs/release-2.0.0-final-evidence` receipt branch to carry the final records too.
That receipt is not the binary source. No public v2.0.0 tag exists yet.

## Completed preparation

[Exact-source CI](https://github.com/ShaileshRawat1403/dax/actions/runs/37716643300)
is green on Ubuntu, macOS and Windows. Fresh frozen Bun 1.4.0 tagged release-mode
gates pass 2,401 tests on macOS, with zero skips and no failures. Bounded separate-agent
review accepted credential filtering, malformed request handling and the CMD quote
correction. Eleven canonical archives, member hashes and disposable installer/
checksum refusal are verified; [the final record](release-2.0.0-final-checkpoint.md)
retains failures as well as successes. The candidate sprint ledger is empty within
its documented scope, not a promise of no defects or every executor binding form.

## Integration and publication — maintainer actions

The maintainer explicitly authorized Codex to integrate main, verify its CI and
publish v2.0.0 on 2026-10-08. Publication remains pending until those actions succeed.

1. Fetch origin and inspect the current main plus every checkout affected by cleanup.
   Preserve unexpected changes. Verify current main is an ancestor of the exact
   evidence receipt SHA. If it advanced incompatibly, review the intervening work;
   do not force, squash or rewrite this prepared source.
2. Fast-forward main to the pinned final evidence receipt and push it. Wait for
   Ubuntu/macOS/Windows CI at the exact integrated SHA. Verify remote parity.
3. Confirm the [breaking migrations and supported limits](../product/release-2.0.0.md),
   version/date and source pin. Verify the runtime source above is incorporated in
   published main, then create and push annotated v2.0.0 **at that runtime SHA**.
   Do not tag the later receipt instead unless its artifact validation is repeated.
4. Require the tag-triggered release workflow to pass and publish its canonical
   assets. Verify released version/tag, eleven archive inventory and archive hashes
   against the published manifest/SHA256SUMS. CI rebuilds on Linux; do not assume
   those bytes equal the prepared macOS-host artifacts or that all targets include
   Rust sidecars. Validate an actual published download in a disposable install.
5. Update release status with the real release/CI URLs in a separate docs commit.
   Retire only clean, fully incorporated branches/worktrees after ancestry and
   remote checks. Preserve dirty frozen worktrees, user config, unrelated refs,
   dependency caches and needed ignored evidence. No binary replacement is implied.

Prepared archives are preserved in the owned dax-patched-deps-validation worktree
at `artifacts/release-2.0.0-87029cb/`. Retain them before retiring that checkout.
v1.5.0, its release assets and the operator-installed binary remain unchanged.

## Public limits that stay explicit

- Operator credentials authenticate shared-secret access; actor names are audit
  labels. Removing direct shell inheritance does not isolate arbitrary same-user
  code or trusted plugins/startup profiles.
- Older MCP OAuth credentials need reauthentication/expectedIssuer configuration.
  Newly written journals must not be opened with v1.5.0.
- Reviewed plugin/local-MCP/worker/verifier executable bindings remain unsupported
  and denied. Historical unknown coverage stays unknown.
- Rust sidecars are build-host-only; non-host coverage, live IdP/provider integration
  and a whole-stack independent security audit are not claimed.
