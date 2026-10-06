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
Fresh frozen install, integrated gates and exact-commit three-platform CI are
required before acceptance. Retained linked dependency installations must not
be mutated; validation will use a new isolated checkout.

## Evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `dependency-audit-hosted-red.log.gz` | `373d4c2980a34942239e7d7768f4e9216b4533bcdb35990dc8a94d481305a80d` |
| `dependency-audit-patched.log.gz` | `cd21c6d33f43c5a20900cdf94592a3fa1e61176e9ccb3da8e4183cd0608f53b2` |
| `dependency-lock-resolution.log.gz` | `ee5285682ea9d0e352385b370796d664635009ab81b1b415cec9a70ea933b632` |
