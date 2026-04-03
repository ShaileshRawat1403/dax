# DAX TUI Design Freeze (v1)

This document freezes the intended DAX TUI behavior so UI work can move forward without drift.

Scope: session screen only.
Layout: keep the current 3-panel system.

1. Left panel: conversational run narrative.
2. Right panel: governance/control plane.
3. Bottom panel: prompt and submit controls.

No structural layout redesign is part of this freeze.

---

## Product intent

DAX should feel like a governed operator workstation:

- Left panel explains what is happening in human terms.
- Right panel shows operational truth and required actions.
- Bottom panel remains the command entry surface.

If the same information appears in both left and right, it is drift.

---

## Final mockup (frozen target)

```text
┌────────────────────────────────────────────── DAX HEADER ──────────────────────────────────────────────┐
│ DAX • mode PLAN • lifecycle PLANNING • trust REVIEW_NEEDED • model GPT-5.3 • tokens 12,441 • 0.00    │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────── LEFT: CONVERSATIONAL RUN ────────────────────────────┬── RIGHT: GOVERNANCE ─┐
│ I started by reading the memory module to understand current state.              │ Run State: ACTIVE     │
│                                                                                   │ Workflow: PLAN        │
│ Then I searched memory-linked usage across the repo to map where it fans out.    │ Repo: /.../dax        │
│ I found 14 matches in 5 files, mostly around command formatting paths.            │                       │
│                                                                                   │ Evidence Ledger       │
│ Based on that, the safest next step is inspecting writer serialization before     │ 1) READ pm/index.ts   │
│ proposing edits.                                                                   │    -> done            │
│                                                                                   │ 2) GREP pm_note|memory│
│ If you want, I can now produce a 3-option edit plan with risk levels.            │    -> 14 matches      │
│                                                                                   │                       │
│ [USER] review my memory state                                                     │ Constraint            │
│                                                                                   │ no out-of-scope write │
│                                                                                   │                       │
│                                                                                   │ Next Operator Action  │
│                                                                                   │ approve writer check  │
└───────────────────────────────────────────────────────────────────────────────────┴───────────────────────┘
┌────────────────────────────────────────────── PROMPT BAR ────────────────────────────────────────────────┐
│ Plan  |  model gpt-5.3  |  Submit [enter]                                                               │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Behavior contract

### Left panel (narrative)

Goal: explain progress clearly, not dump raw traces.

Per assistant turn, default structure:

1. What I am doing.
2. What I found.
3. What I will do next.

Rules:

- Prefer short narrative paragraphs.
- Include concrete evidence only when high-signal.
- Do not repeat `why/next` boilerplate for every tool row.
- Do not list long absolute paths unless necessary to resolve ambiguity.
- For trivial runs (greeting/small chat), keep response short and do not fabricate operational activity.

### Right panel (governance)

Goal: operator truth and actionability.

Required sections (as relevant):

- `STATUS`
- `NOW`
- `EVIDENCE`
- `NEXT OPERATOR ACTION`
- `CONSTRAINT/TRUST` (only when non-clear)

Rules:

- Evidence is compact: latest 1-3 high-signal items.
- Show approvals/interventions only when present.
- Avoid filler text such as generic “state will populate”.

### Bottom panel (prompt)

Goal: stable command entry.

Rules:

- Keep existing mode/model/submit semantics.
- No new controls in this freeze.

---

## Mode behavior (operator vs inspect)

Operator mode:

- Narrative left + governance right.
- Keep center content dense but readable.

Inspect mode:

- Same 3-panel layout.
- Permit more evidence density in right panel and message metadata in left.
- Do not change structure; only increase detail visibility.

---

## Anti-drift rules

1. Left explains; right governs; bottom inputs.
2. One fact should have one primary home.
3. No raw trace spam in left panel.
4. No generic narration in right panel.
5. Any new UI copy must answer: what happened, why it matters, what operator does next.

---

## Acceptance criteria

A change is accepted only if all are true:

1. Greeting run stays concise and does not produce fake operational trace.
2. Planning run shows narrative left and compact evidence right without duplication.
3. Mutation run shows concrete evidence in right pane and clear next operator action.
4. Approval-required run highlights approval in right pane and narrative reflects wait state.
5. Inspect mode increases detail without changing layout or introducing duplicate sections.

---

## Non-goals for this freeze

- No full theme redesign.
- No new pane architecture.
- No additional tabs.
- No emoji-heavy stylistic changes.

---

## Change control

Any change to this design freeze requires:

1. Mockup update in this file.
2. Statement of operator value.
3. Before/after screenshot comparison.
4. Explicit note of what section ownership changed (left/right/bottom).

