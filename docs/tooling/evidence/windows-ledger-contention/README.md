# Windows ledger diagnostic evidence

SHA-256 of decompressed observed-windows-failure.gz: `9fc0a83562c6cc8dae577b89938e9c0038769a28f22ace9de5a07e493c2a8d84`.

Final docs-main run37720257864 reported append Io(rawOS5), but the operation/handle was not identified.

SHA-256 of decompressed modern-unlink-fixture-failure.gz: `67fe56f6757f386a62570d35179b59a412275171324b375c17d14319c3ee2e63`.

Run37722002592 passed original concurrency but both new controls failed: std removal left the name immediately reusable. The controls now use classic DeleteFileW explicitly; no observed-CI root-cause claim is made.

SHA-256 of decompressed classic-delete-fixture-failure.gz: `9dbdc7aff3bee123b2544ceee5e56f131eda48557612b1b11d5ce3aee41bbef9`.

Run 37723059558 also passed original concurrency but classic DeleteFileW left the name immediately reusable on this runner. That fixture assumption is withdrawn. Windows controls now use an existing directory at the lock name to exercise a real atomic-create AccessDenied 5, external release and persistent denial without timing or OS deletion assumptions. This demonstrates bounded error handling, not the original intermittent failure's cause. Production retries remain restricted to lock acquisition.

## Validated follow-up

Source **7d8460afd46f7c0bef2cb3a7c6a6636c0d064e4c** passed
[CI 37723862499](https://github.com/ShaileshRawat1403/dax/actions/runs/37723862499)
on all three platforms. `ci-7d8460a.json` preserves the exact source, jobs and steps.
The Windows log confirms both real access-denied controls and the original
concurrent append test passed. The transient fixture releases its own obstruction
only in the actual contention callback; the persistent fixture preserves the
original error and directory. Production code never removes either obstruction.

SHA-256 of decompressed `exact-source-windows-success.gz`:
`1687b8e27cc67987ebb21148163a9d4816dbdd43d908959979ca831bc9c61e1b`.

[Local full-gate and Rust evidence](LOCAL_VALIDATION.md) records runtime provenance
and decompressed hashes. Bounded separate-agent review accepted 7d8460a without
findings. That acceptance and these controls cover error handling; they do not
establish the original CI operation/handle or guarantee future defect freedom.
The hardening remains Unreleased, outside the public immutable v2.0.0 tag.
