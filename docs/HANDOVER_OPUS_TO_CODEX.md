# Handover: Claude Opus 5.5 to Codex

Recorded 2026-10-04 by Claude Opus 5.5 at the maintainer's direction. The maintainer
transferred the remaining conformance implementation to Codex. Astra remains the
architecture and merge reviewer. This document is a record, not an acceptance: no
individual acceptance listed here implies acceptance of the complete stack, and nothing
here closes a gap.

Opus's implementation is frozen from this commit. Stage 4d runtime changes are on hold.

## 1. State of the branch

| Item | Value |
|---|---|
| Branch | `feat/conformance-execution-opus` |
| Worktree | `/Users/Shailesh/MYAIAGENTS/dax/.claude/worktrees/conformance-execution-opus` |
| Owner until this commit | Claude Opus 5.5 |
| Owner after this commit | Frozen. Codex should branch from the head below in its own worktree rather than commit here |
| Base | `3c47d1a3045fa311bba4755d3aff8c5735e1baa2` (the inherited stack, see below) |
| Last implementation head | `32b2f34fc9dc3d78d20b4a9a29606f6e1a726309`, accepted by Astra |
| This handover | the commit that adds this file; its SHA is reported in the handoff message |
| Remote parity | `origin/feat/conformance-execution-opus` equalled the local head at `32b2f34` before this commit, and is pushed again with it |
| Uncommitted work | None |
| `main` | `d2ef0b0f510c70df29d3855f399e02902fbe4014`, unchanged |
| v1.5.0 | tag at `7069694122617f3c5692f857b50a444f970c7926`, unchanged; installed binary not replaced |

**The inherited stack.** The base `3c47d1a` is 28 commits above `main` (`d2ef0b0..3c47d1a`):
journal protocol, scoped envelopes, project-journal work in progress, capability identity
bindings for MCP, plugins, workflows, workers, graph operators, context reads and the
command shell, runtime-guard path fixes and test-fixture timing. It was built by Sol and
earlier Codex lanes and was never given the final comprehensive review. Everything on this
branch sits on it.

Other worktrees are untouched and remain with their owners, including Sol's frozen
`docs/sol-to-opus-handover` (`8c032805`), Astra's reviewer checkouts under `/private/tmp`,
and the Codex worktrees under `~/.codex/worktrees`. None was cleaned up.

## 2. Slice-to-SHA map

"Accepted" means Astra accepted that exact SHA for that bounded slice. It does not mean
the stack is accepted, and it does not authorize merge, activation, release or gap
closure.

| Slice | Commits | Review state |
|---|---|---|
| WS1: entry-point audit, composed vocabulary, operator shell, MCP prompt and verification enrollment, behaviour-based gap checks | `04004c3` .. `337868a` | Accepted at `337868a` after two corrective rounds |
| Trust: project tool files withheld until trusted, fail-closed scans | `05bb2a3`, `3e13bba`, `38147c9` | Accepted at `38147c9` |
| Trust: plugin content binding, restart-required rule, realpath-keyed load cache; grant compatibility design | `2da225b` .. `42c4be3` | Accepted at `42c4be3` |
| Grant stage 1: v1 decisions bound to the selected executor; operator shell bound to the contract | `1f8e54f` .. `d2470c9` | Accepted at `d2470c9` |
| Grant stage 2: shared lookup, inactive grant format, record-only resolution event, tool and shell paths | `3e80751` .. `4a08f28` | Accepted at `4a08f28` |
| Grant stage 2: remaining action paths | `cb7ae16` .. `fd5bef6` | Accepted at `fd5bef6` |
| Stage 2 summary and stage 3 proposal | `52898e5` | Reviewed; implementation authorized with amendments |
| Stage 3: operator review, barrier, digest-bound publication | `587e83c` .. `60b56dd` | Accepted, inactive, at `60b56dd` |
| Test harness: suite passes from the package directory | `2875c13` | Accepted |
| Stage 4 proposal | `5fba00a`, `61db105` | Direction approved with amendments; tables reconciled |
| Stage 4a: attested bindings, verification selection | `9ffd1b1`, `57d16e5` | Accepted, inactive, at `57d16e5` (`9ffd1b1` was refused) |
| Stage 4b: journal proof, tool-path enforcement | `75f46da`, `583163c`, `a571b73` | Accepted, inactive, at `a571b73` |
| Stage 4c: action paths | `3a3f683`, `144ed91` | Accepted at `144ed91` |
| Stage 4c: ask grants and remembered approvals | `5906f2a`, `06c5a95`, `cfcce3c` | Accepted at `cfcce3c` |
| Stage 4c: delegation | `0fc64f2` | Accepted within the inactive boundary |
| Stage 4c: MCP v2 read identities | `b716951`, `32b2f34` | Accepted at `32b2f34` |
| This handover | this commit | Not reviewed |

**Unreviewed work.** On this branch: only this handover document and the ownership
updates in `AGENTS.md` and `docs/DAX_STATUS.md`. Underneath: the whole inherited stack
`d2ef0b0..3c47d1a`, which awaits final comprehensive review.

**Proposed gap closures.** None by Opus. The branch's candidate ledger
(`packages/dax/src/conformance/known-gaps.ts`) no longer lists `scope.journal-primitive`
and `scope.aware-envelope`. Those removals come from the inherited stack (`e2ac9cb`,
`5a5ebe1`, `05bf3b2`, `cffb98b`) and are proposals only; `main` records eight open gaps.

## 3. Remaining gaps

`main` records eight open gaps. All eight remain open. The branch ledger's wording for
`inv5.contract-grants` and `inv5.grant-resolution` describes the state after stage 2 and
is now behind the code; it was left unchanged so that this freeze touches no source.

| Gap | Implementation status on this branch | Missing production controls | Depends on | Acceptance needed to close |
|---|---|---|---|---|
| `inv5.capability-vocabulary` | Every DAX-dispatched family composes into one vocabulary. Legacy `ToolRegistry.register` tools and caller-supplied graph operators dispatch without a descriptor, by decision | A decision on legacy executors: enroll, or record a permanent compatibility exclusion that the gap's definition accepts | Architecture decision on legacy executors | The gap check passes without exclusions, or the gap definition is narrowed by review |
| `inv5.capability-properties` | Enrolled descriptors are validated and descriptive; legacy executors have none | Same as above | Same | Same |
| `inv5.contract-grants` | Operator-reviewed v2 contracts exist (stage 3), with journal proof (4b), ask, delegation and v2 MCP reads (4c). All inactive behind the barrier; production contracts are still v1 | 4d activation; production creation path; end-to-end controls in section 4 | Stage 4d; a decision on exposing the opt-in | Reviewed runs execute in production under reviewed grants, with the section 4 controls green |
| `inv5.grant-resolution` | One lookup on every enrolled path, enforced for activated reviewed runs (4b, 4c) | Lifting the barrier; full dispatch evidence under activation; resolution for families that cannot be bound (below) | Stage 4d; bindable forms for plugins, local MCP, workers, verification | Every governed action of an activated run is decided by the lookup in production, with negative controls |
| `scope.journal-primitive` | Proposed closed by the inherited stack | Final review of that stack | Final comprehensive review | Astra's acceptance of the inherited journal work |
| `scope.aware-envelope` | Proposed closed by the inherited stack (v2 envelopes, historical recovery) | Same | Same | Same |
| `scope.project-journal` | Candidate project journal on `feat/project-scoped-journal` (see `docs/roadmap/PROJECT_JOURNAL_CANDIDATE.md`); not on this branch's production path | Production PM reads and writes migrated to it; an operator review flow for fact changes | Grants and enforcement settled; Astra's review of the candidate | Production project facts come only from the journal, with replay after source-run removal |
| `memory.no-producer` | Untouched | A governed producer for project memory | The project journal; a governance decision on what may be promoted | Memory written only through approved, journalled facts |

**Families that cannot be bound.** Under the boundary accepted at `57d16e5`, only
compiled-DAX native capabilities and acknowledged remote MCP servers are bindable.
Plugins and loader modules, local MCP servers, worker CLIs, verification commands and
source-run native capabilities have no supported form and are never granted. An
activated run refuses work that needs a worker or required verification before any effect.
These are explicit remaining work, not closures.

## 4. Stage 4d: intended design

The design is in `docs/roadmap/GRANT_STAGE4_PROPOSAL.md`; architecture review is required
before any 4d code.

**What 4d does.** It lifts the stage 3 barrier, for one run at a time, only when:

- the run's review publication is complete and its journal proof matches the stored
  artifact;
- the run has been activated, with every binding verified at activation;
- the binary supports enforcement, meaning a compiled running image whose native
  bindings are exact.

When all three hold, the guardian and the session entry points (`prompt`, `loop`,
`command`, `shell`) return the published contract as the run's authority. In every other
state the barrier holds.

**Authority decisions already settled:**
- A grant is necessary, never sufficient. Permissions and the runtime guard still apply.
- A missing grant is a denial. An `ask` needs a named operator's approval of the exact
  grant, capability, contract digest and binding digest, before the deadline.
- "Always" covers only that tuple.
- A delegated child runs only as an approved agent, under the parent's activation.
- A dispatch-time binding change denies that action only, not the run.

**Compatibility decisions already settled:**
- v1 contracts, runs without review, interactive sessions and no-contract actions behave
  exactly as today.
- MCP v1 identities are unchanged and never covered by source grants. v2 read identities
  are minted only when a reviewed run decides a read.
- The new run events (`grant_review_published`, `grant_review_activated`,
  `grant_ask_remembered`, `enforced` resolutions) and the approval subjects can't be read
  by v1.5.0.

**Decisions still open for 4d:**
- whether and how to expose the opt-in (route, CLI or configuration);
- Running-label semantics once reviewed runs execute;
- the successor-run requirement for legacy consequential work.

**Mandatory controls before activation.** These go beyond the decision-boundary tests
that exist today:

| Control | What it must show |
|---|---|
| End-to-end MCP tool dispatch | In a compiled DAX image, an activated run's model turn invokes a granted MCP tool through `SessionPrompt`, the tool runs, and replay accepts the chain; an ungranted tool on the same server has no effect |
| End-to-end MCP resource and prompt reads | Through the real `createUserMessage` and `command` paths, a granted v2 read is performed; a cross-server, v1-only or ungranted read performs no `readResource` or `getPrompt` and records no item name |
| Ask flows end to end | Approve, deny, timeout and "always" through the approval routes, with a binding change during the wait denying the action |
| TaskTool no-fallback | A real `TaskTool` execution requesting an unknown agent creates no child session and records no delegation; requesting an approved agent creates exactly that child |
| TaskTool child dispatch and resume | The child's tool calls resolve against the parent's activation and are denied what the parent lacks; resuming a child with `task_id` keeps that binding and is refused across runs |
| Barrier states | Every state except complete publication plus activation plus enforcing binary keeps the barrier: unpublished, uncertain publication, unactivated, a source build, a stale artifact |
| Legacy rows | Every row of the legacy table in the proposal, by the existing stage 1 to 4 regressions unchanged |

## 5. Validation

**Pinned toolchain.** Bun 1.4.0 at
`/Users/Shailesh/MYAIAGENTS/dax/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64` (see
`docs/tooling/bun-toolchain-verification.md`).

```sh
export PATH=/Users/Shailesh/MYAIAGENTS/dax/artifacts/bun-toolchain/1.4.0/bun-darwin-aarch64:$PATH
bun --version                                   # 1.4.0
cd packages/dax && bun run typecheck
NODE_OPTIONS=--max-old-space-size=8192 bun run lint
cd ../.. && bun run test                        # CI's gate: the repo root, not packages/dax
# focused:
cd packages/dax && DAX_DISABLE_MODELS_FETCH=1 bun test --max-concurrency 1 \
  ./src/conformance/grant-stage1.test.ts ./src/conformance/grant-stage2-paths.test.ts \
  ./src/conformance/grant-stage3.test.ts ./src/conformance/grant-stage4a.test.ts \
  ./src/conformance/grant-stage4b.test.ts ./src/conformance/grant-stage4c.test.ts \
  ./src/conformance/grant-stage4c-ask.test.ts ./src/conformance/grant-stage4c-delegation.test.ts \
  ./src/conformance/grant-stage4c-mcp-v2.test.ts ./src/capability
```

At `32b2f34`, the full root suite gave 2309 pass, 0 fail. CI is
[run 37169394516](https://github.com/ShaileshRawat1403/dax/actions/runs/37169394516), green
on Ubuntu, macOS and Windows at attempt 1.

**Where the evidence is:**

| Evidence | Location | Durable |
|---|---|---|
| Exact-SHA CI for every slice | GitHub Actions on this branch | Yes |
| Design, review outcomes and delivered behaviour per stage | `docs/roadmap/CAPABILITY_ENTRY_POINT_AUDIT.md`, `GRANT_COMPATIBILITY_DESIGN.md`, `GRANT_STAGE3_PROPOSAL.md`, `GRANT_STAGE4_PROPOSAL.md` | Yes |
| Production regressions and negative-control targets | `packages/dax/src/conformance/grant-stage*.test.ts`, `capability/*.test.ts`, `project/*-trust.test.ts` | Yes |
| Opus local gate logs | Session scratchpad under `/private/tmp/claude-501/...`; SHA-256 recorded in each handoff | No; reproduce with the commands above |
| Astra's independent controls and logs | `/private/tmp/dax-astra-opus-ws1` and `/private/tmp/dax-astra-*.log` | No; Astra's checkout |

**Retained failures and intermittents, none claimed resolved:**
- Windows: `state/recovery.test.ts` timeouts, once in `afterAll` and once in "a stranded
  run is found even behind more than a page" at 5000 ms against a usual 2.4 s.
- Windows: `sdlc/check-runner.test.ts:52` process-tree kill timeout.
- The post-greeting Running/Brooding label (see `docs/DAX_STATUS.md`).
- Four local failures, explained and fixed in `2875c13`: the PM database opened inside a
  deleted test home, and a cwd-relative CI path. They appeared only when running from
  `packages/dax`.

**Rejected hypotheses and approaches, with the reason each failed review:**
- Size and modification time as evidence that content is unchanged.
- Classifying executables by name or by a missing `#!` line.
- Hashing the binary by path at startup as an exact identity: it can be replaced before
  the hash.
- Statically analysing a module's dependency closure.
- Recording a loaded-module digest that a cached import can contradict.
- An MCP executable resolved from the ambient PATH instead of the launch's own.
- Checking MCP source coverage by family prefix only.
- Treating unreadable authority as unreviewed.
- Reading permissions before an awaited agent lookup.
- Starting an ask's timer before its request is logged.
- Trusting the record's choice of `allow` under an `ask` grant.
- Repairing an invalid descriptor into a valid identity.

**Known limitations:**
- Source runs bind no native capability, so tests that exercise native flows substitute a
  compiled identity. Compiled acceptance comes only from the compiled probes in the 4b
  and 4c tests.
- The Bun runtime is identified by its compiled-in revision, not by hashing its machine
  code.
- External executables are described, never attested.
- The `a571b73` commit message says MCP tool names are "nothing private"; the code comment
  was corrected in `3a3f683`, but the commit message cannot be.

## 6. Shortest safe order from here

1. **Final comprehensive review of the inherited stack** `d2ef0b0..3c47d1a`. Everything
   above depends on it.
2. **Stage 4d proposal.** Lifting the barrier, the opt-in exposure decision, and the
   section 4 controls. Architecture review, then implementation in bounded commits.
3. **Bindable forms for the excluded families,** or an explicit, reviewed narrowing of the
   two grant gaps: plugins, local MCP, workers, verification.
4. **Close `inv5.contract-grants` and `inv5.grant-resolution`**, only on Astra's
   acceptance of production evidence.
5. **Project journal:** review the candidate, migrate production PM reads and writes, and
   add the operator fact-review flow. Then `scope.project-journal`.
6. **Governed memory:** a producer that writes only through approved, journalled facts.
   Then `memory.no-producer`.
7. **Release readiness** (`docs/product/release-readiness.md`):
   - `bun run release:verify` and `bun run eval:smoke`;
   - a compatibility note covering every new event type;
   - installed-binary replacement only with the maintainer's authorization.

## Independent review

Claude Opus 5.5 is available for independent review of Codex's authority changes when the
maintainer relays them. That review would follow the same method Astra used here: exact
SHA, the diff against the base, adversarial controls written independently, and
pinned-Bun gates. Opus cannot independently review its own commits listed above; those
stay with Astra.
