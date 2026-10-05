# Project settings legacy compatibility correction

Sole-owner bounded correction based on Agent lifecycle correction
`fe93f5868a9a467e00ae153d88c0b90af2e01407`. No main integration or release.

## Reproduced defect and correction

The new snapshot schema limits preference values to 16,384 characters. The
legacy API has always accepted larger strings. Applying the new schema while
reading old SQL data made an unrelated `/pm rules add` fail, and prevented the
operator from obtaining a complete legacy digest for an explicit replacement.
The production command regression failed before the correction with Zod
`too_big`, then passed without changing its expectations.

Legacy inspection now commits the entire original population without truncating,
normalizing or applying replacement limits. Only the explicitly reviewed new
snapshot must pass the closed replacement schema. Adoption still checks the
complete legacy digest under the project lock; no stored row is silently promoted
or removed. Command routing uses journal authority mode only, avoiding unnecessary
full SQL inspection and preserving malformed-journal refusal.

The real control stores a 17,000-character legacy value, successfully uses the
existing rule command, inspects the exact unchanged old value, approves an
explicitly different valid snapshot, then proves the original SQL remains intact
while the effective journal preferences exclude it. Existing approval, stale,
concurrency, restart, denial and malformed-authority controls remain green.

## Validation

Focused project/scope/journal tests: **26 passed, 0 failed, 184 assertions**.
Full Bun 1.4.0 release gates: **2,367 passed, 2 skipped, 0 failed, 9,066 assertions**;
all workspace, smoke, Rust, integrity and release checks passed under isolated
DAX/XDG homes and CI's 4 GiB Node setting. Lockfile and manifests are unchanged.
Exact-correction three-platform CI is required before integration.
The preceding Agent lifecycle correction passed Ubuntu/macOS/Windows on its
first correction run:
https://github.com/ShaileshRawat1403/dax/actions/runs/37314994417.
This does not establish why the earlier Windows cold import was slow.

## Retained evidence

Files are in `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `project-settings-compatibility-red.log.gz` | `26761d9c436ab7b258f5fba1e9c7409803e0c0fb13deb66c3e0d177ed24eb288` |
| `project-settings-compatibility-focused.log.gz` | `bb3db887770820026c6d645cad08f965f0b456aec995e1174d437ed76012d35d` |
| `project-settings-compatibility-gates.log.gz` | `aa236637b495b046209734bd2accc6561c659f50f3aee424729ce0240c40b149` |
