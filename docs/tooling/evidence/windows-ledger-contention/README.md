# Windows ledger diagnostic evidence

SHA-256 of decompressed observed-windows-failure.gz: `9fc0a83562c6cc8dae577b89938e9c0038769a28f22ace9de5a07e493c2a8d84`.

Final docs-main run37720257864 reported append Io(rawOS5), but the operation/handle was not identified.

SHA-256 of decompressed modern-unlink-fixture-failure.gz: `67fe56f6757f386a62570d35179b59a412275171324b375c17d14319c3ee2e63`.

Run37722002592 passed original concurrency but both new controls failed: std removal left the name immediately reusable. The controls now use classic DeleteFileW explicitly; no observed-CI root-cause claim is made.
