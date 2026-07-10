# BYOA Strategy: Govern the Agents, Don't Race Them

Status: decided 2026-07-10 (Shailesh + Fable 5 review, cross-checked against
Codex 5.5). This is the strategic frame for post-v1.1.x work. It amends, not
replaces, [product-doctrine.md](./product-doctrine.md) and
[POSITIONING.md](../product/POSITIONING.md).

## Product identity (decided)

> DAX is the governed execution workstation that can run its own agent loop
> or govern external coding agents as workers.

Two clauses, both load-bearing. DAX is not "just a wrapper": it remains the
authority — contract, run state, approval gates, kernel-computed diff
evidence, audit chain, receipt. External agents (Claude Code, Codex CLI,
Gemini CLI, whatever ships next) are **capability workers**: replaceable
execution engines inside DAX's contract. And DAX's own agent loop remains the
reference worker and fallback — the worker contract cannot be validated
without a worker we fully control.

## Why this lane

The raw coding-agent lane is owned by tools attached to frontier labs, and it
will keep moving faster than any solo project can track. Competing there
loses by default. The winnable position:

**Bring your own agent, keep your governance.**

Every improvement the labs ship makes DAX *better*, because better workers
produce better governed runs. No lab will occupy this position — it
commoditizes their agent.

## First buyer (decided)

Serious solo/pro builders working in real repositories who already use
Claude/Codex/Gemini and want receipts, approvals, rollback, and evidence.

NOT enterprise-first. Enterprise is the eventual market, earned only after
the receipt chain, recovery, and approval loop survive real repo work in
individual hands. Framing enterprise before that proof is hype.

## The defining proof (next concrete work)

One demo defines the category:

```
dax worker run claude|codex|gemini -- "<task>"
```

1. Operator invokes an external agent as a worker with a task.
2. DAX creates a clean worktree/capsule. **Egress is the load-bearing
   detail:** external agents need network to their own provider APIs, so the
   capsule egress gateway runs with an exact per-worker host allowlist
   (api.anthropic.com for Claude, etc.) — governed workers phone home;
   they do not reach anywhere else.
3. DAX passes an execution contract to the worker (task, write scope,
   verification expectations) in the worker's non-interactive mode.
4. The worker produces changes inside the capsule.
5. DAX computes the diff itself (kernel-owned, never worker-reported).
6. DAX pauses at the approval gate.
7. DAX writes the evidence receipt (runledger.evidence.v0 records; the
   worker's identity and version recorded as provenance, its output as
   attested generation — never gate-satisfying by itself).
8. Flowright can invoke the whole thing through the capability contract
   (flowright.capability.v0), receipt and all.

Implementation note: `dax worker run` is largely sugar over the existing
workflow `step.worker.command` capsule mechanism. The new work is the worker
adapter layer (per-agent non-interactive invocation + contract handoff), the
per-worker egress profiles, and the CLI surface.

## Robustness before features

Priority order:

1. **Core-loop hardening.** Latency, crash recovery, resume, doctor
   truthfulness. A governed tool that flakes once loses the trust that IS
   the product.
2. **The BYOA proof above**, with evidence receipts, as a scripted,
   repeatable demo — not a video.
3. **Command-surface discipline (decided method).** Freeze new commands
   now. Classify all ~32 existing commands as core / advanced / internal.
   Instrument usage. Deprecate with evidence through the existing
   deprecation tracker — no blind cuts.
4. **Gates over memory.** The eval scenarios, mutation-testing pilot, and
   release gates become enforced merge policy, so robustness is structural
   rather than remembered.

## Non-goals

- Beating frontier agents on raw coding quality.
- Becoming a generic worker launcher (the run object is the product).
- Enterprise features (SSO, org policy, fleets) before the solo/pro proof.
- New command surface while the freeze holds.

## The one-line test for any proposed feature

Does it make the governed run object more trustworthy, more recoverable, or
more legible? If not, it waits.
