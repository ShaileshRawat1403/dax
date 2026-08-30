---
title: Harness Comparative Baseline
archetype: architecture-analysis
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 1.0.0
tags:
  - dax
  - agent-harness
  - deepseek-harness
  - architecture
  - baseline
  - governance
last_reviewed: 2026-08-18
---

# Harness Comparative Baseline

## Purpose

This is the H0 deliverable of the DAX harness evolution roadmap. It establishes a comparative baseline between DAX v1.3.0 and DeepSeek Harness `dsh` 0.1.0-rc.7 (the user's fork at `99f6f02`, `master`) **before any runtime change is proposed**.

Both systems were traced through one identical bounded scenario using their actual source code. Every claim below carries a `file:line` reference into the working tree it describes:

- DAX v1.3.0 = this repository, tag `v1.3.0` == `main` == `73910aa`.
- DeepSeek Harness = fork of `deepseek-harness`, shallow-cloned at `99f6f02` for inspection only. DAX gains no dependency on it.

This document feeds the H1 (canonical runtime truth) and H2 (governed tool protocol) workstreams. It does not change the DAX runtime.

## Product Boundary

DAX remains the governed execution authority for AI-assisted software work. Borrowed mechanisms must enter DAX's lifecycle:

```text
Intent
→ context compilation
→ execution contract
→ native agent or governed worker
→ mediated tools
→ canonical events
→ verification
→ evidence
→ operator decision
```

They must not create a second execution authority or weaken RAO, execution contracts, completion proof, or the Rust proof ladder.

## Frozen Comparison Scenario

One scenario is run against both harnesses. It is deliberately small so the two traces are comparable rather than bespoke:

```text
1.  Intent        The operator states an intent (a bounded change in one repo).
2.  Context       The harness assembles the model-visible context from durable sources.
3.  Model request The harness issues exactly one model request that plans the change.
4.  Read action   The model performs exactly one read action against the repo.
5.  Write action  The model performs exactly one write action against the repo.
6.  Approval gate The write action crosses an approval gate that pauses execution.
7.  Verification  The harness verifies the change independently (where it has one).
8.  Interruption  The run is forcibly interrupted or fails mid-flight.
9.  Recovery      The harness resumes or classifies the interrupted run.
10. Inspection    The durable record is read back and must reconstruct the run.
```

Failure injections for denial, cancellation, and interruption are recorded per stage where the harness has a defined behavior.

---

## DAX v1.3.0 Trace

### 1. Intent

The operator intent is compiled into an execution contract and the run is created.

- `packages/dax/src/execution/run-factory.ts:185-201` — `compileWithRunId`, `writeContract`, then for an event-authority run: `createEventAuthorityRun(session.id, contract.contractId)`.
- `packages/dax/src/state/events/event-transitions.ts:18-27` — `createEventAuthorityRun` sets run authority to `event-log` and appends the first event:

```text
event { seq: 0, type: "contract_compiled", payload: { contractId } }
```

For legacy runs the parallel branch writes `RunStore.create` + `Transitions.transition(... "contract_compiled")` (`run-factory.ts:204-215`) — a *separate* vocabulary, see [Where DAX Uses Adapters and Parallel State Vocabularies](#where-dax-uses-adapters-and-parallel-state-vocabularies).

### 2. Context

The execution contract carries the intent plus runtime policy (`writeScope`, `forbiddenPaths`, `verification`, `egress`, provenance). Operator-facing context is assembled as a bounded context pack.

- `packages/dax/src/context/build-context-pack.ts:35-49` — `CONTEXT_LIMITS` caps findings/hypotheses/questions/risks/artifacts/nextActions/importantFiles.
- `packages/dax/src/context/build-context-pack.ts:57` — `buildContextPack(sessionState, taskId, operator)` assembles the operator pack.
- The worker contract is refined at execution time from `contract.intent` + `runtimePolicy` (`packages/dax/src/workflows/worker-run.ts:296-300`) and recorded as `contract_refined` before any provider call (`worker-run.ts:304-311`).

### 3. Model request

DAX issues the model request by invoking a governed external worker (provider adapter) against a disposable checkout.

- `packages/dax/src/workflows/worker-run.ts:318-330` — `buildProviderInvocation` then `WorkerRunEffects.current.runWorker(invocation, checkout.path)`.
- `packages/dax/src/workflows/worker-run.ts:90-137` — `runSandboxedCommand` with seatbelt/bubblewrap containment, egress proxy, and timeout.
- Native (non-worker) sessions issue the model request in `packages/dax/src/session/processor.ts:164` — `LLM.stream({ ... })`.

### 4. Read action

Inside the worker run the model reads the repo through the provider's own tooling, confined by the sandbox. DAX applies a read allow + deny-list for credential stores.

- `packages/dax/src/worker/worker-sandbox.ts:90-105` — global `file-read*` allow layered with `deny file-read*` on exfiltration targets.
- For native sessions the `read` tool performs a permission ask before reading: `packages/dax/src/tool/read.ts:22-49`.

Durable record: DAX records **no per-read event** in the run event log. Reads are not individually observable; the sandbox summary is recorded once per run (see stage 5).

### 5. Write action

The worker writes only inside the checkout; the kernel computes the diff from the checkout.

- `packages/dax/src/worker/worker-sandbox.ts:80-88` — writable surface is `checkout + worker-state`, `file-write*` confined to subpaths.
- `packages/dax/src/workflows/worker-run.ts:128-150` — `computeDiff` stages the checkout and returns `{ content, changedPaths }`; invoked at `worker-run.ts:363`.
- The sandbox summary is recorded after the worker exits:
  - `packages/dax/src/workflows/worker-run.ts:330-346` — `appendEventOnly("worker_sandbox_recorded", { provider, filesystem: "checkout-write-only", network, egress, ... })`.
  - `packages/dax/src/workflows/worker-run.ts:347-355` — `appendEventOnly("worker_egress_denied", { hosts })` when a CONNECT was refused.

For native sessions the `edit`/`write` tools ask for the `edit` permission before mutating (`packages/dax/src/tool/edit.ts:55,87`), classified by `packages/dax/src/tool/tool-class.ts:44-59`.

### 6. Approval gate

DAX pauses the run in a `waiting_approval` state and requires an explicit operator decision.

- `packages/dax/src/workflows/worker-run.ts:469-505` — `executeRequestApproval`: creates the approval via `ApprovalTransitions.create`, adds the step, then `HybridTransitions.transition(runId, "waiting_approval", "approval_required")`.
- `packages/dax/src/approval/approval-transitions.ts:64-110` — approval object persisted to the approval store and published via lifecycle bus (`ApprovalRequested`, `InterventionRequired`).

Durable record:
- `packages/dax/src/state/events/event-transitions.ts:131-133` — `approval_requested { approvalId, approvalType: "tool", risk: "medium" }` (via `HybridTransitions.addApproval`).
- Resolution: `packages/dax/src/state/events/event-transitions.ts:140-141` — `approval_resolved { approvalId, decision: "approved" | "rejected" }`.

Note the approval object itself lives in a **separate approval store** (`ApprovalStore`), not in the run event log — see the adapters section.

### 7. Verification

DAX verifies independently of the model, and records evidence receipts.

- `packages/dax/src/workflows/worker-run.ts:409-445` — `executeVerifyWorkerPatch` runs `verifyWorkerPatch` against the checkout.
- `packages/dax/src/worker/worker-verification.ts:105-131` — runs each check and builds receipts.
- `packages/dax/src/sdlc/evidence-receipt.ts:20-36` — `createEvidenceReceipt` = sha256 digest of the check result + randomUUID.
- Durable record: `worker-run.ts:425-431` — `appendEventOnly("verification_recorded", { status, receipts, checks })` then `artifact_created`. The reducer marks completion proof (`packages/dax/src/state/events/run-reducer.ts:319-336`), and `run_completed` is refused without verification evidence (`run-reducer.ts:373-382`).

### 8. Interruption / failure

- Timeout or non-zero exit: `worker-run.ts:356-364` throws, then `worker-run.ts:463-466` — `HybridTransitions.transition(runId, "failed", "run_failed", ...)`.
- Sandbox/egress evidence is recorded *before* the failure throw so the operator sees what was left behind (`worker-run.ts:330-355`).
- Approval denial: `worker-run.ts:502` — `transition(runId, "failed", "approval_denied")`.
- Cancellation of a native session: provider stall timeout at `packages/dax/src/session/processor.ts:164-183`.

### 9. Recovery

Recovery is **decision-only**; DAX classifies rather than auto-replays the worker.

- `packages/dax/src/state/events/recovery.ts:18-90` — `evaluateRecovery`: `waiting_approval → remain_paused`, `completed/failed/cancelled → immutable`, `running → resume`, `queued/compiled → retry`, else `invalid`.
- `packages/dax/src/state/events/recovery.ts:92-105` — event-authority runs only; legacy runs skip evaluation.

### 10. Inspection of the durable record

- `packages/dax/src/state/events/run-event-store.ts:42-103` — `appendRunEvent`: append-only `events.json`, `expectedSeq` check (`StaleAppendError`), `commandId` dedup (`DuplicateCommandError`), fs lock, atomic temp+rename.
- `packages/dax/src/state/events/event-transitions.ts:70-76` — `projectRunStateFromEvents` replays the reducer.
- `packages/dax/src/state/events/run-reducer.ts:185-399` — the projection switch.
- `packages/dax/src/state/events/recovery.ts:92-105` — inspection is the recovery input.

---

## DeepSeek Harness Trace

Fork inspected at `99f6f02` (shallow clone under the opencode temp dir). Package paths below are relative to the fork root.

### 1. Intent

The operator message is appended to the session log, then a turn is opened.

- `packages/core/agent-loop/src/agent.ts:255` — `this.session.append("turn/start", { turn })`.
- `packages/core/session/src/index.ts:564` — next seq is always log length (`seq = log.length` contiguity contract).

Durable record: `turn/start` is the first event of the turn; `user/message` events are appended inside the step (`agent.ts:279-283`).

### 2. Context

Context is derived from the durable session log plus system-prompt capability sections, assembled per request.

- `packages/core/agent-loop/src/agent.ts:230-233` — `assembleContextFor` → `renderContextSections` → `joinContextSections`.
- `packages/core/agent-loop/src/agent.ts:337-343` — `renderPrompt` + `BlockAssembler` for the tool blocks.
- `packages/core/agent-loop/src/agent.ts:466-482` — the assembled `request/header` and `request/context` are appended to the log *before* the LLM call:

```text
event { type: "request/header", data: { header, reason: "initial" | "resume" | "change" } }
event { type: "request/context", data: { provider, model, contextWindow } }
```

### 3. Model request

- `packages/core/agent-loop/src/agent.ts:466-490` — header/context appended, then `deepFreeze` request with `boundaryMessages` + `system` + `tools`, dispatched as the step's LLM call.
- Request is derived from the session log (step-boundary input), so the log is the only request source.

### 4. Read action

- `packages/fs/tool-fs/src/read.ts:69-162` — `applyReadTool` registers `read`; execute performs one provider stat for type/routing/version, streams large files, renders a bounded window.
- `packages/fs/tool-fs/src/read.ts:162` — `ctx.emit("fs/observed", target, { kind: "present", version: info.version }, exec)`.

Durable record:
- `packages/core/agent-loop/src/tool-calls.ts:263` — `session.append("tool/call", { turn, step, callId, name, arguments })` — logged **before** dispatch.
- `packages/core/agent-loop/src/tool-calls.ts:281-291` — `session.append("tool/result", { turn, step, message, error?, meta? }, { sourceEventSeqs: [callSeq] })`.

### 5. Write action

- `packages/fs/tool-fs/src/write.ts:111` — `ctx.waterfall("fs/write-intent", target, exec, () => undefined)` — a single-slot intent policy (create-if-absent / replace-if-version) evaluated *before* the write; no policy → unconditional atomic create-or-overwrite.
- `packages/fs/tool-fs/src/write.ts:114-118` — `ctx.fs.writeText(target, content, intent, exec.signal, sandboxPolicy)`; sandbox denial is mapped to the shared `[sandbox: …]` marker.
- `packages/fs/tool-fs/src/write.ts:122` — `ctx.emit("fs/observed", target, { kind: "present", version: outcome.version }, exec)`.

Durable record: the same `tool/call` + `tool/result` pair as the read action (`tool-calls.ts:263,281`); `fs/observed` is a live observation emitted by the tool, persisted via the tool result envelope.

### 6. Approval gate

Approval is a `tools/pre-execute` decision that blocks the call until an explicit decision, and is **turn-enclosed**.

- `packages/core/tools/src/index.ts:1476-1480` — pre-execute waterfall; on `{ kind: "ask" }` → `serviceAsk`.
- `packages/core/tools/src/index.ts:1689-1728` — `serviceAsk` routes through `approval.request`; fail-closed `deny` when no approval channel, no agent, or outcome `unavailable`/`cancelled`.
- `packages/interaction/user-approval/src/index.ts:255-276` — `request()`:
  - Precondition `hasOpenTurn` (`index.ts:121-133`): the pair must be inside an open `turn/start…turn/end`; outside a turn it throws (the event would be indistinguishable from crash-tail garbage).
  - `session.append("approval/asked", { id, toolName, callId?, reason? })`.
  - `session.append("approval/decided", { id, outcome })` — always follows, log-only audit.

Failure injection: an ask with no available channel resolves to `"unavailable"` and the call is denied (`index.ts:320-328`, fail-closed normalize of rogue answerer returns).

### 7. Verification

DeepSeek has **no independent verification stage**. Tool outcomes are durable and reconstructable (`tool/result` with `sourceEventSeqs`), but there is no separation between the model's claim and a harness-computed check. Verification is the model's own shell loop. This is a gap relative to DAX.

### 8. Interruption / failure

- Abort: `packages/core/agent-loop/src/agent.ts:315-319` — `turn/end { turn, reason: { kind: "aborted", reason: signal.reason } }`.
- Started calls are drained; unstarted calls receive synthetic error results so replay stays valid (`packages/core/agent-loop/src/tool-calls.ts:9-16` and the abort branch in the scheduler).
- Scheduler failure preserves recorded `tool/call` events without fabricating results (`tool-calls.ts:9-16`).

### 9. Recovery

Recovery repairs the log deterministically, then resumes the agent loop.

- `packages/session/session-persistence/src/coordinator.ts:896-945` — on load, `interruptedTurnClosers(storedEvents)` builds synthetic closers, then `commitRepair` truncates the torn tail and appends closers.
- `packages/core/session/src/repair.ts:27-65` — `interruptedTurnClosers`: an open tail turn gets (1) unmatched `tool/call`s closed with `TOOL_NOT_STARTED`/`TOOL_OUTCOME_UNKNOWN` error results (`repair.ts:13-16`), (2) an open `step/end`, (3) an interrupted `turn/end`. A balanced or empty log yields nothing.
- `packages/session/session-persistence/src/coordinator.ts:1061-1067` — `assertEventsSupported` refuses to interpret a log containing an event type unknown to this build (unless `ignorable === true`), pointing at the raw artifact.

### 10. Inspection of the durable record

- `packages/core/session/src/index.ts:425-564` — `Session` seeds from the stored log; seq contiguity from 0 is enforced on seed (`index.ts:512-526`).
- `packages/session/session-persistence/src/coordinator.ts:330-345` — legacy shape migrations applied on read.
- `packages/core/session/src/invariant.ts:60-163` — invariant checks on append (strictly increasing seq; tool events turn-enclosed; `tool/result` surface append inside an open turn).
- `packages/core/session/src/known-event-types.ts:19-64` — 44 known event types; unknown types refuse interpretation at load (coordinator.ts:1063).

---

## Where DAX Has One Source of Truth

Within the **event-authority run path** only, DAX has a single append-only durable spine:

- One `events.json` per run, seq-contiguous from 0, fs-locked, atomic rename (`run-event-store.ts:42-103`).
- One reducer projects state deterministically (`run-reducer.ts:185-399`).
- One recovery evaluator reads that projection (`recovery.ts:18-90`).
- The `contract_compiled` event is the run's birth record (`event-transitions.ts:18-27`), and completion is gated on verification evidence in the same log (`run-reducer.ts:373-382`).

This is the authority model the roadmap wants to generalize: **event-log is the run's only source of truth**.

## Where DAX Uses Adapters and Parallel State Vocabularies

Outside the event-authority branch, and at several seams inside it, DAX keeps parallel or adapter-mediated vocabularies:

1. **Legacy vs event-log runs** — `packages/dax/src/state/hybrid-transitions.ts:18-98` branches every transition on `isEventAuthorityRun(runId)`. Two implementations of the same lifecycle (`Transitions.*` vs `*Event`) are both live.
2. **The `type as any` bypass** — `packages/dax/src/state/events/event-transitions.ts:54` and `:92` both cast `eventType as any` into `appendRunEvent`; `packages/dax/src/state/replay.ts:55` reads events back through the same untyped escape. `worker_run` therefore writes event types that are **not** in the closed `RunEventType` union (`run-event-types.ts:1-21`): `contract_refined`, `worker_sandbox_recorded`, `worker_egress_denied` — the union lists only `worker_sandbox_recorded` and `verification_recorded` (as of this snapshot, `contract_refined` and `worker_egress_denied` are absent).
3. **Native runs emit no run events per tool call** — non-worker sessions stream through `processor.ts:164` with no per-tool run-event emission; run events only exist on the event-authority workflow path.
4. **Approval object vs approval events** — the approval record lives in `ApprovalStore` (`approval-transitions.ts:64-110`) while `approval_requested`/`approval_resolved` events are a projection of that store into the event log (`event-transitions.ts:131-141`). The store is the authority; the events are derived.
5. **Worker evidence vs reducer vocabulary** — `contract_refined`, `worker_sandbox_recorded`, `worker_egress_denied` are evidence events that the reducer ignores (they appear in no reducer case); they exist for audit but do not project into `RunState`.
6. **Session vs run** — the session layer (messages, `processor.ts`) and the run layer (events, `run-store.ts`) are distinct vocabularies bridged by `run-factory.ts`.

Net effect: DAX's strongest invariant (one append-only run spine with deterministic projection) is *real but not universal*. DeepSeek's strongest invariant is universal by construction.

## Exact Invariant Protected by DeepSeek

DeepSeek protects one invariant everywhere:

> **The session event log is the state.** Every model-visible input, every runtime action, every approval, and every outcome is a contiguous, turn-enclosed, append-only log; state is a deterministic read of that log; an unreadable log is refused rather than guessed.

Enforced by:

- seq = log length, contiguous from 0, enforced on append and on seed (`index.ts:512-526,564`; `invariant.ts:60`).
- Tool events and approvals must be **turn-enclosed** — a bare event between turns is treated as crash-tail garbage (`invariant.ts:130-154`; `user-approval/index.ts:255-268`).
- Unknown event types **fail closed** on load unless marked `ignorable` (`coordinator.ts:1056-1067`).
- Torn tails are **repaired deterministically**, never reinterpreted (`repair.ts:25-63`; `coordinator.ts:896-945`).
- Approval is fail-closed: no channel → deny (`tools/index.ts:1689-1728`).
- Tool executions are frozen before publication (`tools/src/invariant.ts:23-28`).
- Results cite their call event via `sourceEventSeqs` (`tool-calls.ts:281-291`).

This invariant is the reference for H1. DAX already defends a version of it inside the event-authority path; the baseline finding is that it is not yet enforced across session, native tools, and workers.

---

## Adopt / Adapt / Defer / Reject

One decision per meaningful difference. "Adopt" = bring the mechanism into DAX as-is; "Adapt" = adopt after changing to DAX's contract/proof model; "Defer" = value is real but not now; "Reject" = contradicts DAX intent.

| # | Difference | DeepSeek mechanism | DAX equivalent | Decision | Note |
| --- | --- | --- | --- | --- | --- |
| 1 | Universal log-is-state | One session event log for prompts, tools, approvals, outcomes | Event-log run spine (event-authority only) | **Adapt** | Generalize the run spine to session + native + worker via H1; keep DAX contract/verification gates |
| 2 | Turn-enclosed core events | `turn/start…turn/end` bracket every model-visible append | Steps bracket workflow actions but not native tool calls | **Adopt** | Bounded scenario stage 8/9: interruption must produce a deterministically closed run/session boundary |
| 3 | `seq = log.length` + contiguous seed | Enforced on append and seed | `expectedSeq` check in `appendRunEvent` | **Adopt** | DAX already has it for run events; extend the same check to every canonical event surface |
| 4 | Fail-closed unknown event types on load | `assertEventsSupported` refuses unknown types | Reducer silently ignores evidence-only events; `type as any` writes out-of-union types | **Adopt** | Close the `type as any` bypass; refuse or version unknown types at read |
| 5 | Deterministic torn-tail repair | `interruptedTurnClosers` + `commitRepair` | Decision-only recovery; no tail repair | **Adapt** | Repair must preserve DAX's verification/completion gates, not just log shape |
| 6 | Tool call logged before dispatch | `tool/call` then `tool/result` with `sourceEventSeqs` | Worker sandbox/egress evidence logged after exit; native tools not run-logged | **Adapt** | H2: log the call before execution for native + worker tools; keep sandbox evidence |
| 7 | Approval as paired in-log events | `approval/asked` + `approval/decided`, turn-enclosed | Approval record in separate store; derived events in log | **Adapt** | Keep the store for RAO queries, but make the log the authority for replay (H1) |
| 8 | Fail-closed approval channel | no channel → deny | Approval always mediated by store + bus | **Adopt** | Preserves DAX approval semantics; matches current intent |
| 9 | Independent verification | none | `verification_recorded` + receipts gate completion | **Reject (reverse)** | DAX's independent verification is the strong side; do not regress to model-only verification |
| 10 | `fs/observed` versioned observation | tool emits observed version; guarded writes re-check in-lock | Sandbox write allow + kernel diff; no per-file observed version | **Defer** | Versioned observations are valuable for concurrent/write-conflict cases (H2/H4), not for the H0 scenario |
| 11 | Frozen results before publication | tools invariant freezes result | Tool result is a structured TS shape without universal freeze | **Defer** | H2 output schemas + immutable observations; not blocking H1 |
| 12 | Contiguous context as request source | request/header + request/context in log | Context pack is bounded but not per-request logged | **Adapt** | H1: log a request/context-equivalent so model-visible context is reconstructable |
| 13 | Torn-tail closers reuse timestamps | deterministic synthetic closers | n/a | **Adopt** | Cheap; directly strengthens stage 8/9 |
| 14 | Provider adapters as scope seams | capability/scope registration on ctx | External workers via adapters | **Defer** | Aligns with H3; do not widen scope in H0 |
| 15 | Rust only for deterministic proof boundaries | n/a (DeepSeek is TS) | Rust replay/policy/ledger crates | **Reject** | Keep roadmap guardrail: Rust for proof boundaries, not portability |

Scoring summary for the frozen scenario:

| Stage | DAX | DeepSeek |
| --- | --- | --- |
| Intent | equivalent | equivalent |
| Context | partial (bounded but not logged per request) | leading (log-derived) |
| Model request | equivalent | equivalent |
| Read action | partial (not individually logged) | leading (tool/call + tool/result) |
| Write action | partial (sandbox summary only) | leading (intent + observed version + pair) |
| Approval gate | leading (store + events + paused state) | equivalent (paired in-log, turn-enclosed) |
| Verification | leading (independent receipts) | absent |
| Interruption | partial (evidence preserved, no boundary close) | leading (synthetic close + drain) |
| Recovery | partial (decision-only) | leading (deterministic tail repair) |
| Inspection | equivalent (event-store read + projection) | leading (seed contiguity + fail-closed read) |

---

## H1 Canonical-Event Acceptance Tests

These tests define when H1 is done. They are written against the *current* runtime as failing expectations; H1 makes them pass without changing DAX's product contract.

```text
T1  Projection conformance
    Given the same event log, projectRunStateFromEvents and every public
    projection (approval, worker evidence, completion proof) agree.
    Failing now: worker evidence events (contract_refined, worker_sandbox_recorded,
    worker_egress_denied) project nowhere.

T2  Closed event vocabulary
    Every append path writes a type in the RunEventType union; no `as any` cast
    is reachable from a production emit site.
    Failing now: event-transitions.ts:54 and :92; replay.ts:55 reads back untyped.

T3  Source-of-truth per surface
    For a completed run, the effective model context and consequential execution
    history are reconstructable from durable records alone.
    Failing now: native sessions emit no run events per tool call; context packs
    are not request-logged.

T4  Approval replay
    Replaying an event log reproduces the same pending/resolved approval set as
    the ApprovalStore.
    Failing now: approvals are store-authoritative, not log-authoritative.

T5  Interrupted boundary close
    A forced interruption produces a deterministically closed run/session
    boundary with no in-flight ambiguity on reload.
    Failing now: no synthetic closer for interrupted runs (recovery is decision-only).

T6  Unknown-type refusal
    Loading a log containing an unknown (unversioned) event type fails closed
    with the artifact location, rather than silently projecting partial state.
    Failing now: evidence-only types are ignored by the reducer.
```

## H2 Governed Tool-Protocol State Machine

Every consequential tool (native, plugin, workflow action) transitions through one protocol:

```text
admitted
  → input validated            (schema; malformed input rejects)
  → contract & policy          (execution contract, risk class, path zones)
  → approval                   (explicit decision; fail-closed when channel absent)
  → guards (monotonic)         (later stages cannot weaken)
  → wrappers                   (pre/post around execution)
  → execute                    (call logged before execution)
  → post-policy                (output schema validation)
  → finalize                   (immutable observation)
  → result                     (published with source event reference)
```

Acceptance tests for H2:

```text
P1  Equivalent tool requests receive equivalent governance regardless of entry
    surface (native tool, plugin tool, workflow action, worker tool).
P2  Malformed outputs cannot enter context, evidence, or projections as valid
    observations.
P3  A denied or cancelled approval leaves an immutable audit record in the log.
P4  A tool execution is logged before dispatch; its result cites the call event.
P5  Cancellation and timeout are stable: started calls drain, unstarted calls
    receive synthetic error results, replay stays valid.
P6  Monotonic guards: a later guard or post-policy stage cannot weaken an
    earlier allow/deny.
P7  Immutable final observations: results are frozen before publication.
```

## Non-Goals

- No DAX runtime code changes in this workstream (H0 is documentation-only).
- No dependency on DeepSeek Harness or Cordis in DAX.
- No rewriting of DAX in Rust; Rust remains for deterministic proof boundaries.
- No migration of DAX run authority into a plugin, model, provider, or companion product.
- No per-file write-conflict observation machinery yet (deferred to H2/H4).
- No subagent/continuation runtime (H5 scope) in this baseline.
- No change to RAO approval semantics, completion proof, or the Rust proof ladder.
- No feature parity with every coding agent; the baseline exists to prevent architecture-by-imitation.

## Method and Reproducibility

- Scenario is frozen in [Frozen Comparison Scenario](#frozen-comparison-scenario) and does not change between workstreams.
- DAX references resolve against tag `v1.3.0` == `73910aa` in this repository.
- DeepSeek references resolve against fork `99f6f02` (`master`). Re-inspection is a shallow clone of `https://github.com/ShaileshRawat1403/deepseek-harness`.
- Every observation above was taken from actual source at those revisions, not from docs alone.

## Related Documents

- [DeepSeek Harness Comparative Study](./DEEPSEEK_HARNESS_COMPARISON.md)
- [DAX Harness Evolution Roadmap](../roadmap/DAX_HARNESS_EVOLUTION.md)
- [DAX Execution Model](./DAX_EXECUTION_MODEL.md)
- [DAX Event-Driven Lifecycle](./DAX_EVENT_DRIVEN_LIFECYCLE.md)
- [Rust Proof Ladder](./RUST_PROOF_LADDER.md)

---

## Addendum: what changed after H0

This document is a dated record of DAX at `v1.3.0`, kept as written so the H0
evidence stays intact. The trace below it describes a tree that no longer exists
in several respects. Recorded here rather than edited in place, because a
baseline that quietly tracks the present cannot be used to measure movement away
from the past.

### Claims that were wrong when written

- **Finding 2 undercounted the out-of-union event types.** It named three; there
  were four. `approval_required` and `approval_resumed` were also written through
  the `as any` cast, reaching the log via the third argument of
  `HybridTransitions.transition` — which was the event type, not a label. Missing
  them meant the closed-vocabulary work was scoped one seam too narrow.

- **"`run_completed` is refused without verification evidence" was too strong.**
  `governance.verification.required` was set in exactly one place — inside the
  `verification_recorded` reducer case — so the gate was circular. It constrained
  runs that had already verified; a run that never verified was never required
  to. The stated property was aspirational, not implemented.

### Findings since closed

| Finding | Status |
|---|---|
| Closed event vocabulary, `as any` bypass | Closed. `RUN_EVENT_TYPES` is the single source; the append path is generic over the payload union. |
| Legacy vs event-log dual lifecycle | Closed. `hybrid-transitions.ts` and `transitions.ts` are gone; `RunLifecycle` is the only implementation and all five workflow classes are event-authority. |
| Approval store authoritative, log derived | Closed for replay. The event carries what the operator was shown and who decided; the store is a projection. |
| Worker evidence projecting nowhere | Closed. `contract_refined`, `worker_sandbox_recorded` and `worker_egress_denied` project into `RunState.evidence`. |
| Circular completion gate | Closed. The requirement rides on `contract_compiled`, and mutation independently obliges evidence. |
| Native sessions emit no run events per tool call | Closed. Native execution durably records invocation, pre-effect authorization, terminal result, mutation evidence and completion adjudication. |

### Findings the H0 trace did not reach

Three governance defects surfaced only once the dual path was removed, and none
were visible while both lifecycles coexisted:

1. `HybridTransitions.transition` silently dropped its payload on the legacy
   branch, so a failing transition reached `failed` with no reason attached.
2. `RunStore.get` was not authority-aware while `getProjectedRunState` was and had
   no callers — eight production readers would have returned `null` for
   event-authority runs.
3. `guardEnforcementMode` was persisted only on the legacy run row. Retiring that
   row would have silently degraded enforcement to `warn` everywhere.

The general lesson is worth keeping for H2: a comparative trace reads what the
code says it does. It does not reveal what breaks when a redundant path is
removed, because redundancy is exactly what hides the breakage.

### Where the invariants live now

The six invariants this baseline fed into are executable, not prose:
`packages/dax/src/conformance/`. Open gaps are recorded in `known-gaps.ts` and
wrapped so that CI is green while a gap is open and red when one closes
unrecorded. Consult those over this document for current state.
