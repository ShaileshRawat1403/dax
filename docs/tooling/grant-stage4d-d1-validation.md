# Grant Stage 4d D1 candidate validation

Recorded 2026-10-04. Implementer: Codex (Sol). Reviewer: Astra.
Branch: `feat/conformance-closeout`, exclusive managed worktree
`/Users/ananyalayek/.codex/worktrees/conformance-closeout/dax`.
Source base: `0925ab3cc3d34b68875c415d696761ed00caaaeb`; original inherited
base: `18226c22dab1bb6d07d3a867a8ce8f2bd8334a3d`.
This is bounded D1 implementer evidence, pending exact-SHA reviewer acceptance.
No gap closure, operator exposure, user-profile activation or release is claimed.

## Review authorization and inherited foundation

Astra approved the [architecture](../roadmap/GRANT_STAGE4D_PROPOSAL.md) at exact
`0925ab3cc3d34b68875c415d696761ed00caaaeb`, authorizing D1 alone before D2.
The inspected inherited stack `d2ef0b0..3c47d1a`, in final candidate context
`32b2f34fc9dc3d78d20b4a9a29606f6e1a726309`, received bounded C1 dependency
acceptance: 185 regressions, 752 assertions, and two independent journal controls.
The separately retained 38 final-context controls are additional reviewer evidence.
Their original logs and hashes are in
`artifacts/validation/conformance-closeout/reviewer-evidence.json`.
This does not accept project-journal production integration or the entire gap ledger.

## Delivered boundary

`capability/reviewed-authority.ts` is a read-only common loader. Guardian reads,
all four session entry points and existing native/direct-action dispatch share it.
It requires a genuine compiled enforcing image, a readable canonical authority
marker and envelope recipe, completed publication, exact ordered activation/publication
binding equality, intact reviewed proposal/artifact commitments and current exact
native implementation bindings. Loader/storage failures produce typed refusal,
never a record-only or no-contract downgrade. Reads do not roll forward publication,
repair storage, acquire event locks or activate authority.

Ordinary writes still accept only v1 and use strict review presence ahead of and
under the event lock. Returned governing contracts have an explicit v1/v2 union;
this does not widen ordinary writers, workflow resume or approval capabilities.
The ordinary writer retains its immutability error on unreadable legacy authority.
Legacy workflow resume explicitly requires v1; its incomplete mocked contract now
states the schema version rather than pretending a partial object is a full contract.

Review presence first checks the private record, then uses the existing shared
Journal strict read and reducer. This presence-only read proves review history
without consulting the separate authority marker. A readable non-review journal
preserves v1 shadow-action failure isolation when the marker is unreadable. A
reviewed journal still blocks a deleted private record, including when a valid old
v1 artifact remains and the marker cannot be read. Unreadable/corrupt journals or
nonempty logs without canonical birth cannot prove review absence. Execution
continues to require the marker and complete canonical recipe.

A second compiled enforcing image can use unchanged external-only grants because
it inherits no native binding. When native bindings are present, an image change
refuses execution. Source and unknown images refuse even external-only reviewed
runs. Terminal proven contracts remain readable in a valid image, while prompt,
loop, command, shell and direct dispatch cannot cause terminal-run effects.

## Genuine compiled producer

`src/conformance/grant-stage4d.test.ts` compiles the actual production modules in
`test/fixtures/grant-stage4d-producer.ts` into two different enforcing images and
one image with unknown build identity, then also runs the producer from source.
The local HTTP model produces a real native read tool call and final model text;
no authority, image, dispatch, guard or provider spies are installed. The fixture
uses private app/XDG homes, a private repository, local ephemeral HTTP ports and
no provider credentials. Fixture build identity labels distinguish test images;
the test does not claim to attest a released binary or remote service implementation.

The first image covers all review states, incomplete publication, malformed and
reordered native/remote activation manifests, mismatched revision/selector,
corrupt/missing artifacts and private review, invalid JSON, malformed authority,
old v1 artifact downgrade attempts, unreadable marker and corrupt journal. Each
barrier control invokes guardian, dispatch, prompt, loop, command, shell and direct
action, checking zero model/message/shell effects and an unchanged raw journal.

The real native model turn persists the read output, completed invocation and
enforced capability resolution, with reducer replay from persisted events. Session activity
becomes idle while the canonical run remains running under explicit completion
policy. An external-only reviewed root also performs a real model turn. The second
compiled image refuses native-bound authority but permits unchanged external-only
authority. Source and unknown images perform zero provider calls and deny direct
actions. Parent tests assert subprocess status and the entire expected control list;
a partial or prematurely successful fixture result cannot pass.

This D1 external-only control proves root execution under that authority; it does
not execute MCP tool/resource/prompt producers. Those genuine HTTP MCP producers,
ask approve/deny/timeout/always with changed bindings, TaskTool unknown-agent and
child dispatch/resume controls remain mandatory in D3. Source Stage 4b/c helpers
now install an explicitly labelled narrow decision fixture after publication and
activation; they do not count as compiled producer evidence or invent native grants.

## Validation and retained attempts

Pinned Bun 1.4.0 revision `1.4.0+34cbb9a40`, binary SHA-256
`539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`.
Own-checkout frozen installation succeeded with unchanged lockfile SHA-256
`831bad444f35a22dd8469507f15aac499809502eed5b09781d0c86ba35e642de`.
No global runtime or frozen checkout was modified.

Focused Stage 4b/c decision regressions: 48 pass, 0 fail, 346 assertions, five files.
Targeted compiled/legacy compatibility controls: 61 pass, 0 fail, 277 assertions,
five files, preserving the three inherited legacy failure-isolation assertions.
Full `bun run release:gates` passed: 2,310 root tests, zero failures, two existing
skips, 8,644 assertions across 283 files; five smoke evals and 79 Rust tests passed.
Repository integrity, legacy guard, typechecks for five workspaces, both lint
scopes, Rust format/clippy and release-check passed. Exact-SHA three-platform CI
remains pending at this commit and is reported separately in the final handoff.
The full evidence receipt is `artifacts/validation/conformance-closeout/d1-evidence.json`. The tracked compressed raw-log bundle
retains failed and successful attempts with per-log hashes in that receipt.

Initial fixture failures used an incorrect approval decision name and journal
storage key. The instrumented producer later completed its assertions and result
publication but remained alive after disposal; the exact open handle was not
established. The one-shot fixture now exits only after all awaited assertions,
result publication and disposal succeed, with parent-side exit/status checks and
bounded diagnostics. No production provider or lifecycle change was made for it.
Initial full gates exposed denial-reason typing, nullable replay typing, an
incomplete v1 fixture, and legacy marker failure isolation; their logs are retained.
The journal presence refinement was approved explicitly by Astra before applying it.

## Remaining boundaries

D2 opt-in/start/revision exposure waits for D1 exact-SHA acceptance. D4 activity
presentation is a separate bounded UI change; completion authority is unchanged.
Unsupported plugin/local MCP/worker/verification/source binding forms remain
unsupported. C2 vocabulary/mediation and C3/C4 project fact/memory production work
remain pending architecture and implementation; no gap definitions were narrowed.
The existing exported `RunFactory.hasContract` recursion has no runtime caller and
is tracked for bounded D2 wiring before any new route relies on it.
