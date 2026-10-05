# Agent import test lifecycle correction

Sole-owner correction based on settings candidate
`104c933570a53c420f49847bb71bf72a45007acf`. No main integration, release,
independent review or additional gap closure.

## Observed failure and scoped correction

[Settings CI 37312751513](https://github.com/ShaileshRawat1403/dax/actions/runs/37312751513)
passed Ubuntu and macOS, but Windows failed only the unchanged
`Agent namespace exports required functions` test. It started a cold dynamic
import inside a test callback and hit Bun's five-second deadline (5,001 ms).
The next Agent suite then waited for module loading. The log has no dependency
phase timings; the underlying reason for the Windows import slowdown is not
established. The settings controls passed on Windows.

The original four export assertions are unchanged. Agent is statically imported,
as in the other Agent suites, so loading errors fail discovery and no timed
callback abandons a still-running import. A separate owned subprocess probes the
real cold production module: a 30-second import deadline, a 40-second test budget,
awaited process-tree termination and exit, captured output, and strict owned
profile cleanup. This does not raise global deadlines or skip tests.
The child rejects/counts global fetch calls and Bun process launches during import.
This instrumentation covers those entry points; it is not proof about arbitrary
third-party native I/O. Production Agent behavior is unchanged.

## Validation

Focused Agent/posture tests under coverage: **3 passed, 0 failed, 22 assertions**.
Actual local cold import: **553 ms**, zero fetch calls, zero Bun process launches.
The full-gate probe recorded **708 ms**. Final Bun 1.4.0 release gates:
**2,366 passed, 2 skipped, 0 failed, 9,059 assertions**; workspace typechecks,
lint, 5/5 smoke evaluations, Rust formatting/clippy/tests, integrity and release
checks passed. Gates used isolated DAX/XDG homes, disabled model-catalog fetch
and configuration auto-install, the explicit pinned runtime, and CI's 4 GiB
Node heap setting. Manifests/lockfile and installed DAX remain unchanged.
Exact-correction Ubuntu/macOS/Windows CI remains required before integration.

## Retained evidence

Files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `agent-import-hosted-failure.log.gz` | `ed67dd00faef2b31bc68443505eb24103c9e83f7330f20bc0b687dc722de7096` |
| `agent-import-corrected-focused.log.gz` | `2fbff03dedc8f7dafb31a7c72a24e36c9a1f83d29933afc4bb9f97341667babd` |
| `agent-import-corrected-gates.log.gz` | `1e25558913cf9d84c22ce2bb02a6e1559135a970fdbd6abdeb2f469fa9dc3e6d` |
