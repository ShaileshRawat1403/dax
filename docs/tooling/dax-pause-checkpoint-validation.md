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
- Bun, Sol-reported: the now-missing
  `/private/tmp/dax-bun-1.4.0/bun-darwin-aarch64/bun --version` returned `1.4.0`.
  Frozen dependency install completed with that binary. For reproducible macOS
  ARM64 setup, use the [checksum-verified Bun 1.4.0 procedure](bun-toolchain-verification.md#reproduce-the-isolated-setup),
  then explicitly check the provisioned binary with `--version` for `1.4.0`.
- Full gate, Sol-reported: `bun run release:gates` exited 0 with that binary first on `PATH`
  and task-local `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME`.
  Repository integrity, legacy guard, typecheck, lint, 1,860 tests (2 skipped,
  0 failed), 5/5 smoke evaluations, Rust format/clippy/tests, and release check
  passed. This was a source gate run, not `DAX_RELEASE=1` release validation.
- Local documentation, Sol-reported: the initial candidate check resolved 32
  local Markdown links; the correction check resolved 34. `git diff --check`
  passed for both.
- Independently inspectable checkpoint CI: [run 35950398765](https://github.com/ShaileshRawat1403/dax/actions/runs/35950398765)
  completed successfully at exact SHA `6bfd477fe4e2b89ab810cc8fae7e932728109227`;
  Ubuntu, macOS, and Windows jobs all succeeded. This run covers that SHA only;
  later documentation corrections require their own exact-SHA check.

Three earlier full gate attempts did not pass. The first ran from `/private/tmp`:
the macOS seatbelt test could not traverse that working directory. After moving
the same worktree under `/Users`, its isolated test passed 3/3. Two subsequent
full runs from the repository worktree each had 1,859 passes, 2 skips, and one
failure in `packages/dax/src/server/relay.test.ts`: a global `fetch` spy observed
one call. That test passed 1/1 alone. The final full run with task-local XDG
directories passed. The cause of the extra call remains unknown. No test or
runtime behavior was changed to obtain the passing result.

The four formerly cited `/private/tmp/dax-pause-checkpoint-*.log` files and the
isolated Bun executable are no longer present. A safe search found no recoverable
checkpoint log copies. The local counts, failures, and commands above are
Sol-reported and cannot now be independently inspected from raw logs. The first
`/private/tmp` gate attempt was observed in the task output but was never saved
as a file. The linked hosted CI remains inspectable at its named SHA.
