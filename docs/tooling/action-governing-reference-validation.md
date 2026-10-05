# Shared action governing-reference correction

Sole-owner bounded correction based on graph boundary
`cfbecb04577c0e0f21468edf502b28ab04fe8df0`. No merge or release.

## Reproduction and fix

The shared action resolver established absence of grant review but did not
validate an explicitly named governing contract before entering legacy shadow
recording. A later contract-read error was isolated together with journal append
errors, so the actual template-reference path still read a file. Three controls
reproduced this on the base: a missing governing contract, a malformed stored
reference and a stored session claiming a different owner.

The resolver now validates the complete session identity and storage project.
After proving absence of review, it validates any explicit governing contract
before entering compatibility. Errors deny with `authority_unreadable` before
filesystem effects. Reviewed runs still use the existing publication/image/grant
checks and durable enforcement. Unreadable authority cannot become no-contract.

A valid explicitly governed v1 session still tolerates a failed record-only
journal append; the strengthened regression proves that behavior. This change
adds no grant, does not activate unsupported executors and introduces no event
vocabulary. Direct run-scoped and unscoped compatibility entry points still need
the final coverage audit; no universal mediation or gap closure is claimed.

## Validation

Pinned Bun 1.4.0; repo-root preload, isolated DAX/XDG directories, disabled
model fetch/config installation and CI's 4 GiB Node heap setting.
The integrated focused action/path/ask/compiled suite passed **31 tests and
165 assertions**. Final-source action controls (including explicit v1 binding):
**13 passed, 0 failed, 72 assertions**.
Final full release gates: **2,377 passed, 2 skipped, 0 failed**; workspace
checks, lint, smoke, Rust, repository integrity and release checks passed.
Lockfile/manifests remain unchanged. Exact-correction three-platform CI is
required before integration. This is solo validation, not independent review.

## Retained evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `action-governing-reference-red.log.gz` | `8a5a043a97a9cbe157f6ab2c15da3f08827bbd94cc95190223e07786b3024229` |
| `action-governing-reference-integration-focused.log.gz` | `9c87da56d63a7e9d95cca7b57e121855a5def8ab01bf41a6b7247f27e0840a54` |
| `action-governing-reference-final-focused.log.gz` | `14ff43d656374e2d695b3f98cf708a51585cabc0027311df39004e30d28363b6` |
| `action-governing-reference-gates.log.gz` | `b47b183cebeb4070f7abab1c027b63945f4dd8f175e46de6d089e72d9ee0f629` |
