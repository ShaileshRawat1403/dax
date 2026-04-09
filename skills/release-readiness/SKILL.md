---
name: "release-readiness"
description: "Check whether a DAX release is coherent, verifiable, and safe to ship across package, docs, diagnostics, and release artifacts."
---

# Release Readiness

Use this skill when the task is to decide whether the current repo state is ready to ship.

## Use when

- the user asks for a release audit
- a version bump, changelog, or release note is in flight
- install, doctor, docs, and packaging need to agree
- CI passed and the question is whether the release is actually clean

## Workflow

1. Resolve the repo root and inspect root release surfaces directly.
2. Verify version surfaces.
3. Check release narrative surfaces.
4. Run readiness and verification commands.
5. Check install and upgrade paths.
6. Review artifacts, manifests, and checksums when present.
7. Return blockers first, then residual risks, then release verdict.

## First actions for DAX

If the run starts inside `packages/dax`, do this exact first pass before using package-local globs:

1. Read `../../CHANGELOG.md`
2. Read `../../RELEASE_GATES.md`
3. Read `../../README.md`
4. Read `../../docs/product/release-readiness.md`
5. Read `../../docs/STACK_OPERATING_MODEL.md`
6. Read `package.json`

These are mandatory first actions for this skill in DAX.
Do not start with `glob` against `.` for release files when the run starts in `packages/dax`.
Do not report root release files as missing until these exact reads have been attempted.
Only after that should you glob, grep, or use shell for additional supporting evidence.

## Workspace scope

- For DAX, release truth lives at the repository root, not only in the active package directory.
- If the current working directory is nested (for example `packages/dax`), explicitly resolve the repo root before concluding that release files are missing.
- Prefer direct reads of known repo-root files over package-local globs.
- For this repo, if you are inside `packages/dax`, inspect these paths directly before reporting them missing:
  - `../../CHANGELOG.md`
  - `../../RELEASE_GATES.md`
  - `../../README.md`
  - `../../docs/product/release-readiness.md`
  - `../../docs/STACK_OPERATING_MODEL.md`
- Treat these repo-root files as first-class evidence when they exist:
  - `CHANGELOG.md`
  - `RELEASE_GATES.md`
  - `README.md`
  - `docs/product/release-readiness.md`
  - `docs/STACK_OPERATING_MODEL.md`
- If package-local and repo-root narratives disagree, treat that as a release-risk signal instead of silently favoring the local package view.
- Do not report repo-root release files as missing based only on package-local `glob` results.
- Do not end the visible answer with invented step or budget ceilings. If time or tool budget is tight, say which evidence is still missing and what to check next.

## Required evidence

- package version
- changelog and checked-in release notes
- installer examples and release scripts
- `dax doctor`
- `bun run release:verify` or equivalent project verification

## Output contract

Return:

1. `Release blockers`
2. `Degraded but shippable items`
3. `Version and docs alignment`
4. `Verification status`
5. `Release verdict`

Preferred visible rhythm:

- one short framing sentence
- compact evidence bullets
- blockers or risks first
- a verdict or next pass

## Guardrails

- do not call a release ready if version surfaces disagree
- do not hide partial failures behind “overall looks good”
- treat misleading diagnostics and broken install/upgrade paths as serious issues
