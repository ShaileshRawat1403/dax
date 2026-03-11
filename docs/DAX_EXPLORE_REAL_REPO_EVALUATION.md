# DAX Explore Real Repo Evaluation

Date: March 11, 2026

This evaluation validates `dax explore <path>` against local repositories under `/Users/Shared/MYAIAGENTS` before broader Explore mode plumbing.

Status:

- baseline batch recorded before the latest Explore refinements
- second validation batch recorded after:
  - runtime entry classification refinement
  - workspace execution-flow tracing refinement
  - integration signal quality refinement
- third validation batch recorded after:
  - targeted workspace execution-flow refinement for generic bootstrap and workspace-package handoff detection

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

## Second Validation Batch

Date: March 11, 2026

This second batch reran the same repo set after the latest three Explore refinements.

### What Improved

#### `dax`

- remains a strong Explore target
- library-only workspace packages are now classified more honestly
- execution graph and orchestration loop remain strong
- output still reads like a real runtime map rather than a summary

#### `dax-cli`

- remains a strong Explore target
- execution-flow tracing is still one of the clearest outputs in the set
- workspace package role reporting is now better separated between runtime surfaces and supporting libraries

#### `soothsayer`

- integration noise is lower than before
- workspace role separation is clearer:
  - supporting-library packages are now surfaced more honestly
- API and worker bootstraps are still found correctly

### What Did Not Improve Enough

#### `dao`

- still honest, but thin
- execution graph and orchestration loop remain unknown
- reading order is still shape-first and CI-heavy after the bootstrap

Interpretation:

- Explore is behaving honestly here
- the main gap is still mixed-language runtime tracing, not formatting

#### `pruningmypothos`

- still the weakest fit in the set
- no meaningful runtime start was confirmed
- output remains shape + CI + unknowns

Interpretation:

- this is not a noise problem anymore
- it is a repo-shape/runtime-detection limit

#### `soothsayer`

- still exposes the clearest remaining weakness
- entry points are better, but packages like `types` and `utils` still generate unresolved runtime-candidate noise
- execution graph is still too weak relative to the visible workspace shape
- some runtime-adjacent integration findings are still low-value:
  - auth/platform/provider hints inside package internals

Interpretation:

- the next gains are more likely to come from better workspace/runtime tracing than from another broad output cleanup pass

## Second-Batch Cross-Repo Summary

### Stable strengths now

- repository shape detection is consistently reliable
- explicit CLI/server/worker starts are usually found correctly
- Explore now stays much more honest about supporting-library packages
- self-referential and test-heavy noise is materially lower
- the fixed output contract is holding across very different repos

### Repeated limits now

- mixed-language repos still lack meaningful flow tracing
- content/web repos without explicit server/runtime surfaces still collapse into shape + CI + unknowns
- workspace execution-flow tracing is still weaker than repo-shape detection in large repos
- integration noise is lower, but not fully solved in runtime-adjacent internal packages

## Updated Recommendation

Do not broaden Explore mode plumbing yet.

The evidence now suggests the next best Explore move is:

1. one more targeted workspace execution-flow refinement
2. then another real-repo validation pass
3. then decide whether broader Explore plumbing is finally justified

Reason:

- the remaining weakness is no longer mostly surface noise
- it is now primarily execution-flow depth in larger workspaces and non-DAX-shaped repos

## Held Next Step

The next Explore slice should stay narrow:

1. targeted workspace execution-flow refinement
2. use `soothsayer` as the primary stress-case repo
3. rerun the same five-repo validation batch

Focus:

- package-to-package handoffs
- runtime-surface to orchestration-core transitions
- session / workflow / tool-routing boundaries
- stronger confirmation of cross-package execution chains

Do not shift to:

- broader Explore mode plumbing
- TUI Explore exposure
- generic output reshaping
- another broad integration pass

until that workspace-flow refinement has been validated against the same repo set.

## Third Validation Batch

Date: March 11, 2026

This third batch reran the same five local repos after the targeted workspace-flow refinement that added:

- app/service source scanning in the execution-flow pass
- generic bootstrap-to-module detection
- worker bootstrap and inline orchestration detection
- workspace package-name import tracing

### What Improved

#### `soothsayer`

- this is the clearest improvement in the batch
- execution graph is no longer thin:
  - worker dispatch is now surfaced from `apps/worker/src/main.ts`
  - web bootstrap handoff is now surfaced from `apps/web/src/main.tsx -> apps/web/src/App.tsx`
- orchestration loop is now no longer `unknown`:
  - worker orchestration is detected from the multi-worker inline runtime
  - API bootstrap handoff into `AppModule` and websocket/runtime boundaries is detected from `apps/api/src/main.ts`
- important files now include actual orchestration files instead of only roots and candidate runtime manifests

Interpretation:

- the refinement fixed the right thing
- Explore is now materially better on multi-surface workspaces where orchestration lives in app/service bootstraps rather than only in shared packages

#### `dax`

- remains a strong Explore target
- no regression from the new generic bootstrap heuristics
- execution graph and orchestration loop remain strong
- worker/TUI flow continues to read like a real runtime map

Interpretation:

- the refinement generalized without breaking the repo it was originally tuned around

#### `dax-cli`

- remains strong
- execution graph still reads clearly across CLI, TUI, server, and session surfaces
- generic bootstrap detection adds useful server-flow visibility instead of noise

Interpretation:

- broader bootstrap detection is still helping more than hurting on DAX-shaped workspaces

### What Did Not Improve Much

#### `dao`

- still honest but thin
- entry remains correct
- execution graph and orchestration loop are still unconfirmed

Interpretation:

- the remaining gap is still mixed-language runtime tracing, not output shape

#### `pruningmypothos`

- still mostly shape + CI + unknowns
- the new flow heuristics do not invent a runtime chain, which is the correct behavior

Interpretation:

- this remains an honest limit of current file-grounded runtime detection

### New Cross-Repo Pattern

The refinement confirms a useful Explore rule:

- execution-flow quality improves most when DAX can recognize runtime bootstraps and workspace package-name handoffs
- once that works, large workspaces stop looking “thin by accident”
- repos that remain thin after that are usually thin because evidence is genuinely weak, not because the output model is wrong

### Updated Recommendation

Explore is now closer to product-ready for CLI use, but not yet ready for broader plumbing.

The next choice should be:

1. one more narrow validation-informed refinement only if a repeated pattern remains
2. otherwise start defining broader Explore plumbing from a now-stable engine

Current evidence suggests:

- `soothsayer` no longer justifies another broad workspace-flow rewrite
- `dao` and `pruningmypothos` are mostly honest-evidence limits
- the next Explore decision can shift from engine correctness toward product-surface readiness
