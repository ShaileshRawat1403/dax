# Windows ledger diagnostic evidence

SHA-256 of decompressed observed-windows-failure.gz: `9fc0a83562c6cc8dae577b89938e9c0038769a28f22ace9de5a07e493c2a8d84`.

Final docs-main run37720257864 reported append Io(rawOS5), but the operation/handle was not identified.

SHA-256 of decompressed modern-unlink-fixture-failure.gz: `67fe56f6757f386a62570d35179b59a412275171324b375c17d14319c3ee2e63`.

Run37722002592 passed original concurrency but both new controls failed: std removal left the name immediately reusable. The controls now use classic DeleteFileW explicitly; no observed-CI root-cause claim is made.

SHA-256 of decompressed classic-delete-fixture-failure.gz: `9dbdc7aff3bee123b2544ceee5e56f131eda48557612b1b11d5ce3aee41bbef9`.

Run 37723059558 also passed original concurrency but classic DeleteFileW left the name immediately reusable on this runner. That fixture assumption is withdrawn. Windows controls now use an existing directory at the lock name to exercise a real atomic-create AccessDenied 5, external release and persistent denial without timing or OS deletion assumptions. This demonstrates bounded error handling, not the original intermittent failure's cause. Production retries remain restricted to lock acquisition.
