# Multi-Agent Development SOP

**A repeatable contract for two AI coding agents working one repository, with a human as the only channel between them.**

This document is self-contained and project-agnostic. Attach it verbatim to any agent session. Section 11 holds the only project-specific bindings; replace that section when reusing this elsewhere.

---

## 1. Roles

| Role | Description |
|---|---|
| **Agent A** | An AI coding agent working in its own checkout |
| **Agent B** | A second AI coding agent, different model family, own checkout |
| **HITL** | The human. Relays every message, decides every contested call, merges every branch |

Agents cannot message each other. They communicate only through committed code and through text the HITL carries by hand.

---

## 2. The two constraints everything follows from

**1. The human is the scarce resource, not the agents.**

Agent time is cheap. Human attention is not. A workflow that maximizes agent thoroughness while consuming human round trips optimizes the wrong variable. Every rule below exists to reduce HITL round trips, not to increase agent rigor for its own sake.

**Round-trip budget: one exchange per task — a target, not a cutoff.** If a task is heading for a third exchange, that is a signal it was scoped wrong: stop and re-scope with the HITL rather than continuing the conversation. It is never a reason to skip verifying a correction. A hard cap that suppresses necessary revalidation would trade a cheap round trip for an unverified merge, which is the wrong trade. Escalate unresolved decisions, not message counts.

**2. Uncommitted work is invisible.**

The other agent cannot see your working tree, your plan, or your reasoning. It sees commits. A dirty tree is private state, and private state is where collisions are born.

---

## 3. Risk tiers — decide this first

Cross-validation is expensive. Applied to everything, it roughly doubles cost per task and gets abandoned under deadline pressure. An abandoned protocol is worse than no protocol, because everyone still assumes it ran.

So validation fires on a trigger list, not by default.

### Tier 2 — cross-validated (the trigger list)

Work touching any of these gets a second agent's adversarial review before merge:

- Release, versioning, build, publish, or CI gate changes
- Security, policy, permission, authentication, or sandbox surface
- Anything irreversible: data migrations, deletions, force operations, published artifacts
- Public claims about what the system does or guarantees
- Concurrency, locking, or state-authority code paths
- Anything the other agent explicitly flagged
- Anything the HITL names

### Tier 1 — single agent (everything else)

One agent builds, commits, pushes, done. No handoff, no validation, no ceremony. A commit message is the whole record.

Typos, comment edits, dependency bumps, test additions, docs prose, local refactors with green tests.

**When unsure which tier applies, it is Tier 2.** The cost of over-validating one task is minutes. The cost of under-validating a release gate is the product's credibility.

---

## 4. Partition before starting, not at merge

Separate branches prevent *file* collision. They do not prevent *semantic* collision — two agents independently improving the same subsystem in incompatible directions, merging cleanly, and both being wrong.

Git cannot see this. Only up-front partitioning can.

Before a work cycle begins, the HITL assigns each agent a **subsystem lane**, not just a branch. Example shape:

| Agent | Lane |
|---|---|
| Agent A | Application/runtime code, documentation |
| Agent B | Native/compiled components, CI and build tooling |

Lanes may rotate between cycles. They may not overlap within a cycle. An agent needing a change in the other's lane requests it in a handoff; it does not make the change.

**Review crosses lanes. Implementation does not.** Either agent may validate anything; only the lane owner commits to it.

Within an assigned lane, agents derive their own branch names from the existing convention and start work without asking. The HITL assigns lanes and tasks, not branch names. Escalate only an ownership conflict or a change of scope — routing every branch name through a human is relay cost with no safety return.

---

## 5. The cycle

Tier 1 skips to step 2 and stops after step 3.

| # | Phase | Owner | Output |
|---|---|---|---|
| 1 | **Assign** | HITL | Task, tier, lane, branch name, one line of acceptance |
| 2 | **Build** | One agent | Commits on its own branch, own worktree |
| 3 | **Publish** | Same agent | Push, then a handoff message pinned to a SHA |
| 4 | **Validate** | Other agent | Adversarial review — a validation report, not a conversation |
| 5 | **Resolve** | Original agent | Fixes what was refuted, or states why it stands |
| 5b | **Revalidate** | Other agent | Only if step 5 made substantive changes — bounded to the fixes |
| 6 | **Merge** | HITL | Merges directly, deletes the branch |

Step 4 is bounded. The validating agent does not redesign, refactor, or extend. It attempts to refute specific claims and stops.

**A validation covers the SHA it names and nothing after it.** If resolving findings changed behavior, interfaces, or any claim the validation confirmed, the branch needs a targeted revalidation against the new SHA before merge — scoped to the fixes, not a re-run of the whole review. Merging a corrected branch on the strength of a review of its uncorrected state is the same error as trusting a self-report, arriving by a slower route. Typo and prose fixes do not trigger this.

---

## 6. Rules

### 6.1 Separate worktrees, never a shared one

```bash
git worktree add ../<repo>-agent-b -b agentb/scratch
```

Same git objects, independent files and branches. Neither agent edits inside the other's path — not to "just check something", not to fix an obvious typo. Read the other's work with `git show`, never by opening its worktree.

If a single shared checkout is unavoidable, only one agent may hold the tree at a time and the handoff must say **"tree released"** before the other starts. There is no third option: two agents writing one tree with no lock will silently clobber.

**Worktrees isolate files, not runtime state.** Two agents running the application concurrently still share its default home directory, its ports, its lockfiles and its process table — so an isolated checkout can still produce a contaminated test result. Before running the application concurrently, each agent must hold its own application home, its own ports, and ownership of only the processes it started. Never kill a process you did not start.

### 6.2 One task, one branch, one owner

Exactly one agent commits to a branch. Ever. If the other agent needs that work changed, it says so in a handoff and the owner makes the change, or ownership transfers explicitly and the previous owner stops.

### 6.3 Nothing is real until it is pushed

Push before every handoff, work in progress included. A WIP commit the other agent can fetch beats a perfect uncommitted diff it cannot see.

```bash
git add -A && git commit -m "wip(<scope>): <what is done so far>" && git push -u origin HEAD
```

Never hand off with a dirty tree. Never hand off with unpushed commits.

### 6.4 Every handoff pins a commit SHA

A relayed message describes a tree that may have moved. The SHA makes staleness detectable instead of silent. The receiving agent starts by fetching that exact SHA.

### 6.5 The other agent's account of its work is not evidence

When Agent B reports "tests pass", that is a proposal, not a fact. Run the command. When Agent A reports "line 130 does X", read line 130.

Verify before building on it, not after. Verifying costs one command. Building three commits on a false premise costs the afternoon.

State every finding as `path:line` or as a command, so the other side can check it in one step.

### 6.6 Validation is adversarial, never confirmatory

Two agents can agree and both be wrong. If the validator re-reads what the builder read, using the builder's method, it confirms the builder's error and manufactures false confidence.

So:

- The validator's job is to **refute**, not to approve.
- Use a **different method** than the builder used. If the builder proved it with a unit test, the validator proves it against a real run, or reads the call sites, or checks the failure path.
- Report only what a command or a `path:line` can demonstrate. "Looks reasonable" is not a validation result.
- Silence is not approval. An unvalidated claim is reported as `UNVERIFIABLE`, never omitted.
- **Never report a finding about an artifact you could not read.** If the branch was not fetchable or the file was absent from your baseline, every claim about it is `UNVERIFIABLE` — including claims that later turn out to be correct. A guess that happens to be right is worse than one that is wrong, because it makes an unsound method look reliable and the next guess inherits that credit.

### 6.7 Declare what you could not run

Never guess what the other agent can do. When you hit something you cannot execute — an interactive prompt, a long-lived process, a credential, a GUI, an unavailable platform — say so in the **Blocked** section, with the reason and the exact command you would have run.

Do not silently skip it. Do not claim it passed. Do not substitute something weaker and report the weaker thing as the stronger one.

### 6.8 No agent-to-agent debate

If the agents disagree, they do not ping-pong through the relay. Each writes its position **once** — claim, reasoning, cost of being wrong — and the HITL decides. The decision is then recorded in the repo, not only in chat.

### 6.9 Never destroy work that is not yours

No `push --force`. No `reset --hard` on a shared branch. No `checkout` over another agent's uncommitted work. These are the only actions here that can destroy work irrecoverably.

---

## 7. Handoff template

Copy-pasteable and self-contained. Assume the receiving agent has no memory of your session.

```
## HANDOFF
From:   <agent>
To:     <agent>
Tier:   1 | 2
Branch: <branch name>
Base:   <sha this branched from>
Commit: <full sha — the state described below>
Task:   <one line — what this branch is for>

### Done
- <fact as path:line or command> — verify: `<command>`

### Decisions taken
- <choice made and why> — <what it rules out>

### Not done
- <thing> — <why>

### Blocked (needs the other agent)
- <thing> — <reason I cannot run it> — command: `<exact command>`

### Open findings carried forward
- <unresolved issue from a previous cycle, with its SHA>

### Environment
- <anything about my environment that changes how you read this>

### For you
- <one explicit ask, or "review only">

### Start here
cd <RECIPIENT'S OWN WORKTREE PATH>      # never the sender's
git fetch origin && git checkout <full sha>
<the single command that shows the state described above>
```

Rules for the message itself:

- Facts carry a `path:line` or a command. Opinions are labelled as opinions.
- If you did not run it, do not write it as done.
- Keep **For you** to one ask. A human is carrying this.
- **`Start here` must name the recipient's own worktree path.** A bare `git checkout` runs wherever it is pasted, and pasted into the sender's checkout it switches the wrong agent's branch out from under them. Pin the directory explicitly, every time.
- **Decisions and open findings belong in the message, not only in the commits.** A diff records what changed; it cannot record what was considered and rejected, or what is still unresolved. Context that lives only in one agent's session is context the other does not have.

---

## 8. Validation report template

```
## VALIDATION
Of:      <branch> @ <full sha>
By:      <agent>
Method:  <how I tried to refute this — must differ from how it was built>

### Verdicts
| Claim | Verdict | Evidence |
|---|---|---|
| <the builder's claim> | CONFIRMED / REFUTED / UNVERIFIABLE | <path:line or command output> |

### Findings
| Issue | Location | Severity |
|---|---|---|
| <what is wrong> | <path:line> | Critical / High / Medium / Low / Info |

### Verdict
SHIP / FIX FIRST / BLOCKED

### Could not check
- <claim> — <why it was not verifiable from here>
```

**Verdicts**

| Verdict | Meaning |
|---|---|
| `CONFIRMED` | I reproduced it independently, by a different method |
| `REFUTED` | I have a command or `path:line` showing it is false |
| `UNVERIFIABLE` | I could not check it from here — stated, never omitted |

**Severity ladder**

| Severity | Definition |
|---|---|
| Critical | Broken now, in production paths, no compensating control |
| High | Broken with effort, or critical but behind a compensating control |
| Medium | Real risk requiring preconditions, or a correctness bug with a workaround |
| Low | Minor risk, code quality, noise reduction |
| Info | Observation only — no action required |

Order findings Critical first, then High, Medium, Low, Info.

---

## 9. Failure modes and recovery

| Symptom | Do this |
|---|---|
| Both agents committed to the same branch | Stop. Neither force-pushes. Report both SHAs to the HITL; they pick the base, the other rebases |
| Your edit failed because the file changed underneath you | Re-read the file completely before retrying. Never retry the same edit blind |
| The other agent's claim does not match the tree | Do not fix it silently. Report the mismatch with the SHA you checked; the owner corrects it |
| Merge is clean but behavior is wrong | Semantic collision. Lanes overlapped. Escalate to the HITL and re-partition before continuing |
| You cannot tell who owns a file | Ask the HITL. One message, then wait |
| A task has needed three round trips | Stop. It was scoped wrong. Re-scope with the HITL rather than continuing |

---

## 10. Checklists

### One-time setup

- [ ] Each agent has its own worktree or clone; paths recorded
- [ ] Both agents have read this document
- [ ] Subsystem lanes assigned
- [ ] Each agent has declared, in writing, what it **cannot** run
- [ ] Branch naming convention agreed
- [ ] Remote push access confirmed for both

### Per task

- [ ] Tier decided (unsure → Tier 2)
- [ ] Task is inside my lane
- [ ] Branch created off the current base, and I am its only owner
- [ ] Work committed and **pushed**
- [ ] Handoff written with a pinned SHA, facts carrying commands
- [ ] Blocked items declared with exact commands
- [ ] (Tier 2) Validation report received and resolved
- [ ] Branch deleted after the HITL merges

---

## 11. Project bindings

*Replace this section when reusing this SOP on another project.*

**Project:** DAX — `/Users/Shailesh/MYAIAGENTS/dax`

| Binding | Value |
|---|---|
| Canonical agent rules | [AGENTS.md](../AGENTS.md) — read first, this SOP does not override it |
| Branch naming | `<type>/<short-desc>`, type ∈ `feat` `fix` `chore` `docs` `refactor` `test` `release` |
| Pull requests | Not used. Push the branch; the maintainer merges directly and deletes it |
| Commit attribution | Authored as the maintainer. No agent co-author trailers |
| Findings output | [docs/skills/OUTPUT_CONTRACT.md](./skills/OUTPUT_CONTRACT.md) |
| Tier 2 by default | `.github/workflows/`, release scripts, `src/governance/`, `src/state/events/`, `src/execution/`, `docs/product/claims-and-evidence.md` |

### Gates, matched to the diff

Run what the change can actually break. Blanket full-suite gates on a prose edit are cost without signal, and cost without signal is how gates come to be skipped.

| Change | Gate |
|---|---|
| Documentation or comments only | None beyond review |
| Application code | `bun run typecheck` and `bun run test` |
| Native/Rust code | also `bun run rust:verify` |
| Integration or pre-merge of a Tier 2 branch | `bun run release:gates` |
| Final tagged release | `DAX_RELEASE=1 bun run release:verify` |

`DAX_RELEASE=1` is required for release validation. Without it the clean-tree and tag-equals-HEAD checks do not run, and the command reports success for a state the tag would reject.

Do not run `bun run eval:smoke` alongside `release:gates` — `release:gates` already invokes it. Running both duplicates the slowest gate for no added coverage.

### Lanes for this cycle

| Owner | Implementation lane |
|---|---|
| Claude Code | Execution authority — governance, canonical events and state, execution, workers and workflows, the Rust proof crates and their bridges and tests. One owner, because the boundary is tightly coupled |
| Codex | Operator surfaces — CLI and TUI, presentation of approvals, recovery and evidence, SDK-facing usability, build/release/CI tooling and their tests |
| Named per task | Root configuration, shared schemas, cross-lane interfaces |

Documentation follows its subsystem. Public claims are Tier 2 regardless of lane.

### Known environment facts

Verified by both agents. Recorded because both of us initially assumed otherwise.

| Fact | Consequence |
|---|---|
| `package.json` pins `bun@1.4.0`; both agents have 1.3.9 | Full builds and installs are unverified on both sides. Do not report a build as passing until this is reconciled |
| Docker daemon unreachable for **both** agents (CLI present, socket absent) | Docker-dependent checks are routed to neither. They are blocked, not assigned |
| Codex has PTY and multi-call process supervision | Route TUI verification and interactive flows there |
| Codex network and sibling-worktree writes need escalation, not blocked | Possible, but not free — do not assume default access |
| Human authentication stays human-owned | Neither agent performs credential flows |

A capability claimed but not exercised is `UNVERIFIABLE`, not available. `docker --version` proves a CLI exists; only `docker info` proves a daemon answers.
