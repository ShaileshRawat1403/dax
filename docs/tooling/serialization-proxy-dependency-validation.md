# Serialization and proxy dependency audit correction

Base: recovery fixture correction `8577123`. Sole-owner validation. No merge,
release, installed binary change or accepted gap closure.

## Hosted audit failure

[Delegation CI 37398675580](https://github.com/ShaileshRawat1403/dax/actions/runs/37398675580)
stopped on Ubuntu's dependency audit before tests; other platforms were cancelled.
The lock contained proxy-addr 2.0.7 and Seroval 1.5.4. This is an audit finding,
not proof that a DAX endpoint is exploitable.

Primary published advisories:

- [GHSA-jqcg-44mw-7w3h](https://github.com/advisories/GHSA-jqcg-44mw-7w3h): proxy-addr fix 2.0.8.
- [GHSA-p6vx-979v-rg4c](https://github.com/advisories/GHSA-p6vx-979v-rg4c): Seroval fix 1.6.2.
- [GHSA-jp82-f5mq-hwhp](https://github.com/advisories/GHSA-jp82-f5mq-hwhp): Seroval fix 1.6.3.

## Bounded correction

Root overrides require proxy-addr >=2.0.8 within v2 and Seroval >=1.6.3 within v1.
Bun 1.4.0 resolves proxy-addr 2.0.8 and Seroval 1.6.8. Only these two package
resolutions and their override entries change; package manifests outside the root
are untouched. No audit suppression, weakened threshold or unrelated upgrade.

Lockfile audit passes at the existing high threshold: no vulnerabilities at or
above high; 21 below the threshold remain. This does not assert zero advisories.
Fresh frozen installation of runtime source `4d160ef` passed in a newly created
isolated managed worktree, without linked/shared node_modules. Tracked files,
including the lock and manifests, stayed unchanged. Its fresh high-threshold
audit passed. Full Bun 1.4.0 release gates passed **2,377 tests, 2 skipped,
0 failed**, including workspace checks, lint, smoke, Rust and release checks.
Exact-commit three-platform CI is still required before integration.

Automatic approval review refused replacing preserved symlinks in the earlier
owned checkout. No links or target installations were removed. The fresh
checkout is the safer independent install path; this is still solo validation,
not independent cross-validation.

## Evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `dependency-audit-hosted-red.log.gz` | `373d4c2980a34942239e7d7768f4e9216b4533bcdb35990dc8a94d481305a80d` |
| `dependency-audit-patched.log.gz` | `cd21c6d33f43c5a20900cdf94592a3fa1e61176e9ccb3da8e4183cd0608f53b2` |
| `dependency-lock-resolution.log.gz` | `ee5285682ea9d0e352385b370796d664635009ab81b1b415cec9a70ea933b632` |

| `dependency-frozen-install.log.gz` | `6a5ade91cdd26d226710244599a822a6ab7e13d10bde9ed532a4c21d4342c095` |
| `dependency-fresh-audit.log.gz` | `cd4eb2ce856872e16982e87f63a3c87abaffd54bd77c9796c53d5f2f4e8b138d` |
| `dependency-fresh-gates.log.gz` | `59bc399673cea2c6edf0b50b2618fecb9a186f18cad722478bdd18ab473e70c0` |
