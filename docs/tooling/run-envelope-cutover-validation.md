# Run-envelope cutover candidate

Owner: Sol. Tier 2. Branch: `feat/run-v2-envelope-cutover`.
Base: project-journal checkpoint `cffb98b1b8018767c33214b8eaa37c70aee8729a`.
This stack is not integrated or independently accepted. Published main has eight
open gaps; this candidate proposes journal-primitive and scope-aware-envelope
closure, leaving six candidate entries. The other gaps are not declared closed.

## Compatibility and authority

The maintainer explicitly approved the bounded v2 cutover on 2026-09-30 after
automatic approval review blocked the initial runtime patch. New canonical runs
record v2 in their durable initialization recipe before writing genesis; their
events name the single run owner. Existing v1 journals retain v1. Historical
interrupted recipes without a version repair as v1. Format selection, recipe
validation and append occur under the run lock, without provider execution.

Mixed versions, malformed owners, conflicting recipes and invalid source
references are rejected without rewriting a published journal. Caller inputs
cannot choose the owner or version. v2 source references survive persistence;
they are citations, not grants or copied authoritative state. Reference-shape
validation does not prove the cited evidence exists: the project fact producer
separately verifies its digest-bound run approval before accepting a transition.
Historical v1 appends reject references instead of silently discarding them.

No historical journal migration, contract-v2 activation, raw transcript retention,
or project-memory production is included. Older binaries cannot read v2; never
direct the published v1.5.0 binary at development journals. Digests do not recover
transcripts; adapter commitments do not prove provider receipt. Historical history
coverage stays unknown. Full-process OS-kill recovery remains untested.

## Isolated inherited CI correction

The preceding project-journal checkpoint's
[CI run](https://github.com/ShaileshRawat1403/dax/actions/runs/36594783791)
failed on macOS in `template-context-identity.test.ts`; Ubuntu passed and Windows
was cancelled. Source inspection showed parallel stat callbacks pushing directly
into a shared prompt-part array, ordering references by lookup completion.
The separate `68f9e5d` commit preserves template order while retaining parallel
lookups, identity checks, deduplication and fallback behavior. Its controlled
regression forces the second lookup to finish first: it fails against the old
producer and passes against the correction. An initial probe timed out because
its template punctuation changed the parsed reference; correcting the fixture
then exposed the expected ordering assertion failure. No tests were skipped or
weakened, and CI was not rerun blindly.

## Validation

Pinned runtime:
`/Users/Shailesh/MYAIAGENTS/dax/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64/bun`
reports Bun 1.4.0 (`34cbb9a40`). Use the
[provisioning instructions](bun-toolchain-verification.md#reproduce-the-isolated-setup)
on other hosts; do not rely on a temporary runtime or change other projects.

- Cutover, run-log integrity and project-journal suites: 39 passed, 0 failed,
  111 assertions. Negative controls cover mixed logs, recipe conflicts, owner
  injection, malformed references, interrupted genesis, historical repair,
  concurrent initialization and rejection with unchanged storage.
- Template-identity suite after the isolated correction: 7 passed, 0 failed,
  21 assertions; the deterministic ordering regression failed before the fix.
- DAX typecheck passed after correcting two test-only type errors; no runtime
  type error was ignored.
- Full pinned-runtime `release:gates`, isolated DAX home and XDG directories:
  2,063 passed, 2 skipped, 0 failed; five workspace typechecks, lint, smoke
  evaluations, Rust formatting/clippy/tests and source release checks passed.
  This is not tagged release-mode validation. Local evidence is preserved outside
  test discovery at
  `/Users/Shailesh/MYAIAGENTS/dax/artifacts/validation/run-v2-envelope-cutover-20260930/release-gates.log`.
  SHA-256: `e63c1faf2af0b5e9ec7cac782e18aa2b1e18829703ef5e6c1b07c8d3fe9aeabb`.
- Documentation checks resolved 22 relative links; `git diff --check` passed.
- The final handoff must identify the pushed SHA and its exact-SHA CI run; do
  not substitute the preceding failed project-journal run for this evidence.

## Dependency-audit followup

Cutover checkpoint: `05bf3b2e47660c1506b1aa34ae6059d3566a3c64`.
Its [exact-SHA CI](https://github.com/ShaileshRawat1403/dax/actions/runs/36693166730)
failed during the unchanged high-severity dependency audit on all three
platforms, before code tests ran. The earlier project-journal test failure is
separate. Both CI failure logs are retained in the local evidence directory.

The separate branch `fix/conformance-audit-dependencies` builds on the preserved
cutover checkpoint and changes only two transitive overrides and their lockfile
entries: `brace-expansion` 5.0.11 and `undici` 6.28.1. These are the patched versions
identified by the upstream [brace nesting advisory](https://github.com/advisories/GHSA-qhr7-859c-m2p7),
[brace comma-parser advisory](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p),
and [Undici advisory](https://github.com/advisories/GHSA-rfgv-xxqx-mfg5).
No blanket dependency update, major-version change, audit exception or gate
change is included. This commit does not alter the installed DAX release.

Pinned Bun 1.4.0 frozen installation with scripts disabled passed and preserved
the corrected lockfile hash
`831bad444f35a22dd8469507f15aac499809502eed5b09781d0c86ba35e642de`.
The high-severity audit passed across 745 packages; 20 findings are below that
threshold, so this is not a claim of zero dependency findings. The resolution,
frozen-install and audit logs are retained alongside the cutover evidence. Full
gates on the updated dependency tree and exact-SHA CI must be checked for the
followup handoff, not inferred from the earlier local run.

The first updated-dependency gate attempt stopped at workspace typechecking.
TypeScript's resolution trace identified broken implicit `d3-*` type libraries
in `/Users/ananyalayek/node_modules/@types`, outside DAX. The locked DAX dependency
tree contains none of those types. The failed gate and trace are retained; no
user-owned directory was removed and no typecheck was suppressed. A clean DAX
validation worktree outside that contaminated parent is used for the next gate
run. Its result must be recorded separately, not described as the first run.

These are Sol's tests, not independent cross-validation. Astra's final review is
still required. Claude Opus 5.5 is planned to join collaboration; no lane has
been assigned and no Claude-authored validation is claimed here. Preserve the
unexplained relay failures and Running-label observation as separate followups.
