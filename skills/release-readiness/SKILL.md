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

1. Verify version surfaces.
2. Check release narrative surfaces.
3. Run readiness and verification commands.
4. Check install and upgrade paths.
5. Review artifacts, manifests, and checksums when present.
6. Return blockers first, then residual risks, then release verdict.

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

## Guardrails

- do not call a release ready if version surfaces disagree
- do not hide partial failures behind “overall looks good”
- treat misleading diagnostics and broken install/upgrade paths as serious issues
