# DAX Claims and Evidence Pack

**Freeze:** `v1.4.0` — tag object `e4ea252`, commit `494354dc814377be2994292caf4dc577ede0b0b3`.
All line numbers and permalinks below are pinned to that tag. `main` will move; this document will not follow it.

Every claim here was read out of the tagged tree, not out of a design document. Each one carries a boundary line stating what it does *not* prove. The boundary column is not a disclaimer — it is the part that makes the claim worth believing.

## Re-verifying this pack

```bash
git fetch --tags
git rev-parse v1.4.0^{commit}   # 494354dc814377be2994292caf4dc577ede0b0b3
git show v1.4.0:packages/dax/src/execution/native-completion.ts | sed -n '130p'
```

Any line cited below can be read the same way: `git show v1.4.0:<path> | sed -n '<line>p'`.

---

## The seven claims

| # | Claim | Boundary — say this too | Demo |
|---|---|---|---|
| 1 | A model saying "done" is a proposal, not completion | Proves canonical state, verification and expected outputs. Not that the work is semantically correct. | Live |
| 3 | An agent's own account of its work is never evidence | DAX proves what its own verification commands prove. | Live |
| 4 | DAX owns the external agent's process lifetime | No resume. No native Windows. A hard-killed backend reads "running" until the next interaction or `dax recover`. | Live |
| 2 | The harness owns execution state, the model doesn't | One host, one filesystem lock. No multi-host coordination. | Command |
| 5 | Anything unlisted asks instead of running | Egress filtering is cooperative. A worker opening a raw socket is not stopped. Never "secure", never "audited". | Command |
| 6 | DAX records what it cannot prove, and cannot silently improve | Covers conformance invariants, not all unknowns — and nine of the eleven recorded gaps, not all eleven. | CI screenshot |
| 7 | The release is gated and verifiable | Sidecars compile only for the runner's platform; macOS and Windows fall back to the TypeScript path. Hardened, not battle-tested. | Command |

Claims 1, 3 and 4 demo best live — they are the ones a viewer disbelieves until they watch the refusal happen. Claim 6 demos as a red CI run, which is counterintuitive enough to be memorable.

---

### Claim 1 — A model saying "done" is a proposal, not completion

**Statement.** When the provider returns `finish_reason: "stop"`, DAX treats that as a candidate for completion and nothing more. The run reaches `completed` only if a separate completion proof passes against the canonical event log. The conversational session state is deliberately not consulted.

**Why it is checkable.** The refusal is a returned reason code, not a log line. `non_canonical_authority`, `ungoverned_session`, `provider_or_session_error` and `completion_proof:<check>` are all distinguishable outcomes from one adjudication function.

**Demo — live.** Drive a governed run to a model stop with a mutation that has no verification evidence. The run stays open and the decision carries `completion_proof:<failed check>`.

**Demo — command.**
```bash
bun test packages/dax/test/determinism/completion-proof.test.ts
```
Nine cases, five of them named `Fails when …` / `Fails on …`: missing verification for mutations, unevidenced expected outputs, missing artifacts for expected writes, scope violation, unapproved sensitive changes.

**Boundary.** Completion proof proves canonical state, verification and expected outputs. It does not prove the change is semantically correct, or that the tests it ran were good tests.

---

### Claim 3 — An agent's own account of its work is never evidence

**Statement.** The diff DAX reviews is computed by the kernel from the worktree, not reported by the worker. Everything the worker says about itself is stored as conversation and never becomes canonical.

Two labels, and they are not interchangeable. The agent's own reply text is tagged `origin: "external-agent"`. Summaries of the tools it ran are tagged `origin: "external-agent-report"`. Neither supplies canonical mutation evidence — which is the point — but say which is which.

**Why it is checkable.** Ordering is load-bearing and stated in the source: scope check first, mutation receipt second, and the receipt is built from the kernel-computed patch. A patch that escaped its `writeScope` is refused rather than attested.

**Demo — live.** Give a worker a task and have it claim, in chat, that it changed a file it did not touch. The review surface shows the kernel diff; the claim stays beside it as conversation tagged `external-agent`.

**Boundary.** DAX proves what its own verification commands prove. "Kernel-owned diff" is a statement about provenance, not about correctness.

---

### Claim 4 — DAX owns the external agent's process lifetime

**Statement.** The external agent runs in a detached process group that DAX owns end to end. File descriptor 3 is an ownership pipe whose writing end only DAX holds; on parent death the watcher sees EOF and kills the group even if the agent ignores stdin EOF. Teardown escalates TERM → KILL against the group and then confirms the group is actually gone rather than racing the reaping of what it just killed.

**Why it is checkable.** One attempt is one process, sealed with its recorded reason and never replayed. The POSIX `kill -s SIG -- "-$group"` form is used deliberately, because `dash` — `/bin/sh` on Debian and Ubuntu — reads `kill -TERM --` as an illegal pid and would never reap the group.

**Demo — live.** Start a governed AGY conversation, then `kill -9` the DAX process. The agent's process group disappears with it. `ps -o pgid,comm` before and after is the whole demo.

**Boundary.** No resume: a sealed attempt is not replayed. No native Windows — governed AGY conversations refuse to start on `win32`. A backend hard-killed out from under DAX still reads "running" until the next interaction or `dax recover`.

---

### Claim 2 — The harness owns execution state, the model doesn't

**Statement.** Every canonical append runs under a filesystem run lock and passes five gates in order: sequence compare-and-swap, duplicate-command check, envelope validation, reducer validation for authority-bearing event types, then a temp write and an atomic rename. Concurrent producers serialize through `appendRunEventAtTail` instead of racing a sequence read taken before the lock.

**Why it is checkable.** The reducer runs *before* persistence, while the lock is held. Projecting after the write would be too late — the canonical log would already be poisoned. That sequencing is visible in the code, not inferred.

**Demo — command.** Two concurrent appends to the same run; both land, sequence numbers are contiguous, neither is lost. The same command replayed with an identical `commandId` returns the existing event rather than writing a second one.

**Boundary.** One host, one filesystem lock. There is no multi-host coordination and no distributed consensus. Two machines writing the same run directory is out of scope, not defended against.

---

### Claim 5 — Anything unlisted asks instead of running

**Statement.** Policy evaluation is last-match-wins over a merged ruleset, and the fallback when nothing matches is `ask` — not `allow`. Workspace trust, PTY access and config writes are separately gated.

**Demo — command.** Invoke a tool with a permission or pattern no rule covers. The result is an approval request, not an execution.

**Boundary — state this one unprompted.** Egress filtering is **cooperative**. `egressEnforcement` is literally recorded as `"cooperative-proxy"`, and the source says why: "filtered" means a cooperative proxy narrowed egress to the allowlist; enforcement binds a worker that honors the proxy env, not one that opens a raw socket. A refused CONNECT is recorded as `worker_egress_denied` — evidence of an attempted reach, not proof of containment.

Never describe this as "secure" or "audited". Neither word has been earned.

---

### Claim 6 — DAX records what it cannot prove, and cannot silently improve

**Statement.** Eleven conformance gaps are recorded explicitly in `KNOWN_GAPS`, each with a written description of what is missing. Nine of the eleven have a check wrapped in `expectGap`, which inverts the assertion: the check must still fail.

The remaining two — both `integrity.*` — are recorded in prose with no wrapped check behind them. Say "nine enforced, eleven recorded", never "eleven enforced". The difference is the whole claim.

Where a check exists, it buys three properties, and the third is the one worth having:

1. CI is green while the gap is open.
2. A *new* failure — an invariant that used to hold and stopped — is an ordinary red test, because it is not wrapped.
3. A gap that *closes* also turns red, until it is struck from the list.

Property 3 exists for a reason with a date on it: an earlier execution meter stayed green while its source-text approximation and obsolete workflow denominator hid what production could actually prove. An unnoticed fix is a measurement problem, not good news.

**The eleven gaps at v1.4.0.** `Enforced` means a check is wrapped in `expectGap`, so the gap closing turns CI red. `Recorded only` means the entry is prose — nothing fails if it silently closes.

| Gap id | What is missing | Status |
|---|---|---|
| `integrity.contract-immutability-cross-store-race` | Contract mutability authorization and replacement are not one atomic cross-store operation | Recorded only |
| `integrity.event-authority-partial-initialization-recovery` | Zero-event authority state cannot be retried or repaired | Recorded only |
| `inv1.record-classes` | Prompt, context, assistant message, delegation and compaction replacement have no durable event representation (6 of 11 classes covered) | Enforced |
| `inv5.capability-vocabulary` | No capability registry; capabilities are still separate architectural categories | Enforced |
| `inv5.capability-properties` | Capabilities declare no intrinsic properties distinct from contract authority | Enforced |
| `inv5.contract-grants` | Contracts do not express authority as grants against named capabilities | Enforced |
| `inv5.grant-resolution` | Execution paths do not resolve authority through one shared grant lookup | Enforced |
| `scope.journal-primitive` | Journal machinery is not generic over scope; a second scope would copy it | Enforced |
| `scope.aware-envelope` | The envelope carries `runId` only — an event cannot state which scope owns it | Enforced |
| `scope.project-journal` | No project-scoped journal, so facts outliving their run have no authoritative owner | Enforced |
| `memory.no-producer` | Project memory is read every session but no production code writes it | Enforced |

Count it yourself:

```bash
git grep -h "expectGap(" v1.4.0 -- 'packages/dax/src/conformance/*.test.ts' \
  | grep -oE '"[a-z0-9.-]+"' | sort -u
```

Ten ids come back; one of them is `inv9.not-a-real-gap`, a fixture that exercises the unknown-id error path. Nine are real.

**Demo — CI screenshot.** Close a gap locally without striking its entry, and the conformance suite turns red. A green suite that silently absorbed an improvement is the failure mode this prevents.

**Boundary.** This covers conformance invariants. It is not a register of everything DAX does not know. And it covers them unevenly: two of the eleven entries are prose with no wrapped check, so for those two the self-correcting property does not hold — they could close silently, exactly the failure this mechanism exists to prevent. Closing that gap in the gap ledger is tracked work, not a claim.

---

### Claim 7 — The release is gated and verifiable

**Statement.** `release.yml` runs `bun run release:gates` in release mode (`DAX_RELEASE=1`) before any build or upload. That one root command — shared with local release verification, so a tag cannot publish a commit that bypassed it — chains repo integrity, legacy guard, typecheck, lint, tests, smoke evals, Rust fmt/clippy/test and `release:check`. A failing gate stops publication rather than annotating it. Version, changelog entry and clean tree are checked, and the tag must equal HEAD.

The build produces 11 targets (linux arm64/x64, both with musl variants and non-AVX2 fallbacks; darwin arm64/x64; win32 x64), and publishes `SHA256SUMS`, `manifest.json` and `install.sh` alongside them with `fail_on_unmatched_files: true`.

**Demo — command.**
```bash
DAX_RELEASE=1 bun run release:verify     # same gate chain, in the same mode, the tag runs
```
`DAX_RELEASE=1` is not optional for a faithful demo. The workflow sets it ([release.yml#L57-L58](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/.github/workflows/release.yml#L57-L58)), and it is what turns on the release-mode checks — clean tree, tag equals HEAD, version equals changelog. Without it the same command runs a weaker gate chain and reports success for a state the tag would have rejected.

Then check any published asset against the published `SHA256SUMS`.

**Boundary.** Rust sidecars compile only for the *host* target of the release runner — `isHostTarget(item) ? RUST_SIDECAR_BINARIES : []`, with an explicit `no Rust sidecars for <name>: not the host target` warning for the rest. macOS and Windows builds therefore fall back to the TypeScript path. CI and release were both green on `494354d`. Hardened, not battle-tested.

---

## Tamper evidence spans three places

This is one claim's worth of substance split across three implementations; do not describe it as a single mechanism.

| Layer | Where | What it does |
|---|---|---|
| Rust ledger | `crates/dax-ledger/src/chain.rs` | `canonical_json`, `append`, `verify_chain`; golden test in `tests/chain_golden.rs` |
| TypeScript RAO chain | `packages/dax/src/pm/index.ts` | Digest covers the whole record, not the payload alone; rows written before chaining existed have null digests and are reported as such. Verified by `dax verify audit` |
| Flowright evidence export | `packages/dax/src/flowright/evidence-export.ts` | `prevDigest` chaining across exported evidence |

---

## Evidence appendix — permalinks pinned to v1.4.0

| Claim | Evidence | Link |
|---|---|---|
| 1 | "Treats a provider stop as a proposal to complete, never as completion itself" | [native-completion.ts#L39-L43](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/execution/native-completion.ts#L39-L43) |
| 1 | `non_canonical_authority` rejection | [native-completion.ts#L67](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/execution/native-completion.ts#L67) |
| 1 | `requirePassingCompletionProof: true` on the transition to `completed` | [native-completion.ts#L130](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/execution/native-completion.ts#L130) |
| 1 | `RunCompletionBlockedError` → `completion_proof:<check>` reason codes | [native-completion.ts#L132-L139](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/execution/native-completion.ts#L132-L139) |
| 1 | Proof enforcement point | [run-lifecycle.ts#L125-L128](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/state/run-lifecycle.ts#L125-L128) |
| 1 | Determinism suite | [test/determinism/completion-proof.test.ts](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/test/determinism/completion-proof.test.ts) · [src/execution/completion-proof.test.ts](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/execution/completion-proof.test.ts) |
| 2 | Sequence compare-and-swap (`StaleAppendError`) | [run-event-store.ts#L78-L80](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/state/events/run-event-store.ts#L78-L80) |
| 2 | Duplicate-command check | [run-event-store.ts#L82-L95](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/state/events/run-event-store.ts#L82-L95) |
| 2 | Write-side envelope validation | [run-event-store.ts#L110-L113](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/state/events/run-event-store.ts#L110-L113) |
| 2 | Reducer check before persistence, under lock | [run-event-store.ts#L115-L128](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/state/events/run-event-store.ts#L115-L128) |
| 2 | Temp write → atomic rename | [run-event-store.ts#L131-L132](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/state/events/run-event-store.ts#L131-L132) |
| 2 | `appendRunEventAtTail` serializes concurrent producers | [run-event-store.ts#L156-L185](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/state/events/run-event-store.ts#L156-L185) |
| 3 | Kernel-computed diff; the worker's own account is never consulted | [worker-run.ts#L394-L396](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/workflows/worker-run.ts#L394-L396) |
| 3 | Scope check before attestation | [worker-run.ts#L400-L403](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/workflows/worker-run.ts#L400-L403) |
| 3 | Mutation receipt built from the kernel diff | [worker-run.ts#L406-L414](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/workflows/worker-run.ts#L406-L414) |
| 3 | AGY reply text tagged `external-agent` | [antigravity-conversation.ts#L489-L495](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/worker/antigravity-conversation.ts#L489-L495) · streamed at [#L329-L334](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/worker/antigravity-conversation.ts#L329-L334) |
| 3 | AGY tool-activity summaries tagged `external-agent-report` | [antigravity-conversation.ts#L311-L319](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/worker/antigravity-conversation.ts#L311-L319) |
| 4 | fd 3 ownership pipe | [antigravity-process.ts#L14-L15](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/worker/antigravity-process.ts#L14-L15) |
| 4 | POSIX `kill -s SIG --` group kill, with the `dash` rationale | [antigravity-process.ts#L17-L23](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/worker/antigravity-process.ts#L17-L23) |
| 4 | `processGroupGone` — confirm, don't race the reaper | [antigravity-process.ts#L27-L30](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/worker/antigravity-process.ts#L27-L30) · [#L130-L132](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/worker/antigravity-process.ts#L130-L132) |
| 4 | Windows refusal; detached group | [antigravity-process.ts#L48](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/worker/antigravity-process.ts#L48) · [#L52](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/worker/antigravity-process.ts#L52) |
| 5 | `ask` fallback when no rule matches | [policy-engine.ts#L59-L65](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/governance/policy-engine.ts#L59-L65) |
| 5 | Cooperative egress, stated precisely in source | [worker-run.ts#L370-L375](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/workflows/worker-run.ts#L370-L375) |
| 5 | `worker_egress_denied` records attempted reach | [worker-run.ts#L378-L385](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/workflows/worker-run.ts#L378-L385) |
| 6 | Why the ledger exists; the three properties | [known-gaps.ts#L1-L25](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/conformance/known-gaps.ts#L1-L25) |
| 6 | The 11 recorded gaps | [known-gaps.ts#L27-L42](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/conformance/known-gaps.ts#L27-L42) |
| 6 | `expectGap` inverts the assertion | [known-gaps.ts#L53](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/conformance/known-gaps.ts#L53) |
| 7 | `release:gates` runs before build and upload, in release mode | [release.yml#L50-L58](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/.github/workflows/release.yml#L50-L58) |
| 7 | The gate chain itself | [package.json#L34-L35](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/package.json#L34-L35) |
| 7 | 11 build targets | [build.ts#L68-L78](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/script/build.ts#L68-L78) |
| 7 | Host-only sidecars | [build.ts#L196-L200](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/script/build.ts#L196-L200) |
| 7 | `SHA256SUMS`, `manifest.json`, `install.sh` published | [release.yml#L80-L89](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/.github/workflows/release.yml#L80-L89) |
| — | Rust ledger chain | [chain.rs#L6](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/crates/dax-ledger/src/chain.rs#L6) · [#L60](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/crates/dax-ledger/src/chain.rs#L60) · [#L77](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/crates/dax-ledger/src/chain.rs#L77) |
| — | `dax verify audit` | [verify.ts#L77-L82](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/cli/cmd/verify.ts#L77-L82) |
| — | Flowright `prevDigest` | [evidence-export.ts](https://github.com/ShaileshRawat1403/dax/blob/v1.4.0/packages/dax/src/flowright/evidence-export.ts) |

---

## Words this pack does not use

- **secure** — egress enforcement is cooperative; no third party has attacked this.
- **audited** — no external audit has happened.
- **battle-tested** — hardened, single-maintainer, not run at scale.
- **guaranteed** — every claim above has a boundary, and the boundary is part of the claim.
