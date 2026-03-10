# DAX Artifacts Behavior Pass

This pass identifies the current artifact substrate in canonical DAX, compares it with donor semantics, and defines what should shape `dax artifacts` v1.

The goal is behavioral clarity, not storage archaeology.

## 1. Canonical Runtime Reality

### Source

[packages/dax/src/session/processor.ts](../packages/dax/src/session/processor.ts)

### Behavior Discovered

- completed tool results persist:
  - output text
  - tool metadata
  - attachments
- each tool result is linked to:
  - session id
  - message id
  - part id
  - execution timing

### Operator Value

- what did this execution step produce?
- what output is available to inspect from a tool run?

### Current Visibility

- partially exposed

### Relevance To `dax artifacts`

- absorb now

Notes:

- this is one of the strongest canonical artifact substrates because it links retained output to actual execution steps.

---

### Source

[packages/dax/src/tool/truncation.ts](../packages/dax/src/tool/truncation.ts)

### Behavior Discovered

- oversized tool output is persisted to a stable file path under global tool-output storage
- tool metadata records `outputPath` when truncation occurs
- retained output is explicitly meant for later inspection

### Operator Value

- where is the full output for a truncated command or tool result?
- what retained output should I inspect next?

### Current Visibility

- internal only, with inline hints in tool output

### Relevance To `dax artifacts`

- absorb now

Notes:

- this is a real retained-output mechanism with clear operator meaning.

---

### Source

[packages/dax/src/session/summary.ts](../packages/dax/src/session/summary.ts)

### Behavior Discovered

- session diffs are computed and persisted as `session_diff`
- user messages can retain summary titles and message-level diff summaries
- diffs are broadcast as a first-class session review surface

### Operator Value

- what changed in this session?
- what file-level work product was produced?

### Current Visibility

- already surfaced in TUI and partially in session tooling

### Relevance To `dax artifacts`

- absorb later or reference from v1

Notes:

- diffs are important outputs, but they may remain a parallel review surface rather than the first artifact-listing primitive.

---

### Source

[packages/dax/src/session/message-v2.ts](../packages/dax/src/session/message-v2.ts)

### Behavior Discovered

- file parts and tool attachments are part of the canonical message model
- retained outputs can be represented as structured parts, not only plain text

### Operator Value

- what file or resource outputs are attached to this session?
- what structured outputs exist beyond transcript text?

### Current Visibility

- internal only to partially exposed

### Relevance To `dax artifacts`

- absorb now

Notes:

- this is important because it shows artifacts are not just files on disk; they can be structured output references.

---

### Source

[packages/dax/src/share/share-next.ts](../packages/dax/src/share/share-next.ts)

### Behavior Discovered

- sessions, messages, parts, and session diffs are treated as synchronizable shareable outputs
- the share system already assumes output bundles have operational meaning

### Operator Value

- what outputs are stable enough to share or export?
- what retained session products exist beyond the live terminal?

### Current Visibility

- internal only

### Relevance To `dax artifacts`

- absorb later

Notes:

- this supports the long-term artifact/export story, but should not overload `dax artifacts` v1.

---

### Source

[packages/dax/src/cli/cmd/tui/routes/session/index.tsx](../packages/dax/src/cli/cmd/tui/routes/session/index.tsx)

### Behavior Discovered

- the current artifact pane shows the latest generated output stream from recent assistant/tool activity
- it behaves more like a live output preview than a retained artifact registry

### Operator Value

- what is the latest produced output?
- what should I inspect right now?

### Current Visibility

- already surfaced

### Relevance To `dax artifacts`

- doc only / reference

Notes:

- useful UX signal, but not sufficient as the CLI artifact model on its own.

## 2. Donor Semantics

### Source

[cli/commands/artifacts.ts](../cli/commands/artifacts.ts)

### Behavior Discovered

- explicit `artifacts` command
- JSON-first listing of retained outputs

### Operator Value

- show me what work products exist

### Current Visibility

- already surfaced in donor CLI

### Relevance To `dax artifacts`

- absorb now as operator language

Notes:

- the donor implementation is tiny, but the command semantics are strong and aligned with the control-plane direction.

---

### Source

[core/artifacts/index.ts](../core/artifacts/index.ts)

### Behavior Discovered

- write and exec actions recorded as retained artifacts
- each artifact has:
  - id
  - timestamp
  - type
  - payload-specific details

### Operator Value

- what outputs were created by execution actions?
- what can I inspect or replay later?

### Current Visibility

- internal only behind donor CLI

### Relevance To `dax artifacts`

- absorb now as mental model, not storage design

Notes:

- the donor product idea is good:
  - outputs are retained
  - outputs are typed
  - outputs are inspectable later
- the donor storage shape should not be revived directly.

## 3. Canonical V1 Opportunity

What is already real in canonical DAX:

- retained tool outputs
- structured file attachments
- persisted truncated-output references
- session-linked diffs
- share/export-capable session parts

What is missing:

- a dedicated CLI surface that answers:
  - what retained outputs exist for my work?
- a simple operator-facing artifact metadata model

What should wait until later trust/evidence work:

- integrity or verification claims
- audit coupling
- evidence scoring
- release trust semantics

## 4. V1 Direction For `dax artifacts`

`dax artifacts` v1 should answer one core operator question:

`What retained outputs exist for my work?`

That suggests:

- list artifacts
- show basic metadata
- keep session linkage visible
- support readable and JSON output

It should not attempt:

- generic file browsing
- trust verification
- artifact mutation
- lifecycle management

## 5. Reuse Matrix

| Source | Behavior | Current Visibility | Relevance | Decision |
| --- | --- | --- | --- | --- |
| `session/processor.ts` | session-linked tool outputs and attachments | partially exposed | high | absorb now |
| `tool/truncation.ts` | persisted full output references for truncated results | internal only | high | absorb now |
| `session/message-v2.ts` | structured file and attachment parts | internal only / partial | high | absorb now |
| `session/summary.ts` | persisted session diffs | already surfaced | medium | absorb later |
| `share/share-next.ts` | shareable bundled session outputs | internal only | medium | absorb later |
| donor `artifacts` command | explicit operator listing surface | surfaced in donor CLI | high | absorb now as command semantics |
| donor `core/artifacts` storage | typed retained outputs | internal only | medium | absorb mental model only |

## 6. Next Step

Use this pass to define `docs/DAX_ARTIFACTS_IMPLEMENTATION_V1.md` before implementing `packages/dax/src/cli/cmd/artifacts.ts`.
