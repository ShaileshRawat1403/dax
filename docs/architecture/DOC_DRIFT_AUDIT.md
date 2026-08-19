---
title: Documentation Drift Audit
archetype: architecture-analysis
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - docs
  - audit
  - drift
last_reviewed: 2026-08-19
---

# Documentation Drift Audit

Phase 1 output of the docs-only refresh sweep. Audits every in-scope doc under
`docs/` against the current source tree on branch `docs/architecture-refresh`
(HEAD `73910aa`). Research only — no files were modified.

## Scope

| Directory | Docs | Covered |
|---|---|---|
| `docs/architecture/` | 24 | 24 |
| `docs/features/` | 12 | 12 |
| `docs/product/` | 26 | 26 |
| `docs/repo-agents/` | 4 | 4 |
| **Total** | **66** | **66** |

Out of scope: `docs/releases/` (historical record), `docs/roadmap/` (active
authorship), and the three harness-evolution docs that live on
`docs/harness-evolution-research`, not on `main`.

## Method

- **Section B — cross-doc markdown link drift.** Every relative `.md` link in
  every in-scope doc was resolved against the tree with a script.
- **Section A — source-code reference drift.** Every backticked file path and
  symbol reference was resolved by globbing/reading source. Behavioral claims
  were checked against `file:line` evidence actually read in source. Each
  contradiction quotes the contradicting source location because this section
  is human-verified.
- Each doc gets a verdict: `current`, `drifted`, or `obsolete`. `obsolete`
  means the doc describes a surface that no longer exists or was fully
  superseded; `drifted` means the doc is still relevant but contains stale
  refs/claims; `current` may still carry minor notes.

---

## Section B — Cross-doc link drift

**All 84 relative `.md` links across the 66 in-scope docs resolve.** No missing,
moved, or broken markdown link targets. Section B needs no repairs.

Notes captured while verifying:

- `docs/product/QUICKSTART.md` and `docs/product/start-here.md` point the
  installer at `https://raw.githubusercontent.com/ShaileshRawat1403/dax-tui/main/script/install.sh`.
  The repo remote and `package.json` are `ShaileshRawat1403/dax` (external
  repo-name drift — the install URL is unverifiable from this tree, not a
  broken relative link). Same pattern in `prerelease.md`, `distribution.md`,
  `build-on-dax.md`, and `TRANSPARENCY_AND_LIMITATIONS.md`.
- `docs/architecture/DAX_SESSION_STATE_SCHEMA.md` is explicitly marked
  `[ARCHIVED]` and points at `DAX_EVENT_DRIVEN_LIFECYCLE.md`; the link resolves
  and the archived status is correct.

---

## Section A — Source reference drift

Two sub-classes. **A1: broken paths/symbols** (mechanical, resolved by globbing
the tree). **A2: behavioral contradictions** (claims contradicted by `file:line`
evidence; each entry quotes the contradicting source).

### A1 — Path / symbol references that do not resolve

| Doc | Missing reference | Source truth |
|---|---|---|
| `INTERNAL_MODULE_INVENTORY.md` | `core/dax/intent.ts`, `core/session/planner.ts`, `core/dax/execution.ts`, `packages/dax/src/trust/`, `packages/dax/src/policy/`, `packages/dax/src/audit/` | Deleted in commit `f842ff1` "feat: complete DAX overhaul - Session Model V2, Governance consolidation, and Workstation UX" (Mar 15 2026). Current homes: `packages/dax/src/intent/interpret.ts`, `packages/dax/src/governance/` (`trust-verification.ts`, `policy-engine.ts`, `audit.ts`, `governance-writer.ts`), `packages/dax/src/sdlc/verify-session.ts` |
| `DAX_EXPLORE.md:93` | `trust/verify-session.ts` | Moved: `packages/dax/src/sdlc/verify-session.ts` (exported via `sdlc/index.ts:5`) |
| `COMPOSABLE_WORKFLOW_GRAPHS.md` | `packages/dax/src/workflows/run-workflow.ts`, `compose.ts`, `trust.ts`, `artifacts.ts`, `gates.ts`, `builtins/` | `packages/dax/src/workflows/` holds only `types.ts`, `registry.ts`, `builtin-workflows.ts` |
| `COMPOSABLE_WORKFLOW_GRAPHS.md` | `dependency-analysis` skill | `skills/` holds 19 packs; no `dependency-analysis` |
| `WORKFLOW_REPO_AUDIT.md` | `dax workflow run repo-audit`, skills `dependency-analysis`/`code-complexity`/`trust-verify`/`artifact-audit`, policies `tests-required`/`max-complexity-violation`/`banned-dependencies`, artifacts `dependency-graph.json`/`complexity-hotspots.json`/`policy-violations.json`/`audit-report.md` | Workflow ids are only `repo-health`, `explore-repo`, `release-readiness` (`workflows/builtin-workflows.ts:3`; unknown id throws at `:87`). Skills registry loads empty (`skills/load.ts:6`). Policy engine is permission-rule based (`governance/policy-engine.ts`). Real artifacts are `explore-report.json`/`artifact-inventory.json` written to `.dax/artifacts/<sessionId>/` (`operators/report-artifact.ts:17`) |
| `WORKFLOW_ARCHITECTURE_MAP.md` | `dax workflow run architecture-map`, skills `boundary-detection`/`entrypoint-detection`/`execution-flow-tracing`/`map-generator`, policies `no-circular-dependencies`/`enforce-boundary-rules`, artifacts `boundaries.json`/`entrypoints.json`/`execution-flow.json`/`architecture-map.md` | Same truth as above. Closest real workflow is `repo-health` (`builtin-workflows.ts:13-51`) |
| `WORKFLOW_RELEASE_READINESS.md` | Skills `test-coverage-check`/`docs-completeness-check`/`release-policy-check`/`summary-generator`, policies `min-test-coverage-80-percent`/`all-public-apis-documented`/`no-open-high-severity-issues`, artifacts `test-coverage.json`/`docs-status.json`/`release-policy-violations.json`/`release-readiness.md` | Workflow id `release-readiness` is real (`builtin-workflows.ts:67-81`) but its single task routes to `ReleaseOperator` (`operators/release.ts:7`); real artifact is `release-readiness.json` (`operators/release.ts:98-108`) |
| `DAX_MODE_MODEL.md:152-163` | `dax --eli12` global flag, `dax inspect --eli12`, `dax inspect --mode explore` | Global CLI options are only `--print-logs`/`--log-level` (`packages/dax/src/index.ts:73-81`). `inspect` exists only as `session inspect <session-id>` (`cli/cmd/session.ts:317`), `mcp inspect <name>` (`cli/cmd/mcp.ts:180`), `workflow inspect <session-id>` (`cli/cmd/workflow.ts:190`) |
| `DAX_AUDIT.md` | `verify-ledger` symbol, "no command implementation yet" (`:130`) | `dax audit` is implemented (`cli/cmd/audit.ts:43-44`; subcommands run/gate/profile/explain/events) and registered (`index.ts:119`). No `verify-ledger` symbol exists |
| `DAX_WRITE_GOVERNANCE.md` | Quoted verify failure string "No retained artifacts or session diff evidence were recorded" | That string no longer exists; verify now exposes `evidence.diff_present`/`artifacts_present`/`artifact_count` (`governance/trust-verification.ts:98-102`). The problem this doc bridges is resolved in-tree (`artifacts.ts:124-180` `deriveWorkspaceFileArtifact`, `governance/governance-writer.ts:36-44`, `session.ts:1296`) |
| `PROJECT_MEMORY.md:166-183` | `/pm memory save`, `/pm memory list` commands | `commandPM` parses only `note`/`list`/`rules` (`session/prompt.ts:2047-2162`; fallback help `:2153-2159`). `PM.save_memory`/`list_memory` exist (`pm/index.ts:453,483`) but are not wired to any command handler |
| `DAX_PLAN.md` | `run --prompt` convenience path (`:108`) | `dax run` has no `--prompt` flag; intent is the positional `message` (`cli/cmd/run.ts:243-315`) |
| `COMPOSABLE_WORKFLOW_GRAPHS.md`, `WORKFLOW_ARCHITECTURE_MAP.md`, `WORKFLOW_REPO_AUDIT.md` | `dax workflow inspect` "shows the design and steps of the workflow" | `workflow inspect` takes a `<session-id>` and shows session/run state (`cli/cmd/workflow.ts:190`) |
| `DAX_SOOTHSAYER_WORKSTATION_PLAN.md:89-96` | `apps/api/src/modules/dax/` (`dax.module.ts`, `dax.controller.ts`, `dax.service.ts`, `dax.types.ts`, `dax.mapper.ts`) | No `apps/` tree in this repo. This is the Soothsayer-side NestJS plan — external repo, not a contradiction. DAX-side routes all resolve (`server/routes/run.ts:47-249`, `server/routes/soothsayer.ts`) |
| `RUST_STORAGE.md` | `packages/dax/src/rust/storage.ts`, `rust/storage.parity.test.ts`, `tests/storage_golden.rs` | Doc is explicitly "candidate architecture. No code yet" — planned deliverables, not broken refs. No `dax-storage` crate exists |
| `DAX_EXECUTION_MODEL.md`, `HOW_DAX_WORKS.md` | Tool ids `search`, `web` (HOW doc tool table) | Actual ids are `grep`, `codesearch`, `websearch`, `webfetch`, `glob`, `list`, `task`, `todo` (`tool/tool-class.ts:24-30`); `read`/`edit`/`shell` are real (`tool/read.ts:22`, `tool/edit.ts:27`, `tool/shell.ts:76`) |

### A2 — Behavioral contradictions (with contradicting source)

1. **`RUNS_APPROVALS_AND_RECOVERY.md:19,37` and `DAX_IN_SIMPLE_WORDS.md:70` — "approval denied → cancelled" is wrong.**
   `state/events/run-reducer.ts:348-360` maps `approval_denied` to `failed` with
   code `approval_rejected`; a `rejected` decision via `approval_resolved`
   returns the run to `running` (`run-reducer.ts:229-243`). The reducer never
   emits `cancelled`; `cancelled` comes only from the live operator/user-cancel
   path (`server/run-gateway.ts:161` → terminal reason `workflow_cancelled`).
   Fix target: the Mermaid edge `WaitingApproval --> Cancelled: Human denies`.

2. **`RUNS_APPROVALS_AND_RECOVERY.md:245-251` — terminal-reason names.** Doc says
   `error` and `user_cancelled`; source values are `execution_error`
   (`run-contract.ts:22`, `run-gateway.ts:150,166`) and `workflow_cancelled`
   (`run-contract.ts:21`, `run-gateway.ts:161`). `contract_mutation`,
   `permission_denied`, `timeout` are consistent (`run-contract.ts:23-25`).

3. **`PROVIDERS.md:142` — "`~/.dax/data/auth.json`" is wrong.** The file is
   created at `Global.Path.data/auth.json` = XDG data dir + `/dax` =
   `~/.local/share/dax/auth.json` (`packages/dax/src/auth/index.ts:47`,
   `global/index.ts:13-34`). The CLI itself renders it that way
   (`cli/cmd/auth.ts:228-230`). `~/.dax/` is the home config scan directory
   (`config/config.ts:206-213`). MCP auth is separate at `mcp-auth.json`
   (`mcp/auth.ts:31`).

4. **`DAX_TRUST_MODEL.md:136-140` — the 5-rung ladder is not a single enum.**
   `unknown/review_needed/policy_clean/verified/release_ready` are split across:
   session trust `review_needed | policy_clean | verified`
   (`governance/types.ts:16`, `rust/audit.ts:44`); audit posture
   `clear | review_needed | blocked` (`cli/cmd/audit.ts:16`); release readiness
   `not_ready | review_ready | handoff_ready | release_ready`
   (`release/check-session-release.ts:8-12`); trust-event payload posture
   `low | guarded | moderate | strong` (`state/events/run-event-types.ts:47`,
   `run-reducer.ts:119`, `run-contract.ts:87`); session-state
   `trusted/neutral/untrusted` (`session/update-state.ts:166-171`). The `unknown`
   rung appears nowhere. The core claim — `audit.posture_updated` replaces the
   legacy `trust.updated` family (`run-contract.ts:467,611`, `run-gateway.ts:627`,
   `run-projections.ts:243-248`) — is consistent; legacy `trust_updated`/`trust.updated`
   still exist for replay compat (`state/events/run-event-types.ts:13,44`,
   `state/replay.ts:157-158`).

5. **`DAX_SESSION_MODEL_V2.md` — "Recommended lifecycle" is proposal, not reality.**
   Actual `SessionStatus = "active" | "paused" | "completed" | "abandoned" |
   "failed" | "blocked"` (`session/state-types.ts:143`). The doc's
   `created/planning/ready/executing/awaiting_approval/...` vocabulary is a design
   proposal; the grammar claims (plan/run/approvals/artifacts/audit) resolve
   (`cli/cmd/plan.ts:67`, `run.ts:763`, `approvals.ts:344`, `artifacts.ts:24`).

6. **`DAX_PLAN.md` — readiness vocabulary.** Doc's `draft/ready_for_review/needs_input`
   (`:Section 6`) vs shipped `"ready" | "incomplete" | "blocked"`
   (`cli/cmd/plan.ts:20`, derivation `:208-213`). The `plan_preview` JSON contract
   (`plan.ts:22-33`) matches.

7. **`DAX_WORKSTATION.md:117-123` — "five session-native modes".** Doc:
   `changes/audit/approvals/plan/refine`. Actual: `audit | approvals | memory |
   refine | operator | runtime` — six values, the canonical `PANE_MODE` const
   (`dax/presentation/pane.ts:1`), consumed as the mode list by the session route
   (`routes/session/index.tsx:211`) and as the `paneMode` signal type (`:414`).
   No `changes` and no `plan` mode. Auto-pane fallback is `refine`, not `plan`.

   Corrected on review: an earlier draft of this entry listed a seventh mode,
   `diff`, on the strength of the inline prop union at
   `cli/cmd/tui/component/prompt/index.tsx:24`. That union is stale — no code
   path assigns `"diff"`, and it is not a member of `PaneMode`. Treat
   `pane.ts:1` as the only source of truth here.

   The auto-derivation rules were also overstated. `deriveAutoPaneMode`
   (`pane.ts`) has exactly four positive branches, in order: `hasApprovals` →
   `approvals`, `hasAuditAttention` → `audit`, `hasMemoryContext` → `memory`,
   `hasRefineDraft` → `refine`; anything else returns the caller's `fallback`.
   `operator` and `runtime` are never auto-derived. The function accepts
   `hasDiffContext`, `hasLiveContext` and `hasPlanContext` and branches on none
   of them — see the runtime follow-ups below.

8. **`WORKFLOW_ARCHITECTURE_MAP.md:40-47`, `WORKFLOW_REPO_AUDIT.md:45-52`,
   `WORKFLOW_RELEASE_READINESS.md:43-53` — invented output blocks.** The real
   `dax workflow run` output is the `WORKFLOW RESULT` block in
   `cli/cmd/workflow.ts:166-181` and `workflow-summary.json` (`workflow.ts:164`).
   No "Trust Score" percentages exist.

9. **`DAX_EVALS.md:66,82` — stale eval inventory.** Doc says kinds
   `core_proof | policy | audit` and "the smoke suite covers three scenarios".
   Source: `ScenarioKind = "core_proof" | "policy" | "audit" | "indexer"`
   (`evals/types.ts:1` at repo root, not `packages/dax/src/evals/types.ts`); all 5 scenario files carry
   `"suite": ["smoke", "proof"]` — smoke now runs 5 scenarios including two
   indexer ones (`evals/scenarios/indexer_extracts_symbols.json`,
   `indexer_relevance_top_3.json`). Scripts `eval:smoke`/`eval:proof`/`eval`
   resolve (`package.json`).

10. **`DAX_SUBAGENT_MODEL.md` — conflates operators with task-tool subagents.**
    Doc's "Initial Sub-Agent Set: Git, Explore, Verify, Release, Artifact" matches
    **operators** (`operators/{git,explore,verify,release,artifact}.ts`,
    registered `operators/router.ts:29-37`), not task-tool subagents. Native
    subagent-mode agents are `general | agile | lean | ts-expert`
    (`agent/agent.ts:154-213`); `explore` is `mode: "primary"` (`agent.ts:247`).
    `GitOperator` implements only add/commit/push/checkout/status
    (`operators/git.ts:19-55`) — no diff/branch-list actions. Task-fork/resume
    mechanics are consistent (`tool/task.ts:18-56`).

11. **`DAX_RUNTIME_EXECUTION_MODEL.md` — idealized interface sketches.** The
    named interfaces (`Intent`, `Workflow`, `ExecutionGraph`, `GraphNode`,
    `Artifact`, `Policy`) are design sketches, not source types. Contradicted
    specifics: `Intent.type` union is `explore_repo | git_review | verify_session
    | release_readiness | artifact_inspect | docs_generate | code_change |
    general_query` (`intent/types.ts:1-9`), not `explore|workflow|audit|general_query`;
    tasks carry only `operator_type`, no `workflow`/`policy_gate` node types
    (`planner/task-graph.ts:5-18`). Machinery claims (pipeline, statuses,
    resumability, `TrustDelta`, `ArtifactRecord`) all verify
    (`governance/trust.ts:1`, `governance/artifact.ts:1-18`).

12. **`COMPOSABLE_WORKFLOW_GRAPHS.md` — `project-health` was never built.**
    "`project-health` is the first official composite workflow" composed of
    `architecture-map` → `repo-audit` → `release-readiness` is contradicted: no
    such workflows exist; actual builtins are `repo-health`, `explore-repo`,
    `release-readiness` (`workflows/builtin-workflows.ts:3`). Flattened composite
    expansion is not implemented (`planner/task-graph.ts:1-25` builds a flat
    `TaskGraph` directly). `release-readiness` exists as a builtin but is not part
    of any composite.

13. **`TRANSPARENCY_AND_LIMITATIONS.md:118-121` — "current v1.2 release"
    limitations shipped in 1.3.0.** Per-host network egress allowlisting for
    governed workers landed in 1.3.0 (`CHANGELOG.md` `[1.3.0]`;
    `worker/egress-allowlist.ts`, `worker/egress-proxy.ts`), so "worker execution
    is not yet restricted to a per-provider hostname allowlist" is stale. Credential
    masking landed too (`worker/worker-sandbox.ts:93` Seatbelt `(deny file-read* ...)`,
    `:148` bubblewrap `--ro-bind-try /dev/null` mask `~/.ssh`, `~/.aws`;
    `:134` "secrets masked"), so the secrets-threat-model claim is stale. Rust
    proof surfaces (`script/build.ts:23` `RUST_SIDECAR_BINARIES`) and Infisical
    env fallback (`secrets/secrets-loader.ts:51,149`) verify.

14. **`WHAT_IS_DAX.md:125-127` and `ROADMAP.md:18-100` — version roadmaps are
    fully shipped.** Repo is at `1.3.0` (`packages/dax/package.json`,
    `CHANGELOG.md [1.3.0] - 2026-08-14`). The `1.0.12/1.1.x/1.2.x` roadmap in
    WHAT_IS_DAX and the `v1.0.9 → v1.0.10 → v1.1.x → v1.2.x` plan in ROADMAP.md
    describe already-shipped releases; ROADMAP.md's "next hardening step"
    (egress allowlisting) shipped in 1.3.0.

15. **`WORKFLOWS.md` — obsolete v0.2 milestone framing.** "repo-audit,
    architecture-map, release-readiness" as v0.2 workflows vs current
    `WorkflowClass = draft_and_approve | repo_analyze | review_and_signoff |
    worker_run | generic` (`server/run-contract.ts:9`) and builtins
    `repo-health | explore-repo | release-readiness`
    (`workflows/builtin-workflows.ts:3`). `architecture-map` has no counterpart;
    `repo-audit` appears only as a session slug in tests (`cli/cmd/session.test.ts:43`).

16. **`DAX_AUDIT.md` — written before `dax audit` shipped.** "no command
    implementation yet" (`:130`) and "define the v1 implementation contract"
    (`:152`) describe completed work (`cli/cmd/audit.ts:43-44`). Everything else
    (canonical grammar `plan/run/approvals/artifacts`, RAO ledger) is consistent
    (`governance/trust-verification.ts:37`, `dax/presentation/evidence-ledger.ts`).

17. **`TUI_UX_REFRESH.md` — refresh landed elsewhere.** Plan item 1 put left-border
    tool chrome in `RunEventRow`; instead `run-event-row.tsx:88-89` explicitly
    rejects that ("Tool execution chrome belongs to ToolPart") and the chrome
    landed in the session route (`routes/session/index.tsx:2526-2554` ToolLine,
    `:2651-2679` Bash). Plan item 2's As-Is mockup (`──── ⟳ context compacted ────`)
    is stale: `stream-item.tsx:79-108` already implements the borderless dim To-Be
    state. Item 3 live-tail is implemented (`index.tsx:2634-2645`).

18. **`DAX_ARTIFACTS.md` — omits the 4th artifact kind.** Source has
    `session_diff | attachment | truncated_output | workspace_file`
    (`cli/cmd/artifacts.ts:11`); the doc lists three. `workspace_file` derivation
    at `artifacts.ts:124-180`.

19. **`TOOLS_AND_RISK_MATRIX.md` — registry availability nuances.** `todoread`
    is commented out of the registry (`tool/registry.ts:119`); `plan_enter`/
    `plan_exit` are gated behind `DAX_EXPERIMENTAL_PLAN_MODE` + `DAX_CLIENT === "cli"`
    (`registry.ts:127`); `multiedit` is defined but never registered
    (`tool/multiedit.ts:8`); `list` is a real tool but not default-registered
    (`tool/ls.ts:38`, `registry.ts:102-131`). Permission classification
    (`permissionForToolId`, `tool/tool-class.ts:59-62`) is consistent.

20. **`DAX_WRITE_GOVERNANCE.md` — obsolete-in-a-good-way.** The failure mode it
    bridges (verify reports missing retained artifacts when `workspace_file` writes
    happened) is already resolved in-tree. Rephrase as implemented, or mark
    `superseded` pointing at the current write-governance surfaces.

21. **`ARCHITECTURE.md:99` — "quarantined legacy material".** `cli/`, `core/`,
    `tui/` no longer exist at the repo root (only `script/build.ts` remains).
    `script/guard-legacy.ts:7` still names them as frozen legacy roots, but the
    dirs are gone. Same stale framing in `contributor-start-here.md:23-31` (and a
    nonexistent branch `feature/dax-execution-control-plane` at `:45`).

22. **`session-handoff-byoa-demo.md:43` — "10 sandbox verification checks" is a
    dated figure.** Accurate on the 2026-07-11 demo (`3a29ac4`, 10 tests); the
    file now has 21 tests at HEAD. Faithful historical receipt, not a defect —
    leave as-is.

---

## Per-doc verdicts

### `docs/architecture/` (24)

| Doc | Verdict | Note |
|---|---|---|
| `ARCHITECTURE.md` | current | Stale "quarantined legacy roots" claim (A1) |
| `COMPOSABLE_WORKFLOW_GRAPHS.md` | **drifted** | A1 paths, A2 #12 — composites never built |
| `DAX_EVALS.md` | current | A2 #9 (small drift: 5 scenarios, `indexer` kind) |
| `DAX_EVENT_DRIVEN_LIFECYCLE.md` | current | Dot vocabulary resolves against `server/run-contract.ts`, `server/run-projections.ts`, `state/replay.ts` |
| `DAX_EXECUTION_MODEL.md` | current | All refs resolve; command mapping holds |
| `DAX_MODE_MODEL.md` | **drifted** | A1 `--eli12`/`inspect`; concepts implemented faithfully (`session-display.ts:1`, `intent/index.ts:1`) |
| `DAX_RUNTIME_EXECUTION_MODEL.md` | **drifted** | A2 #11 — idealized interfaces |
| `DAX_SESSION_MODEL_V2.md` | drifted (proposal) | A2 #5 — lifecycle vocab is design, statuses differ |
| `DAX_SESSION_STATE_SCHEMA.md` | current | Explicitly `[ARCHIVED]` → `DAX_EVENT_DRIVEN_LIFECYCLE.md` |
| `DAX_SKILLS_MODEL.md` | current | 4 example skills + `SkillManifest` verified |
| `DAX_SOOTHSAYER_WORKSTATION_PLAN.md` | current | DAX-side routes verified; `apps/api` is external-repo plan |
| `DAX_SUBAGENT_MODEL.md` | **drifted** | A2 #10 — operators vs subagents conflated |
| `DAX_TRUST_MODEL.md` | current | A2 #4 — event claim verifies; ladder aspirational |
| `HOW_DAX_WORKS.md` | current | `compiled`→`created` confirmed; tool table simplified (A1) |
| `INTERNAL_MODULE_INVENTORY.md` | **drifted** | A1 — describes pre-`f842ff1` consolidation |
| `PHASE_3_RETROSPECTIVE.md` | current | All four improvements present (`run-contract.ts:61-65`, `run-projections.ts:91,251-265`, `bus/lifecycle.ts:110`) |
| `RAO_PROTOCOL.md` | current | Spec implemented verbatim (`rao/schema.ts:35-99`); only A2A adapter absent |
| `RUST_CORE_BOUNDARY.md` | current | All crate boundaries verified |
| `RUST_INDEXER.md` | current | Phase 1/2 verified line-for-line; omits `version` sidecar command |
| `RUST_LEDGER.md` | current | Proof-only status confirmed; no live wiring |
| `RUST_POLICY_LIVE_INTEGRATION.md` | current | Every claim verified incl. `.env.example` carve-out (`crates/dax-policy/src/path.rs:90-92,137-149`) |
| `RUST_PROOF_LADDER.md` | current | 4 golden crates + 6 adapters verified |
| `RUST_STORAGE.md` | current (candidate) | "No code yet" — planned deliverables |
| `SDLC_VERIFICATION.md` | current | `dax.sdlc.verification.v1` + guarded-on-empty rule verify (`sdlc/check-types.ts:54,58`, `verify-session.ts:9`) |

### `docs/features/` (12)

| Doc | Verdict | Note |
|---|---|---|
| `DAX_ARTIFACTS.md` | current | A2 #18 — omits `workspace_file` kind |
| `DAX_AUDIT.md` | **drifted** | A1, A2 #16 — `dax audit` shipped after the doc |
| `DAX_EXPLORE.md` | current | A1 — stale `trust/verify-session.ts` path |
| `DAX_PLAN.md` | **drifted** | A1 `run --prompt`, A2 #6 readiness vocab |
| `DAX_RELEASE.md` | current | Ladder matches `release/check-session-release.ts:8-12` exactly |
| `DAX_WORKSTATION.md` | **drifted** | A2 #7 — pane modes evolved |
| `DAX_WRITE_GOVERNANCE.md` | **obsolete** (implemented) | A2 #20 |
| `SHADOW_AUDITOR.md` | current | Feature exists (`execution/shadow-auditor.ts`); all claims verified |
| `TUI_UX_REFRESH.md` | **drifted** | A2 #17 — landed in session route, not `RunEventRow` |
| `WORKFLOW_ARCHITECTURE_MAP.md` | **obsolete** | A1, A2 #8 — workflow/skills/policies/artifacts don't exist |
| `WORKFLOW_RELEASE_READINESS.md` | **obsolete** | A1, A2 #8 — id real, implementation differs |
| `WORKFLOW_REPO_AUDIT.md` | **obsolete** | A1, A2 #8 — no such workflow |

### `docs/product/` (26)

| Verdict | Docs |
|---|---|
| current (18) | `DAX_IN_SIMPLE_WORDS.md` (A2 #1 diagram edge), `INTENT_GUIDE.md`, `NON_DEVELOPERS.md`, `POLICY_TUNING.md`, `POSITIONING.md`, `QUICKSTART.md` (install-URL note), `TOOLS_AND_RISK_MATRIX.md` (A2 #19 caveats), `TUI_DESIGN_FREEZE_v1.md` (cosmetic `1.0.33` version string only), `USER_GUIDE.md`, `audit-agent.md`, `build-on-dax.md` (clone-URL note), `deprecation-tracker.md`, `distribution.md` (URL note), `integrations-github-ci.md`, `non-dev-quickstart.md`, `prerelease.md` (URL note), `release-readiness.md` (determinism-proof nuance), `start-here.md` (URL note) |
| drifted (6) | `PROJECT_MEMORY.md` (A1 `/pm memory`), `RUNS_APPROVALS_AND_RECOVERY.md` (A2 #1,#2), `TRANSPARENCY_AND_LIMITATIONS.md` (A2 #13), `WHAT_IS_DAX.md` (A2 #14), `contributor-start-here.md` (A1), `PROVIDERS.md` (A2 #3) |
| obsolete (2) | `ROADMAP.md` (A2 #14), `WORKFLOWS.md` (A2 #15) |

### `docs/repo-agents/` (4)

| Doc | Verdict |
|---|---|
| `DAX_AGENTS.md` | current — 3/3 refs resolve, 8/8 claims consistent |
| `PICOBOT_AGENTS.md` | current — 10/10 claims consistent |
| `SOOTHSAYER_AGENTS.md` | current — 10/10 claims consistent |
| `session-handoff-byoa-demo.md` | current (dated receipt) — 14/14 claims consistent; "10 checks" is historical |

---

## Summary

| Verdict | Count |
|---|---|
| current | 44 |
| drifted | 16 |
| obsolete | 6 |
| **Total** | **66** |

**Highest-value repairs for Phase 2** (in order):
1. `RUNS_APPROVALS_AND_RECOVERY.md` + `DAX_IN_SIMPLE_WORDS.md` — approval-denial → `failed`/`approval_rejected`, terminal reasons `execution_error`/`workflow_cancelled`.
2. `PROVIDERS.md` — auth path `~/.local/share/dax/auth.json`.
3. `TRANSPARENCY_AND_LIMITATIONS.md` — drop the shipped-in-1.3.0 limitations.
4. `PROJECT_MEMORY.md` — remove or mark-unimplemented the `/pm memory ...` commands.
5. Three `WORKFLOW_*.md` docs — replace with what actually exists (`repo-health`, `explore-repo`, `release-readiness`, real artifact paths) or mark `superseded`.
6. `INTERNAL_MODULE_INVENTORY.md` — rewrite to post-`f842ff1` module layout.
7. `DAX_AUDIT.md`, `DAX_PLAN.md`, `DAX_MODE_MODEL.md`, `DAX_WORKSTATION.md`, `COMPOSABLE_WORKFLOW_GRAPHS.md` — point activation examples/readiness/vocab at shipped surfaces.
8. `ROADMAP.md`, `WORKFLOWS.md` — mark `superseded` with pointers; do not attempt to re-derive future plans.