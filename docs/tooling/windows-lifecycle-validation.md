# Windows conformance lifecycle reliability

Base: `82440ca42f8894a2d252fdbd42c7d7286908ad4a`.
Owner: Codex; solo validation authorized by the maintainer on 2026-10-05.

## Exact failures and corrections

Windows CI [37248672542](https://github.com/ShaileshRawat1403/dax/actions/runs/37248672542)
failed two tests. The producer observed session activity `idle` while the canonical
run was still `running`; the lock fixture timed out before its child readiness
signal at three seconds. These are the exact observations, not proof that all
historical Windows failures share a cause.

- The producer now waits for both canonical completion and idle activity, with
  a bounded 30-second deadline and state/activity/provider diagnostics. Failed or
  cancelled runs fail immediately. The exact completion, supersession, replay,
  and single-dispatch assertions remain intact.
- Child readiness has a separate 30-second startup deadline with early-exit
  detection. The lock-blocking assertion remains 250 milliseconds. Post-release
  exit is bounded at ten seconds, followed by the same exit-code and unchanged
  contract checks. Cleanup still kills and awaits owned children.
- A local macOS test exposed inherited-working-directory denial from the
  `/private/tmp` checkout. The seatbelt test now launches children in the home
  directory allowed by its existing profile. No sandbox permission was widened;
  the unlisted executable must still be refused.

## Evidence

Pinned Bun 1.4.0 focused lifecycle tests: **8 passed, 60 assertions**.
Seatbelt controls: **3 passed, 14 assertions**.
Final local `release:gates`: **2,345 passed, 2 skipped, 0 failed; 8,880 assertions**.
All five smoke evaluations and the Rust checks passed, including workspace typechecks/lint,
integrity/frozen-root guards, the full suite, smoke evaluations, Rust checks and
release check. Exact counts and raw failed/successful logs are retained in the
compressed [evidence directory](evidence/windows-lifecycle/).

Failed attempts are disclosed: initial sandbox-restricted server failures; retained
logs cover the host-enabled full run's single seatbelt cwd failure, and the `/tmp` cwd probe
which also failed because the profile does not cover its canonical private path.
These were not resolved by skips, retries-until-green, or broader production grants.
Earlier Windows recovery/process-tree timeouts remain unproven and open for
separate diagnosis. Exact-commit Windows/macOS/Ubuntu CI is still required.

No merge, release, binary replacement, or aggregate gap closure is claimed here.
