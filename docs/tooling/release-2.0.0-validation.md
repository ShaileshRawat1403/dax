# DAX 2.0.0 preparation and validation

Latest corrected source: **4d03493e94e7a8f6f78383bc44c9e610a861035e**.
[Final correction, gates and rebuilt artifacts](release-2.0.0-final-checkpoint.md)
supersede the earlier prepared-source sections below. Main integration and
publication remain pending.

Prepared release branch: `release/2.0.0-candidate`, based on
`2463ef55ac7a9ed0712c1460c3c0a78af752317c`. Version 2.0.0 is a candidate;
no tag publication, installed-binary replacement or main integration is claimed.

## Reviews and corrections

The maintainer-relayed independent report reproduced the exact base candidate's
full 2,383-test gates and all platform results, but did not independently review
the post-October-4 changes. Fresh separate-agent pinned-source reviews inspected
approval/memory/settings, graph, OAuth and dependency boundaries. They are not
separate-model-family SOP validation or a formal security audit.

Findings reproduced and corrected:

- Generic run approval could decide a protected project fact/settings gate without
  its dedicated digest confirmation. Gateway now refuses both approve and deny
  before journal changes; the proper exact-digest review still succeeds afterward.
- HTTP operator names alone were not access control. HTTP mutations, reviewed
  revisions/start/decisions, permission replies and terminal WebSocket control use
  the configured operator credential boundary. Mutation guard verifies credentials
  itself, including when mounted directly. Private in-process TUI remains trusted.
  Actor labels do not become cryptographic or verified human identity.
- MCP add/debug omitted the newly required issuer. Wizard records a validated
  operator-supplied issuer; debug forwards it. Historical issuerless or wrong-server
  credentials are displayed as unauthenticated without deleting their files.

The API serves and exports the same authentication contract. SDK changes are
bounded to typed issuer/authentication errors and metadata; existing generated
client runtime is preserved. Full generation's unrelated transport/toolchain
changes are excluded and retained as diagnostic evidence.

## Checks so far

Gateway regression failed on the base and passes with the correction. Restoring
base OAuth CLI/status code fails all three added controls; restoring base HTTP
access code fails the two new access controls. Corrective production selection:
23 passed, 0 failed, 156 assertions. The first full candidate run recorded 2,387
passed, 2 skipped, 4 failed: old relay/contract fixtures expected unauthenticated
writes to reach validators. Fixtures now supply real operator credentials and
preserve no-relay checks for both authenticated and unauthenticated traffic.
Those four focused checks pass (51 assertions); failed evidence is retained.

Full final gates, correction revalidation, exact-SHA Ubuntu/macOS/Windows CI,
canonical packaging inventory/checksums and isolated installer acceptance remain
required. Release-mode validation will use a matching local tag in an isolated
validation clone; no public v2.0.0 tag is created by that check. Runtime execution
against a live provider/IdP is not claimed by controlled fixture acceptance.

Evidence will be retained under `evidence/release-2.0.0/` before final handover.
[Scope and migration notes](../product/release-2.0.0.md) remain part of acceptance.

## Runtime corrective checkpoint

Repeated schema export exposed a concrete shared-metadata defect in hono-openapi
1.1.2: it replaced route-owned response resolvers with bare references, so later
exports lost their component definitions. A narrow reproducible patch clones the
response/content maps before conversion in both ESM and CommonJS. The repeat
regression fails on the base dependency and passes after patching; assertions are
preserved. The first post-authentication full run's one remaining schema failure
is retained. No dependency versions floated; lock changes are version 2.0.0 and
the patch registration only.

Final full gates: **2,392 passed, 2 skipped, 0 failed**, workspace typecheck/lint,
5/5 smoke evaluations, Rust fmt/clippy/tests and release checks all pass. The
initial fixture type errors and repair are retained. [Raw evidence/checksums](evidence/release-2.0.0/README.md)
include both unsuccessful full runs, negatives and final gates. SDK transport
runtime remains unchanged; documented project endpoints and authentication/error
metadata are additive. The general provider OAuth type is not given the MCP-only
issuer field.

Separate agents must now revalidate the exact corrective commit. All-platform CI,
packaged assets, actual disposable installer and isolated tagged release-mode
validation still precede publication; no stable tag or user install changed.

## Earlier prepared release source — superseded

**Release source: `c06412458a12d8208457f339332f2f8195766e9c`.** This later
receipt branch changes documentation/evidence only; it is not the artifact source.
That checkpoint is historical. The operator-environment correction below supersedes
its source and bytes; do not publish c064124 as the final corrected release.

- [Exact-source CI 37636584013](https://github.com/ShaileshRawat1403/dax/actions/runs/37636584013)
  passed Ubuntu, macOS and Windows. Both targeted correction reviews accepted
  the same SHA, with their limited scopes in [the review receipt](evidence/release-2.0.0/targeted-review.json).
- Fresh independent validation clone checked out that source on its own feature
  branch, created a clone-only local v2.0.0 tag, completed a frozen install and
  ran **DAX_RELEASE=1** full gates: **2,392 passed, 2 skipped, 0 failed**, with
  all other gates green and clean/tagged release provenance verified. No tag was
  created or pushed in the primary repository.
- Frozen all-OS/CPU dependency provisioning preserved source manifests/lockfile.
  Canonical packaging built eleven archives; archive hashes matched the manifest and main
  members matched their corresponding build outputs. Build publishing was explicitly disabled.
- Real installer downloaded from an owned local fixture server to a disposable
  destination; installed DAX reports 2.0.0. Its installed Rust core emitted a
  valid proof. Corrupted checksum refusal preserved a prior test binary intact.
  This does not claim a published GitHub-download install or native execution
  of every non-host archive.
- All five Rust sidecars are present in the macOS ARM64 host package. Non-host
  archives retain the existing host-only sidecar limitation; Rust-dependent
  commands there require the documented toolchain/sidecar provisioning. No claim
  of cross-compiled sidecar completeness is made.

[Installer/inventory receipt](evidence/release-2.0.0/installer-receipt.json),
[manifest](evidence/release-2.0.0/manifest.json) and
[checksums](evidence/release-2.0.0/SHA256SUMS) identify the prepared bytes.
Ignored packaged assets are retained at `artifacts/release-2.0.0-c064124/` in this
owned worktree; preserve them before retiring it. The installed operator binary
remains SHA-256 `5671509d2f18e6d8316fee9bd7df34be96dd409ed628e9b6f5541d1b4e159fb0`.

Preparation is complete within these limits. Maintainer integration, post-merge
CI, final publication date and authorized tag/asset publication remain external
release actions. Main and v1.5.0 are unchanged; unmerged/dirty worktrees are not
removed in the name of cleanup. [Publication notes](../product/release-2.0.0.md)
remain the supported-scope and migration boundary.

The [retained tagged provenance](evidence/release-2.0.0/tagged-release-provenance.json)
pins release_mode, source commit and clone-only tag without relying on temporary
folders. The separate-agent evidence review at `48ac609` verified all 26 compressed
log digests, archive/build output consistency, the installer binary hash and exact
all-platform source CI. Its low-severity retention/wording corrections are included
here; no runtime code or release source changed.
