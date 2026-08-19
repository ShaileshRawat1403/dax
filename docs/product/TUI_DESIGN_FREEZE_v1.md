---
title: DAX TUI Design Freeze (v1)
archetype: product
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - product
  - tui
---

# DAX TUI Design Freeze (v1)

This document is the canonical stream contract for the DAX session screen.

The previous mockup is now retired.
This version replaces it in full.

Scope:

- session screen only
- stream presentation only
- no full layout redesign

The goal is to stabilize the DAX stream so it feels conversational for non-developers, trustworthy for serious work, and calm enough to ship as a release-grade surface.

---

## Product intent

DAX should feel like a capable guide with receipts.

That means:

- the stream speaks in plain English
- the stream stays warm without becoming chatty
- evidence stays visible and inspectable
- shell execution feels real, not abstracted away
- tool activity supports the story instead of flooding it

The stream should not feel like:

- a raw trace dump
- a stitched reasoning scratchpad
- a dashboard pretending to be a conversation
- a theatrical AI persona

---

## Voice target

DAX should sound:

- bright
- clear
- warm
- slightly witty when it helps
- professional under pressure
- never robotic
- never cute for its own sake

Examples:

- "I’m checking the release gates first, so we don’t build a plan on wishful thinking."
- "The good news: the release check passes. The less good news: doctor is still blocked on the Vertex lane."
- "I’ve got enough evidence now to make this concrete."

Avoid:

- "Thinking through the next action."
- "Captured target to keep the run grounded."
- "Carry that structure into the next visible step."
- "Oops: step failed."
- "Hydrating execution context."

Rule:

- conversational does not mean verbose
- friendly does not mean playful in every turn
- reasoning should increase clarity, not increase word count

---

## Core stream principle

The primary stream should answer, in order:

1. what DAX is doing
2. what DAX found or changed
3. what evidence supports that
4. what happens next

This is the stable contract.

If a stream element does not help answer one of those questions, it should not be primary.

---

## Final stream structure

Every meaningful assistant turn should render in this order:

1. `Intent`
2. `Progress` or `Outcome`
3. `Evidence`
4. `Next`

### 1. Intent

Purpose:
Set the frame in one sentence.

Rules:

- always short
- plain English
- no filler
- should make sense even if read alone

Examples:

- "I’m checking release readiness against the repo’s current gates."
- "I’m fixing the stream so completed shell work stays visible."

### 2. Progress

Purpose:
Explain the live move while work is active.

Rules:

- show only while live
- one sentence
- name the real operation, not generic thinking
- light wit allowed, but only if it stays useful

Examples:

- "I’m validating the release scripts, changelog alignment, and doctor output."
- "I’m pulling the strongest evidence first so the plan stays grounded."

### 3. Outcome

Purpose:
State the conclusion once useful work has landed.

Rules:

- one short paragraph or two short sentences
- lead with the conclusion
- mention blockers plainly
- do not recap every tool

Examples:

- "Release check passes. Doctor is blocked by Vertex auth, which only matters if that lane is in scope for this cut."
- "The stream model is the real problem here. Styling alone won’t fix it."

### 4. Evidence

Purpose:
Show proof without turning the stream into a log viewer.

Allowed evidence cards:

- `Shell`
- `Sources`
- `Changes`
- `Checks`
- `Approval`

Rules:

- default to at most 2 visible evidence cards per turn
- evidence cards persist after completion
- shell is first-class evidence
- evidence summaries stay compact
- expanded detail is allowed, but not forced into the primary flow

### 5. Next

Purpose:
Make the next move obvious.

Rules:

- exactly one next move
- active voice
- either DAX-next or user-decision, never both mixed together

Examples:

- "Next: I can turn this into a strict go/no-go checklist for the next release."
- "Next: decide whether Vertex readiness is in scope for this release."

---

## Shell contract

Shell execution must feel like a live terminal process, not a hidden implementation detail.

### While running

Shell cards must show:

- command
- purpose
- live process state
- live output preview

The running shell card should feel like active terminal evidence.

It must not collapse into a vague spinner plus prose.

### After completion

Completed shell cards must remain visible as durable evidence cards.

They must show:

- command
- purpose
- result state
- output preview
- exit status when relevant
- duration when available

Completed shell work must not degrade into a dim one-line footnote.

### Tone for shell cards

Shell presentation should feel:

- professional
- calm
- inspectable
- precise

It should not feel:

- ornamental
- noisy
- overly gamified

---

## Tool presentation contract

Tools should support the conversational story instead of replacing it.

### Tool hierarchy

High-value tools for the main stream:

- shell
- write
- edit
- apply_patch
- approval-related actions
- high-signal checks

Secondary tools:

- read
- list
- glob
- grep
- webfetch
- websearch

### Main rule

Read/list/grep-style activity should usually be summarized into one compact `Sources` or `Checks` card, not emitted as repetitive narrative rows.

The user should see:

- what DAX reviewed
- why that evidence mattered

The user should not see a long parade of nearly identical "Reviewed X sources" blocks.

### Tool verbosity rules

Primary stream:

- keep only the strongest evidence
- keep the latest durable shell/check/change cards
- summarize discovery work compactly

Expanded detail:

- may show more file rows
- may show more command output
- may show tool-by-tool detail

But expanded detail is secondary, not the main story.

---

## Final frozen mockup

### A. Active planning turn

```text
┌──────────────────────────────────────────── DAX ────────────────────────────────────────────┐
│ planner  understanding  trust: review                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ I’m checking release readiness against the repo’s current gates.                            │
│                                                                                              │
│ I’m validating the release scripts, changelog alignment, and doctor output.                 │
│                                                                                              │
│ ╭─ Shell ───────────────────────────────────────────────────────────── live ───────────────╮ │
│ │ bun run release:check                                                                    │ │
│ │ Purpose: Run the repository release gates                                                │ │
│ │                                                                                          │ │
│ │ release-check: wrote artifacts/doctor-auth.json                                          │ │
│ │ release-check: wrote artifacts/release-provenance.json                                   │ │
│ │ release-check: ok                                                                        │ │
│ ╰──────────────────────────────────────────────────────────────────────────────────────────╯ │
│                                                                                              │
│ Next: I’ll compare that result with doctor status and version alignment.                     │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### B. Completed analysis turn

```text
┌──────────────────────────────────────────── DAX ────────────────────────────────────────────┐
│ planner  planning  trust: review                                                            │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ I checked release readiness against the repo’s current gates.                               │
│                                                                                              │
│ Release check passes. Doctor is blocked by Vertex auth, which is only a blocker if          │
│ Vertex support is part of this release.                                                     │
│                                                                                              │
│ ╭─ Checks ────────────────────────────────────────────────────────────────────────────────╮  │
│ │ Release check: pass                                                                     │  │
│ │ Version alignment: changelog and package version match                                  │  │
│ │ Doctor: blocked on optional provider lane                                               │  │
│ ╰──────────────────────────────────────────────────────────────────────────────────────────╯  │
│                                                                                              │
│ ╭─ Sources ───────────────────────────────────────────────────────────────────────────────╮  │
│ │ RELEASE_GATES.md                                                                        │  │
│ │ docs/product/release-readiness.md                                                       │  │
│ │ .github/workflows/ci.yml                                                                │  │
│ ╰──────────────────────────────────────────────────────────────────────────────────────────╯  │
│                                                                                              │
│ Next: decide whether Vertex readiness is in scope, then I can turn this into a strict      │
│ go/no-go checklist.                                                                         │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### C. Blocked turn

```text
┌──────────────────────────────────────────── DAX ────────────────────────────────────────────┐
│ verifier  verifying  trust: action-needed                                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ I hit a blocker while checking the release readiness path.                                  │
│                                                                                              │
│ The doctor run is failing on missing Vertex configuration, so I can’t call that lane        │
│ healthy from the current environment.                                                       │
│                                                                                              │
│ ╭─ Check ───────────────────────────────────────────────────────────── exit 1 ─────────────╮ │
│ │ bun run --cwd packages/dax src/index.ts doctor --json                                    │ │
│ │ Purpose: Check readiness across subsystems                                                │ │
│ │                                                                                          │ │
│ │ ...                                                                                      │ │
│ │ missing google vertex project configuration                                              │ │
│ ╰──────────────────────────────────────────────────────────────────────────────────────────╯ │
│                                                                                              │
│ Next: either mark Vertex as out of scope for this release or fix that lane before ship.    │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### D. Coding turn for non-dev users

```text
┌──────────────────────────────────────────── DAX ────────────────────────────────────────────┐
│ dax  executing  trust: clear                                                                │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ I’m fixing the shell evidence card so completed commands stay visible in the stream.        │
│                                                                                              │
│ The change is in. Completed shell commands now stay on screen with purpose, result, and     │
│ output preview instead of collapsing into a throwaway line.                                 │
│                                                                                              │
│ ╭─ Changes ───────────────────────────────────────────────────────────────────────────────╮  │
│ │ packages/dax/src/cli/cmd/tui/routes/session/index.tsx                                   │  │
│ │ - keep shell cards visible after completion                                              │  │
│ │ - pin latest shell evidence in the narrative slice                                       │  │
│ ╰──────────────────────────────────────────────────────────────────────────────────────────╯  │
│                                                                                              │
│ ╭─ Check ───────────────────────────────────────────────────────────── completed ──────────╮ │
│ │ bun run --cwd packages/dax typecheck                                                     │ │
│ │ Result: pass                                                                             │ │
│ ╰──────────────────────────────────────────────────────────────────────────────────────────╯ │
│                                                                                              │
│ Next: I can now refine the stream contract instead of patching around it.                   │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## What should be hidden by default

Hide unless explicitly expanded:

- raw reasoning chains
- more than 3 source rows
- repetitive read/list/grep traces
- timestamps on every message
- absolute paths when relative paths are enough
- multiple progress restatements in one turn
- low-signal tool chatter

---

## What should always stay visible

Always visible:

- current intent
- current live progress, if any
- strongest evidence card
- current conclusion or blocker
- next move

---

## Anti-drift rules

1. The stream is the conversational truth.
2. Evidence supports the story; it does not drown it.
3. Shell stays first-class and durable.
4. Discovery work is summarized, not spammed.
5. The user should never need to parse internal tool semantics to understand progress.
6. One fact should have one primary home in the session UI.
7. If a line sounds synthetic, rewrite it in plain English.
8. If a card looks decorative but not useful, remove it.

---

## Acceptance criteria

A stream change is acceptable only if all are true:

1. Greeting or trivial runs stay short and do not fabricate activity.
2. Planning runs feel conversational without turning into prose dumps.
3. Shell commands display as live process evidence while running.
4. Completed shell commands remain visible as durable evidence.
5. Read/list/grep activity is summarized cleanly instead of repeated row by row.
6. Mutation runs show changes and verification clearly.
7. Blocked runs make the blocker and the decision boundary obvious.
8. The stream feels stable enough that another redesign is not immediately warranted.

---

## Change control

Any change to this freeze requires:

1. updating this file
2. stating operator or end-user value
3. showing before/after stream examples
4. explicitly naming what changed in `Intent`, `Progress`, `Outcome`, `Evidence`, or `Next`

---

## Canonical summary

The target DAX stream is:

- conversational
- calm
- evidence-backed
- non-dev friendly
- professional enough for enterprise use

It should feel like a sharp guide with live receipts.

Not a chatbot monologue.
Not a trace dump.
Not a dashboard masquerading as conversation.
