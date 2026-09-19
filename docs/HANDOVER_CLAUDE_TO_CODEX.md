# Handover — Claude Code → Codex

**Date:** 2026-09-19
**Reason:** Claude Code is being withdrawn from DAX. Codex takes sole ownership of all lanes.
**Baseline:** `main` at `f31255b07d646d8d0a44560833bd61ffee6f00d3`

This document exists so that nothing in five cross-validation cycles has to be rediscovered. Read §1 before anything else — there is one action that must happen before this handover is safe.

---

## 1. Do this first: publish two unpublished branches

Seven commits live **only in the object database at `/Users/Shailesh/MYAIAGENTS/dax/.git`**. They have no upstream. If that directory is deleted, reset, or re-cloned, the work is gone. Codex's worktree can read them today only because it shares that object store — that is not a backup.

```bash
cd /Users/Shailesh/MYAIAGENTS/dax
git push -u origin docs/claims-evidence-pack
git push -u origin docs/agent-collab-protocol
```

Verify:

```bash
git ls-remote --heads origin | grep -E 'claims-evidence-pack|agent-collab-protocol'
```

Until those two refs exist on the remote, this handover is not complete. Nothing else in this document matters as much.

---

## 2. Branch inventory

| Branch | Head | Published | Owner after handover | State |
|---|---|---|---|---|
| `docs/claims-evidence-pack` | `04a4c25` | **No** | Codex | Complete, cross-validated, ready to merge |
| `docs/agent-collab-protocol` | `3886cb8` (+ this doc) | **No** | Codex | Ratified by Codex, ready to merge |
| `chore/codex-bun-toolchain` | `921be97` | Yes | Codex | Investigation complete; the fix it identified is not yet made |
| `chore/codex-collab-validation` | `ccbe621` | No | Codex | Scratch branch from Codex's setup; safe to delete |
| `test/conformance-integrity-gaps` | — | — | Codex | **Never created.** Spec in §5 |

Suggested merge order: `docs/agent-collab-protocol`, then `docs/claims-evidence-pack`, then `chore/codex-bun-toolchain`. They do not conflict; this order puts the contract in `main` before the documents that cite it.

---

## 3. What each branch contains

### `docs/claims-evidence-pack` → `docs/product/claims-and-evidence.md`

Seven public claims about DAX, each pinned to `v1.4.0` (commit `494354d`), each with a boundary stating what it does *not* prove, each with a demo and a permalink appendix. Built so a sceptical reader can check every line with `git show v1.4.0:<path> | sed -n '<line>p'`.

| Commit | What |
|---|---|
| `c899f1c` | The pack, all seven claims, 36-row evidence appendix |
| `bd23c03` | Three overstatements corrected after cross-validation |
| `0f46580` | Claim 3 split into two distinct AGY origin labels |
| `04a4c25` | Claim 3's demo clause aligned with the corrected statement |

**Do not weaken the boundary sections.** They are the reason the document is credible. The pack explicitly refuses the words *secure*, *audited*, *battle-tested*, and *guaranteed*, and says why.

### `docs/agent-collab-protocol` → `docs/MULTI_AGENT_SOP.md`

The two-agent working contract, ratified by Codex. Risk-tiered validation, lane partitioning, handoff and validation templates, failure-mode table. Also corrects two stale facts in `AGENTS.md` that pointed agents at a non-existent path and a non-existent repo name.

With a single agent this SOP is dormant, not wrong. Keep it: the handoff template, the severity ladder, the "declare what you could not run" rule and the evidence discipline are all useful solo. §11 holds the project bindings and the gate table, which apply regardless of how many agents there are.

---

## 4. Open findings — unresolved work, in priority order

| # | Finding | Location | Severity |
|---|---|---|---|
| 1 | Test-suite membership depends on untracked working-tree contents. `bun test packages` is a substring path filter over the **whole tree**, ignored directories included — a planted canary under `artifacts/packages-probe/` was discovered and executed, taking the suite from 235 to 236 files. This is also the EMFILE cause. Fix: `"packages"` → `"./packages"`. Add a regression test that plants a canary under an ignored path and asserts the suite does not grow. | `script/test.ts:4` | High |
| 2 | Two of eleven `KNOWN_GAPS` entries have no `expectGap`-wrapped check, so for those two a gap that closes does **not** turn CI red. The claims pack now admits this. Spec in §5. | `packages/dax/src/conformance/known-gaps.ts` | High |
| 3 | `package.json` pins `bun@1.4.0`; the system runtime is 1.3.9. `packages/script/src/index.ts:16` hard-throws under 1.3.9. Codex has verified an isolated 1.4.0 works and a fresh install passes 1,738 tests. | `package.json:7` | Medium |
| 4 | One test failure observed in a full local run (1734 pass / 2 skip / 1 fail / 1 error) that was never isolated. The *error* was finding 3's version guard. The *fail* is unidentified. | unknown | Medium |
| 5 | Full release gates have never been verified end to end by either agent, under either runtime. Everything after the test stage is unproven locally. | `release:gates` chain | Medium |
| 6 | No Docker daemon is reachable on this machine. Docker-dependent checks are blocked, not merely unassigned. | environment | Low |

---

## 5. Specification for the one unstarted work item

Claude declared this and never began it. Nothing exists — no branch, no code.

**Task.** Close the two unenforced entries in the conformance gap ledger.

| Field | Value |
|---|---|
| Suggested branch | `test/conformance-integrity-gaps` |
| Tier | 2 |
| Scope | `packages/dax/src/conformance/` only. No production changes |
| Targets | `integrity.contract-immutability-cross-store-race`, `integrity.event-authority-partial-initialization-recovery` |

**Acceptance.** Each of the two ids gains a check wrapped in `expectGap`, asserting the invariant DAX *should* hold. Because `expectGap` inverts the assertion, each check **must still fail** while the gap is open — a check that passes means the gap closed and the ledger is stale. The suite stays green. Only after the checks land does the claims pack move from "nine enforced" to "eleven enforced"; do not edit that sentence first.

**Why it matters.** Claim 6 of the public pack promises that a gap which closes turns CI red. For these two entries it does not. The pack currently tells the truth about that; this work makes the weaker statement unnecessary.

---

## 6. Dead ends — do not re-investigate

Five cycles produced five confidently-wrong hypotheses. Each was refuted with evidence. Re-running them wastes time.

| Hypothesis | Who held it | Why it is dead |
|---|---|---|
| EMFILE is caused by the per-process fd soft limit | Claude | Codex's original runs already inherited 1,048,575, the same as the successful run. A single correlated variable was mistaken for a cause |
| The two worktrees use different install layouts | Claude | Both have `node_modules/.bun`; both isolated |
| A larger dependency tree exhausts descriptors | Claude | The *larger* tree succeeds — 964 packages passing vs 787 failing |
| AGY narration carries one origin label | Claude | Two labels: reply text is `external-agent` (`antigravity-conversation.ts:495`), tool summaries are `external-agent-report` (`:319`) |
| A finding about an artifact absent from the reviewed tree is unverifiable | Claude | Agents sharing a git object database read each other's unpushed commits directly. Unpublished is a publication violation, not an unreadable one |

The actual EMFILE cause is finding 1 in §4: bare-filter test discovery walking ignored directories.

---

## 7. Established environment facts

| Fact | How it was established |
|---|---|
| `bun` 1.3.9 system-wide against a 1.4.0 pin | `package.json:7` vs `bun --version` |
| Isolated Bun 1.4.0 provisions cleanly; fresh install passes 1,738 tests | Codex, `chore/codex-bun-toolchain`, hashes verified against oven-sh's published `SHASUMS256.txt` |
| `kern.maxfiles` 30720, `kern.maxfilesperproc` 10240 — low for concurrent suites | `sysctl` |
| No Docker daemon; CLI present, socket absent | `docker info` fails. `docker --version` succeeding proves only a CLI |
| Concurrent full-suite runs by two agents were never tested | Neither agent attempted it |

---

## 8. Method worth keeping

Across five cycles the second agent found six defects in the first agent's work, and the first found three in the second's. In both cases the item each agent was *most confident about* was wrong. Three practices did the work, and they are all useful with one agent:

1. **A claim is not evidence.** State findings as `path:line` or as a command so anyone can check them in one step. Verify before building, not after.
2. **Refute, don't confirm.** Use a different method than the one that produced the claim. A grep for the string you expect will find the string you expect — that is how the AGY label error survived its first check.
3. **Say what you could not check.** `UNVERIFIABLE` stated is worth more than a gap left silent, because silence gets read as approval.

---

## 9. Withdrawal record

Claude Code owned `docs/claims-evidence-pack` and `docs/agent-collab-protocol` and is withdrawing from the project. Both branches transfer to Codex, which becomes sole owner of every lane. No Claude-owned work is in progress and nothing is half-finished — every branch listed in §2 is at a coherent commit.

The single outstanding obligation is §1. Everything else can wait.
