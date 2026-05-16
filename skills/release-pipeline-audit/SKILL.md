---
name: "release-pipeline-audit"
description: "Audit the tag-triggered release pipeline for reproducibility, provenance, signing, supply-chain integrity, and rollback. Returns impact-ordered findings tables."
---

# Release Pipeline Audit

Use this skill when the task is to review the path from a release tag to a published artifact. Scope is narrower than [ci-cd-audit](../ci-cd-audit/SKILL.md) — it only covers the workflow(s) that build, sign, and publish releases.

## Use when

- the user is about to cut a release and wants a pre-flight check on the pipeline
- a release shipped but something went wrong (wrong artifact, missing signature, drifted version)
- the project is adding provenance, attestation, or signing for the first time
- supply-chain compliance (SLSA, SBOM, signed artifacts) is on the roadmap

## Workflow

1. **Identify the release pipeline.** Find the workflow that runs on tag push (`on: push: tags: ['v*']`) or release publish event. If there are multiple, list them and which artifact each owns.
2. **Trace the tag → artifact chain.** Walk from tag-trigger to upload step. Record: source checkout (with what ref), build step, sign step, upload destination, retention.
3. **Reproducibility.**
   - Is the build hermetic (locked dependencies, pinned toolchain, no network beyond the package registry)?
   - Are version strings derived from the tag, or could they drift?
   - Does the same input produce the same output? Flag wall-clock, hostname, or random-seed inputs in artifact names.
4. **Provenance.**
   - Is there a SLSA provenance attestation, SBOM, or build receipt artifact?
   - Is the provenance signed with a key the consumer can verify?
   - For DAX: look for `release-provenance.json`, `proof-pack/`, and `determinism-proof.json` artifacts written by `bun run release:check`.
5. **Signing.**
   - Are release archives signed (cosign, gpg, sigstore)?
   - Is the signing key pulled from secrets correctly (not echoed, not stored on disk after use)?
   - Is the public key or trust root documented in `SECURITY.md` or a comparable file?
6. **Checksums.**
   - Does every uploaded artifact have a published checksum (`SHA256SUMS`, per-file `.sha256`)?
   - Is the checksum file itself signed?
7. **Package-manager publishing.** If the pipeline publishes to npm/cargo/homebrew/winget, check that publishing is gated on signature verification and not on tag presence alone.
8. **Rollback / yank story.** If a bad release ships, can it be yanked? Is there a documented procedure? Are previous releases preserved for downgrade?
9. **Version surface consistency.** The tag, the package manifest (`package.json`, `Cargo.toml`), the `CHANGELOG.md` entry, and any release notes doc must all agree. Flag drift.
10. **Pre-release vs final.** If the pipeline supports prereleases, confirm the gate that distinguishes them (env var, tag suffix) is wired correctly and not bypassable.
11. **Permissions.** The release workflow's `permissions:` block should be minimal — `contents: write` for the release, nothing else unless justified.

## Checks

- Do not flag missing SLSA / SBOM unless the project has declared an intent to ship them
- Respect project-specific provenance schemes (DAX uses its own determinism-proof artifact)
- If publishing is manual (operator runs a command locally), state that explicitly in the verdict — the audit cannot fully cover what happens off-CI
- For DAX specifically, the truth surfaces are: the release tag, the top-of-CHANGELOG entry, and `docs/releases/v<version>.md` — all three must agree

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Release workflow(s)`, `Triggers on`, `Artifacts published`, `Signed?`, `Provenance?`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Reproducibility
   - Provenance and attestation
   - Signing and checksums
   - Version surface consistency
   - Rollback story
   - Workflow permissions
4. **Open questions / assumptions** — manual steps that the workflow does not cover
5. **Residual risk** — anything in the release path that this audit could not verify (e.g., the maintainer's local signing key)
6. **Next actions** — concrete fixes in order

## Evidence to collect

- Workflow file path + the tag-trigger line
- The exact build command(s) that produce the artifact
- The signing step and the key source (env var name, secret name)
- The version-string source (tag, package manifest, or computed)
- Any provenance/SBOM artifact path written by the pipeline
