# Published DAX 2.0.1 and local upgrade

[Stable 2.0.1](https://github.com/ShaileshRawat1403/dax/releases/tag/v2.0.1)
was published 2026-10-08 from **fe911e57415dcfa9d101bd2584b28d2ea3c84694**.
[Post-integration main CI](https://github.com/ShaileshRawat1403/dax/actions/runs/37791234696)
passed all three platforms at documentation receipt 193ff49.
[Tagged gates, build and publication](https://github.com/ShaileshRawat1403/dax/actions/runs/37793057627)
passed at exact source fe911e5. Fourteen published assets comprise eleven archives,
manifest, checksums and installer. Every downloaded archive hash matches both
published manifest/checksums and GitHub asset digest; main members were verified.
`publication.json`, `manifest.json` and `SHA256SUMS` retain those results.

The real public installer completed in a disposable directory and reported 2.0.1.
Packaged diagnostics in an isolated profile blocked retired OAuth, accepted an
API-key override and preserved the credential bytes. `local-installation.json`
records atomic PATH binary replacement, the removed old2.0.0 hash, the new hash
and fresh interactive zsh resolution. Configuration and sessions were preserved;
no provider inference calls or official-CLI login changes were made.

`space-cleanup.json` records DAX-only removals and observed free-space growth of
about 14.8 GiB to 30.15 GiB. Only regenerable inactive Rust targets, inspected old
release/dist staging and owned scratch/cache copies were removed. Metadata was
preserved under ignored `artifacts/release-2.0.1-cleanup`. Frozen source/refs and
Node dependencies, dirty/unmerged work, primary/current dependencies, shared
caches, Verb and all running processes were excluded. Disk availability can vary
with other activity. Final merged-unused branch cleanup follows final CI.

Existing 2.0.0 and earlier release assets remain unchanged. Intermittent Windows
AccessDenied/compiled-probe EBUSY causes remain unidentified. No error-free or AGY
latency-improvement claim is made. Earlier preparation records are historical.

SHA-256 values cover **decompressed** log bytes.

| Log | SHA-256 |
| --- | --- |
| `installer.gz` | `06d37852f7dec1fe60fc2a7f50c2a9a6bf21651b972c949e14a54b5c93549604` |
| `installed-version.gz` | `fe840f52fb5578d3f77eb497115eb02c6036601c3a53e60df7995c7276baa77a` |
