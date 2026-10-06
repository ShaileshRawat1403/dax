# Recovery fixture ownership and strict teardown

Base: `d53feb58af338aefcf607f92a64ed9eaebef32ba`. Test-only correction;
no runtime behavior, gap closure, merge or release changes.

## Observed failure

[CI 37320982923](https://github.com/ShaileshRawat1403/dax/actions/runs/37320982923)
passed Ubuntu/macOS but failed Windows. All named recovery tests finished, then
an unnamed hook exceeded five seconds. The file's final hook synchronously
removed its persisted fixture. This establishes a hook budget failure after
assertions; it does not identify an OS handle, establish a filesystem cause or
prove every earlier Windows failure has the same cause.

## Correction

Recovery storage tests now own a temporary project and use only the necessary
Instance/storage context, instead of bootstrapping unrelated CLI service scans,
watchers, formatters and startup notices against the source repository. Each
instance is still disposed and awaited. The pagination test still persists all
120 full lifecycles and finds the buried run.

Final teardown awaits strict asynchronous recursive removal, asserts the home
is absent and logs its start/end duration. It has a bounded thirty-second hook
budget appropriate to the large persisted fixture; no retries, ignored deletion
errors or skipped assertions. The environment is restored in finally.

## Validation

Bun 1.4.0 focused controls: **8 passed, 0 failed, 13 assertions**; final cleanup
35 ms locally. Full release gates: **2,377 passed, 2 skipped, 0 failed**, including
workspace checks, lint, smoke, Rust and release checks; cleanup 40 ms locally.
Manifest/lockfile unchanged by this slice. Exact-candidate Windows CI is still
required. Solo validation is not independent cross-validation.

The preceding delegation commit's hosted run stopped at newly reported high/
critical dependency advisories before executing tests. A separate dependency
correction is required; the audit is not disabled or relaxed.

## Evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `recovery-teardown-windows-failure.log.gz` | `83d9c183d9fa35b4d2d1dc6b24755546078841829e3b78b47efcfbc96e9072aa` |
| `recovery-owned-fixture-focused.log.gz` | `233c91222a95d73de21ca8274db96adb0ae919cc925a9deadf75f72e5dbe8974` |
| `recovery-owned-fixture-gates.log.gz` | `387e7660c610aac5a3a80961971404700e9ac5f87244144ee6cac62038978b74` |
