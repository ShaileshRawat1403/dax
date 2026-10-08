# Published 2.0.0 evidence

All eleven downloaded archive hashes match the published manifest and SHA256SUMS.
Source/tag: `87029cbd57dd16c330f677b8cc699c3404ecd45f`.
SHA-256 below covers decompressed bytes.

| File | SHA-256 |
| --- | --- |
| `actual-installer.gz` | `397ae227e731f499decba7d9734e196f5173b3f4e88ca2e868b7425c0117af59` |
| `installed-version.gz` | `c28fcca53637bc88e124af1725df13cb98c69dedefd62fb3cdbe1cdb6b760624` |

## Subsequent local upgrade — 2026-10-08

[local-installation.json](local-installation.json) records the maintainer-authorized
atomic replacement of the PATH-resolved 1.5.0 binary with the verified public
2.0.0 binary, fresh interactive zsh resolution and hashes. The temporary old-binary
rollback link was removed only after verification. Earlier publication receipts
record the earlier unchanged installation, not the state after this upgrade.
The later Unreleased Windows lock hardening is absent from this installed binary.
