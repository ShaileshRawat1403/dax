# DAX Explore Real Repo Evaluation

Date: March 11, 2026

This evaluation validates `dax explore <path>` against local repositories under `/Users/Shared/MYAIAGENTS` before broader Explore mode plumbing.

## Repo Set

- `dao`
  - mixed Node + Rust repo with a CLI surface
- `dax-cli`
  - larger TypeScript workspace with CLI, server, and nested packages
- `dax`
  - current canonical DAX repo
- `pruningmypothos`
  - content/site-oriented web repo with CI and deployment files
- `soothsayer`
  - larger pnpm/turbo workspace with apps, worker, infra, and packages

Note:
- This batch uses local repos only.
- No true third-party unfamiliar repo was available in the sampled local set.

## Evaluation Criteria

For each repo, validate:

- repo shape
- real entry points
- execution flow
- integrations
- important files
- reading order
- unknowns / follow-up targets
- honesty of `observed` / `inferred` / `unknown`

## Results

### `dao`

Observed strengths:

- repo shape is correct
- mixed `node` + `rust` detection is correct
- CLI bootstrap is correctly surfaced from `package.json` -> `bin/dao`
- CI files are surfaced cleanly

Observed weaknesses:

- no execution graph was found
- no orchestration loop was found
- reading order becomes too shallow after the CLI file and falls back to CI files
- integrations are overconfident relative to the rest of the report because CI is the only strong external signal

Assessment:

- good on repository shape
- weak on runtime tracing for Rust-heavy or mixed-language command repos

### `dax-cli`

Observed strengths:

- repo shape is strong
- multiple workspace boundaries are surfaced correctly
- real runtime starts are found across server and nested CLI surfaces
- execution graph is meaningfully useful
- important files and reading order are runtime-first
- unknowns are concrete rather than generic

Observed weaknesses:

- some packages are marked `unknown` even when they are library/support packages rather than missing runtime starts
- follow-up list is still broad because inferred integration and flow items accumulate quickly

Assessment:

- strong result
- currently one of the best validation targets for Explore

### `dax`

Observed strengths:

- repo shape is correct
- canonical CLI runtime is surfaced clearly
- execution graph is strong and file-grounded
- reading order is useful and begins with actual runtime files
- self-referential Explore files are no longer polluting surfaced output

Observed weaknesses:

- some nested package entry-point classification still treats package `src/index.ts` files as CLI-like too eagerly
- follow-up list remains somewhat repetitive for inferred auth/platform/integration boundaries

Assessment:

- strong result
- output is now substantially cleaner after the quality-refinement pass

### `pruningmypothos`

Observed strengths:

- repo shape is correct
- Dockerfile and root package signals are detected
- CI/deploy integrations are visible

Observed weaknesses:

- no entry points found
- no execution graph found
- no orchestration loop found
- integration detection is too broad but shallow
- `auth or secrets boundary` findings on page/data files are not very useful
- important files and reading order degrade into content-page files rather than a meaningful runtime map

Assessment:

- weakest result in this batch
- current heuristics are not yet good for web/content repos without obvious server bootstrap patterns

### `soothsayer`

Observed strengths:

- repo shape is strong
- workspace tooling and boundaries are correctly detected
- API and worker bootstraps are found
- important files and reading order correctly prioritize workspace roots and runtime starts

Observed weaknesses:

- package `main` fields generate too many candidate runtime starts
- some package `src/index.ts` files are treated like CLI entry points when they are more likely libraries
- execution graph remains `unknown` despite clear app/worker structure
- unknowns around `apps/web` and `packages/config` are honest, but they also indicate current flow detection limits

Assessment:

- good shape and entry detection
- execution-flow tracing is not yet strong enough for larger app/workspace repos

## Cross-Repo Patterns

### What is working well

- repository shape detection is consistently strong
- workspace and monorepo boundaries are useful
- real CLI/server/worker bootstraps are often found when explicit runtime starts exist
- important files and reading order are much cleaner after filtering self-referential Explore files
- `unknown` is now used more honestly when evidence is weak

### Repeated failure points

- test/support/library package `src/index.ts` files can still be overclassified as runtime entry points
- `package.json main` fields are still too eager as runtime-start candidates
- execution-flow tracing is strong for DAX-like repos but weak for:
  - mixed Rust/Node repos
  - content/web repos
  - large workspaces where orchestration is distributed
- integration detection is broad, but some categories remain shallow and noisy
- reading order degrades when strong runtime signals are absent

### Noise quality after refinement

Improved:

- Explore implementation files no longer dominate surfaced results
- Explore tests no longer dominate important files or reading order
- runtime files now outrank tests and self-analysis

Still noisy:

- test evidence can still appear in supporting findings when no stronger production evidence exists
- inferred auth/platform signals are often numerous and low-signal

## Repo-by-Repo Outcome Summary

| Repo | Shape | Entry points | Execution flow | Integrations | Reading order | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| `dao` | strong | partial | weak | partial | shallow | mixed |
| `dax-cli` | strong | strong | strong | strong | useful | strong |
| `dax` | strong | strong | strong | strong | useful | strong |
| `pruningmypothos` | strong | weak | weak | mixed | weak | weak |
| `soothsayer` | strong | good | weak | good | useful | mixed |

## Recommended Next Refinements

### 1. Tighten runtime entry classification

- distinguish library `src/index.ts` from real CLI/server/worker starts more aggressively
- down-rank `package.json main` as a candidate unless runtime signals reinforce it

### 2. Tighten integration quality

- reduce low-value auth/platform hits from generic content/data files
- promote integrations that clearly affect execution, state, orchestration, or external communication

### 3. Improve execution-flow tracing for workspaces

- detect app-to-worker, app-to-API, and queue/dispatch handoffs better
- treat lack of a proven chain as `unknown`, not as a weak inferred graph

### 4. Improve reading-order fallback

- when flow is weak, bias reading order toward:
  - workspace roots
  - explicit entry files
  - integration boundaries
- avoid low-signal page/content files as early reading targets

## Recommendation

Do not broaden Explore mode plumbing yet.

The right next step is another narrow Explore quality pass focused on:

- runtime-start classification
- package/library vs runtime distinction
- integration noise reduction
- workspace execution-flow tracing

After that, rerun this evaluation on the same repo mix and look for repeated improvements before widening Explore into broader mode/session plumbing.
