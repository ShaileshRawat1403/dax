---
name: "agentic-loop-audit"
description: "Audit an agent's main loop for halting conditions, mutation budgets, loop breakers, sensitive-path guards, error recovery, and replayability. Returns impact-ordered findings tables."
---

# Agentic Loop Audit

Use this skill when the task is to review the *control flow* that drives an AI agent — the loop that decides when to call a tool, when to think again, when to stop, and what to do when something goes wrong. Loops without halting conditions are how agents melt down a credit card or a database.

## Use when

- a new agentic loop is being designed
- an agent ran longer or did more than expected and the question is why
- a runaway-loop incident occurred
- the team is adding budget caps and wants to know whether the existing guards are enough

## Workflow

1. **Find the loop.** Locate the main agentic loop body. It usually looks like:
   ```
   while not done:
     plan / model call
     execute tool(s)
     observe
     decide
   ```
   Note the file, the entry point, and what counts as one iteration.
2. **Halting conditions.**
   - Explicit success: the model signals done, or a goal predicate is satisfied
   - Explicit failure: the model gives up, or a non-recoverable error occurs
   - Budget exhaustion: iteration count, wall-clock time, token spend, dollar spend, mutation count
   - At least one of these must be active at all times; flag missing or weak conditions
3. **Mutation budget.**
   - Hard cap on number of file/shell mutations per session
   - Hard cap on external side effects (PR creates, messages sent, deploys)
   - Cap is enforced *before* the call, not detected after
4. **Loop breakers.**
   - Detect repeated tool calls with identical arguments and stop
   - Detect oscillation (A → B → A → B) and stop
   - Detect "no progress" iterations (same plan, same outcome) and escalate or stop
5. **Sensitive-path guards.**
   - Calls that touch `.env`, `.git/`, credential files, or system paths are routed through the approval path
   - Guard runs *before* the call, not as a check on the result
   - Guard cannot be bypassed by a creative path encoding (`../`, symlinks, case-folding)
6. **Approval and pause.**
   - When a guard fires, the loop pauses cleanly — no partial state, no orphan listeners
   - The user can resume, deny, or abort
   - Timeouts expire pending approvals; listeners unsubscribe
7. **Error recovery.**
   - Transient errors retried with backoff and jitter, bounded
   - Permanent errors fail the loop with a clear message — no silent retry forever
   - Errors do not leak secrets or stack traces to the model
8. **Idempotency and replay.**
   - Each iteration's effect is captured in an append-only event log
   - The session can be replayed from the log and reach the same state
   - Replays do not re-trigger external side effects
9. **State boundary.**
   - The agent's mutable state is well-defined: session-scoped, not process-global
   - Concurrent sessions do not share mutable state
10. **Observability.**
    - Each iteration emits a structured event (plan, tool call, result)
    - Budget consumption is visible to the operator in real time
    - The loop can be traced end-to-end by a session id

## Checks

- Distinguish "loop can run forever in pathological case" (High/Critical) from "loop has a high default budget" (Medium)
- A budget that the model can extend by itself is not a budget — flag self-raising caps
- For DAX specifically: `RELEASE_GATES.md` already names mutation budgets, loop breakers, sensitive-path guards, and rollback anchors — credit existing guards and focus on coverage gaps

## Output contract

Findings follow [docs/skills/OUTPUT_CONTRACT.md](../../docs/skills/OUTPUT_CONTRACT.md).

Return:

1. **Verdict** — one line + a small table:
   - `Loop entry`, `Halting conditions`, `Mutation budget`, `Loop breakers`, `Replayable?`
2. **Counts** — Critical/High/Medium/Low/Info totals
3. **Findings** — one table per category, ordered by impact:
   - Halting conditions
   - Mutation and side-effect budgets
   - Loop breakers and oscillation detection
   - Sensitive-path guards
   - Approval / pause correctness
   - Error recovery
   - Replay and idempotency
   - Observability
4. **Open questions / assumptions** — intended budget caps, intended approval policy
5. **Residual risk** — properties only visible at runtime (real failure modes, real cost)
6. **Next actions** — concrete fixes ordered by impact

## Evidence to collect

- Loop entry file:line and a description of one iteration
- Halting predicate(s) and budget values verbatim
- Sensitive-path patterns enforced (regex / glob)
- Approval mechanism: where it fires, how it pauses, how it resumes
- Event log location and schema
