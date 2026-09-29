# Opt-in custom-tool identity — candidate validation

Owner: Sol. Tier 2 reviewer: Astra. Recorded 2026-09-29. Branch:
`feat/owned-custom-capability-identity`, based on the unmerged template-context
identity candidate `1348e7d28b35fc9153e91604eca20eaacb2403c4`.
This is candidate evidence, not review acceptance or integration. The exact pushed
SHA and platform CI are supplied in the handoff.

## Boundary

`ToolRegistry.registerEnrolled` accepts a static definition and an explicit
caller-declared source tuple. Its opaque, versioned descriptor binds the captured
definition, source, executor and typed schemas in the instance catalog. It is
descriptive identity, **not** origin attestation, a grant, a sandbox, or a new
permission. The existing `register(tool)` path stays compatible and unenrolled.
Native IDs are never inferred from aliases; loader/custom collisions reject the
offered table. A changed binding is checked before hooks and again before the
captured tool effect after awaited hooks/approval. This branch does not add
contract grants, shared grant resolution, events, migration or a no-contract
policy change. Eight aggregate gaps remain open; v1.5.0 remains published.

## Reproduction and gates

- Focused production test: `bun test packages/dax/src/capability/native-dispatch.test.ts`
  under Bun 1.4.0: **22 passed, 0 failed**. Only the provider response is
  controlled for direct SessionPrompt dispatch. Batch uses its real executor.
- New controls cover direct/batch execution, preserved legacy enrollment,
  same-name native separation, duplicate source/alias and loader collisions,
  malformed source/schema, denial with zero effects, pre-hook rejection,
  post-hook effect-boundary rejection, and unrelated-source health.
- Full `bun run release:gates`, with fresh DAX/XDG homes and the 4 GiB Node heap:
  **2,036 Bun tests passed, 2 skipped, 0 failed**, then smoke evaluations,
  Rust checks and release checks passed. Pinned binary:
  `/Users/Shailesh/MYAIAGENTS/dax/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64/bun`.
  The tracked lockfile and manifests were not changed.
- Retained local logs:
  `/Users/Shailesh/MYAIAGENTS/dax/artifacts/validation/custom-capability-20260929/`.
  `release-gates.log` stopped at sandbox-denied Turbo cache writes; the
  escalated run `release-gates-escalated.log` caught one test-only lint cast;
  `release-gates-final.log` is the passing final-source run. Neither failed
  attempt is presented as a code-gate pass.

## Limitations

The source tuple is supplied by the registering caller, not independently
verified. IDs are commitments, not encryption or historical proof. Only tools
using this opt-in API receive a custom descriptor; legacy custom tools stay
unenrolled. No execution permission derives from descriptor presence. Platform
CI and independent Tier 2 review are pending at the time of this record.
