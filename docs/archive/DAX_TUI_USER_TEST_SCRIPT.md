# DAX TUI User Test Script

This document defines the first real user-test pass for the current DAX workstation branch.

It should be used only after:

- the workstation mockup is frozen
- the `/explore` session path uses the real deterministic graph backend
- `typecheck`, `test`, and `check:repo` are green

## Goal

Validate the first user-testable workstation session as a product, not just as code.

The test should answer:

- does the stream feel calm and operational?
- does the sidebar feel useful and not noisy?
- do overlays feel like the right home for detail?
- does `/explore` prove the first true agentized TUI flow?

## Preconditions

Run these first:

```bash
bun run typecheck:dax
bun run test
bun run check:repo
```

Then launch the TUI:

```bash
bun run --cwd packages/dax src/index.ts
```

## Test 1: First Agentized Workstation Flow

Prompt:

```text
/explore .
```

Expected stream shape:

- `Intent interpreted`
- `Plan created`
- `Boundary pass completed`
- `Entry-point pass completed`
- `Execution-flow pass completed`
- `Integrations pass completed`
- `Report prepared`

Checks:

- milestones appear in order
- milestones stay short and verb-first
- the stream still feels like execution narrative, not a log
- the final report is attached to the same assistant flow
- `Open detail` appears when the report is large

## Test 2: Detail Dialog Behavior

After `/explore .` completes:

- open the detail dialog from the final report
- close it with `esc`
- confirm focus returns predictably

Checks:

- detail stays out of the stream by default
- the dialog feels like evidence, not a second stream
- close/return behavior is calm and predictable

## Test 3: Sidebar Truth Coherence

During and after `/explore .`, check:

- `Lifecycle`
- `Stage`
- `Trust`
- `Release`
- `Approvals`
- `Artifacts`
- `Write governance`

Checks:

- sidebar remains compact and readable
- cards do not over-explain
- cards update without feeling noisy
- stream and sidebar do not duplicate each other

## Test 4: Overlay Flow

After the run, open:

- `timeline`
- `artifacts`
- `verify`
- `release`
- `inspect`

Checks:

- each overlay opens from the expected shortcut or card
- only one overlay is active at a time
- `esc` closes the overlay and restores prior focus
- overlays explain evidence instead of dumping raw internals

## Test 5: Width Degradation

Repeat the workstation check at:

- `120+`
- `100–119`
- `<100`

Checks:

- stream remains dominant at all widths
- compact sidebar still feels usable at `100–119`
- truth strip fallback at `<100` is still readable
- footer shortcuts remain understandable
- no region fights for space

## Test 6: Second Explore Pass

Run a second prompt in the same session:

```text
/explore packages/dax
```

Checks:

- same session remains coherent
- stream continues from the existing context cleanly
- milestone behavior stays consistent
- no stale overlay or focus state leaks across turns

## Failure Signals

Capture any of these immediately:

- stream feels like a transcript again
- milestone rows feel noisy or repetitive
- sidebar starts repeating stream content
- overlays feel heavier than the information they contain
- focus restoration after dialogs or overlays is confusing
- narrow mode becomes unreadable

## Acceptance Standard

The workstation is ready for broader human testing when this script finishes and the user can say:

- I always knew what DAX was doing
- I always knew where the truth lived
- I always knew where to open evidence
- `/explore` felt like a real operator workflow, not a bolted-on command
