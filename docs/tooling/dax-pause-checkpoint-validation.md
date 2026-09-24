# DAX pause checkpoint validation

This records local validation of the combined checkpoint source on 2026-09-24.
It does not change the frozen v1.5.0 release record or establish a new release.

- Base: `origin/main` at `7ccfc8a4cdd93ff054cabe2c43197438b88e8995`.
- Inputs: status docs `c10f48f9887968535500f7128c1f37508cd972ab` and
  home UI `9e245b839f9cf0871a18cb4194533789298587e3`, including design ancestor
  `a8043169adb35a7fcc9e73967bf31160581d2835`.
- Runtime: `packages/dax/src/cli/cmd/tui/routes/home.tsx` and its ESLint
  suppression count match the approved UI commit exactly; no other runtime file
  differs from the base.
- Bun: `/private/tmp/dax-bun-1.4.0/bun-darwin-aarch64/bun --version` returned
  `1.4.0`. Frozen dependency install completed with that binary.
- Full gate: `bun run release:gates` exited 0 with that binary first on `PATH`
  and task-local `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME`.
  Repository integrity, legacy guard, typecheck, lint, 1,860 tests (2 skipped,
  0 failed), 5/5 smoke evaluations, Rust format/clippy/tests, and release check
  passed. This was a source gate run, not `DAX_RELEASE=1` release validation.
- Changed Markdown files: 32 local links resolved. `git diff --check` passed.

Two earlier full gate attempts did not pass. The first ran from `/private/tmp`:
the macOS seatbelt test could not traverse that working directory. After moving
the same worktree under `/Users`, its isolated test passed 3/3. Two subsequent
full runs from the repository worktree each had 1,859 passes, 2 skips, and one
failure in `packages/dax/src/server/relay.test.ts`: a global `fetch` spy observed
one call. That test passed 1/1 alone. The final full run with task-local XDG
directories passed. This suggests ambient state affected the relay test, but the
precise source of the extra call is not established. No test or runtime behavior
was changed to obtain the passing result.

Raw local logs are retained outside the tracked tree at
`/private/tmp/dax-pause-checkpoint-release-gates.log`,
`/private/tmp/dax-pause-checkpoint-release-gates-rerun.log`, and
`/private/tmp/dax-pause-checkpoint-release-gates-isolated.log`, and
`/private/tmp/dax-pause-checkpoint-relay-isolated.log`.
The initial `/private/tmp` attempt was observed in the task output but was not
saved as a file. Platform CI for the exact pushed checkpoint SHA is reported in
the review handoff.
