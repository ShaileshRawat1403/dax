# Bun test discovery investigation — 2026-09-19

## Result

A fresh frozen install is sufficient to run the complete DAX test stage under
Bun 1.4.0: **1738 pass, 2 skip, 0 fail**, across 235 files. The same fresh clone
under Bun 1.3.9 finishes discovery and execution but fails the known version guard:
**1734 pass, 2 skip, 1 fail, 1 error**. Neither fresh-clone run reports `EMFILE`.

The original Codex worktree still reproduces `EMFILE` with `bun test packages`.
Changing only the discovery argument to `./packages`, while keeping the runtime,
installed dependencies and source fixed, gives **1738 pass, 2 skip, 0 fail**.
A small independent fixture demonstrates why scope matters: a bare `packages`
filter also executes `artifacts/packages/copy.test.ts` despite `.gitignore`, while
`./packages` executes only the intended package directory.

The practical failure mode is broad discovery in an artifact-populated checkout.
My earlier choice to keep a Bun package cache under `artifacts/` was not isolated
from test discovery. Git ignoring a directory does not make Bun ignore it. The
investigation later added a nested clone there as well. This result does not
identify the precise file or internal Bun descriptor operation that originally
hit `EMFILE`; it establishes a reproducible failing invocation and a passing
scoped invocation on the same installed tree.

## Controlled inputs

- Source: `1741898917fce0b121f9c3535993d35bf640588f`; production/test code is
  unchanged from `f31255b07d646d8d0a44560833bd61ffee6f00d3`.
- Original worktree: `/Users/Shailesh/MYAIAGENTS/dax-codex`.
- Independent clone: `artifacts/bun-toolchain/fresh-clone`, created with
  `git clone --no-local --no-checkout`, then checked out on
  `chore/codex-frozen-probe` at the source SHA. It has its own Git database.
- Fresh clone initially had no `node_modules`. Installation used an empty cache
  outside that clone, at `artifacts/bun-toolchain/fresh-experiment/empty-install-cache`.
- Bun 1.4.0 revision: `34cbb9a40`; comparison Bun 1.3.9 revision: `cf6cdbbba`.
  Each selected binary directory was prepended to `PATH` for nested invocations.
- Frozen installation exited zero, installing 776 packages. Both Codex installs
  contain the same 787 immediate entry names in `node_modules/.bun`. This is an
  inventory comparison, not a byte-for-byte comparison of every installed file.
- The lockfile hash before and after fresh installation remains
  `4a153f81f30fc9775e9fc237e406d55ac220f677a36692dca01914a995192c1d`.
- Each test invocation used a fresh, separate `DAX_TEST_HOME`, with models fetching
  and config auto-install disabled. Direct test calls used the same watcher,
  shadow-audit and run-notice flags as `script/test.ts`.
- The child soft descriptor limit was explicitly set to 1048576. Global kernel
  limits were not changed. Tests ran sequentially; no process belonging to the
  other agent was stopped.

## Results

| Checkout / command | Runtime | Result | Elapsed |
| --- | --- | --- | --- |
| Fresh clone, `bun run test` | 1.4.0 | Exit 0; 1738 pass, 2 skip, 0 fail | 119.83s |
| Fresh clone, `bun run test` | 1.3.9 | Exit 1; 1734 pass, 2 skip, 1 fail, 1 error; version guard | 87.41s |
| Original, `bun test packages --max-concurrency 1` | 1.4.0 | Exit 1; `EMFILE` | 0.94s |
| Original, `bun test ./packages --max-concurrency 1` | 1.4.0 | Exit 0; 1738 pass, 2 skip, 0 fail | 116.18s |

The original-worktree comparison used the same flags, requested limit and runtime
for both cases; only the discovery argument and fresh per-run home differed. The
broad case had a 25-second diagnostic timeout but failed naturally in under one
second. The scoped case completed naturally within its 600-second bound.

The single failed test/error in the 1.3.9 fresh-clone summary is the rejected
script-module import. It does not establish another independent assertion defect.
The full logs show `packages/script/src/index.ts:16` requiring `bun@^1.4.0`.

## Discovery fixture

A disposable directory contained these files:

```text
.gitignore                            # contains: artifacts/
packages/main.test.ts                 # one passing test
artifacts/packages/copy.test.ts        # throws ARTIFACT_DISCOVERED
```

| Invocation from fixture root | Result |
| --- | --- |
| `bun test packages` | Both files run: 1 pass, 1 fail |
| `bun test ./packages` | Only intended file runs: 1 pass, 0 fail |

The fixture was removed after recording its results. The actual DAX source was
not edited for either experiment. This matches Bun's documented distinction
between [test filters and explicit paths](https://bun.sh/docs/test).

`script/test.ts:4` currently supplies the bare `packages` argument. The proposed
follow-up is to use `./packages` and add a regression fixture ensuring ignored
artifact copies cannot enter the package suite. That code change is not included
in this verification branch.

## Host-state observations and limits

The machine was not completely idle. Before the fresh-clone tests, a long-lived
Bun process was consuming CPU; an earlier cwd inspection identified it as belonging
to the other agent's checkout. It was not touched. The archived snapshot records
process IDs, executable names and CPU readings, without command arguments.

`kern.maxfiles` was 30720 and `kern.maxfilesperproc` was 10240. System-wide
`kern.num_files` samples during the successful 1.4.0 run ranged from **6703 to
9992** (1948 samples), and during the 1.3.9 run from **6704 to 9645** (1453 samples).
Sampling occurred about every 50ms plus command overhead. No sampled point reached
the system table limit; short unsampled peaks are not ruled out. These measurements
apply to the fresh-clone runs, not to every historical failure.

A new clone changes several variables at once, so its success alone would not
prove a machine-state cause. The subsequent original-worktree argument comparison
and the tiny fixture provide the stronger evidence for discovery scope. No missing
dependency needed to be added to obtain the passing original-worktree suite.

## Evidence and next boundary

The [summary](evidence/bun-2026-09-19/summary.json) records commands, results and
host samples in compact form. The [receipt](evidence/bun-2026-09-19/receipt.json)
records hashes of every byte-exact member in the committed
[raw archive](evidence/bun-2026-09-19/raw-artifacts.tar.gz). Full logs and all host
file-count samples are available there, not only on the author's machine.

For example:

```sh
tar -xOf docs/tooling/evidence/bun-2026-09-19/raw-artifacts.tar.gz \
  original-directory.log | tail -n 10
```

This completes the fresh-install and test-stage investigation. It does not claim
a green complete `release:gates` chain: smoke evals, Rust verification and the
release check were not run as part of this follow-up. The test-runner scoping fix
and its full gate validation remain a separate Codex-lane work item.
