# DAX Artifacts Implementation V1

## 1. Goal

Expose retained execution outputs as a first-class inspectable CLI surface.

`dax artifacts` v1 should let operators inspect what work products exist without browsing storage internals or mixing in trust semantics.

## 2. Existing Substrate

The implementation should reuse canonical runtime behavior already present in:

- [packages/dax/src/session/processor.ts](../packages/dax/src/session/processor.ts)
- [packages/dax/src/session/message-v2.ts](../packages/dax/src/session/message-v2.ts)
- [packages/dax/src/tool/truncation.ts](../packages/dax/src/tool/truncation.ts)
- [packages/dax/src/session/summary.ts](../packages/dax/src/session/summary.ts)

Implementation rule:

- CLI owns exposure
- runtime remains the single source of retained output behavior

## 3. Command Purpose

Inspect retained execution outputs associated with DAX work.

This command should answer:

- what outputs exist?
- what kind of output is each one?
- which session did it come from?
- what should I inspect next?

## 4. Command Contract

Canonical target:

- `packages/dax/src/cli/cmd/artifacts.ts`

### Input Model

V1 should stay narrow.

Support:

- all artifacts
- optional session filter if already natural
- JSON output mode

Examples:

```bash
dax artifacts
dax artifacts --session <session-id>
dax artifacts --format json
```

### Output Model

Human-readable:

- artifact label or title
- artifact type
- related session
- created time when available
- location or reference when available

JSON:

- stable structured list
- enough metadata for later automation and inspection

## 5. V1 Artifact Metadata

At minimum:

- artifact id or stable derived reference
- artifact type
- session id
- title or summary
- created time when available
- source:
  - tool output
  - attachment
  - truncated output file
  - diff reference
- location or path when available

## 6. V1 Scope

Include:

- retained tool outputs with operator meaning
- attachments and file outputs where recoverable
- truncated-output references
- readable and JSON listing

Exclude:

- trust verification
- audit integrity
- generic filesystem browsing
- artifact mutation
- broad lifecycle management

## 7. Readability Rule

Artifacts should read like work products, not files.

Good framing:

- latest generated output
- truncated tool output
- attached file output
- session diff reference

Avoid:

- raw storage dump
- implementation-only identifiers without operator meaning

## 8. Likely Implementation Shape

1. collect retained outputs from canonical session/message/tool-output sources
2. normalize them into one artifact row shape
3. support session filtering
4. render readable list or JSON output

The command should be inspect-first and listing-first in v1.

## 9. Test Plan

Cover:

- empty artifact list
- artifact normalization from canonical sources
- JSON output contract
- session-filter behavior
- truncated-output path handling

At minimum:

- no artifacts
- one attachment-backed artifact
- one truncated-output artifact
- stable JSON shape

## 10. Docs Impact

Update when implementation lands:

- `README.md`
- `docs/start-here.md`
- `docs/non-developer-guide.md`
- `docs/ARTIFACTS.md`
- `docs/CANONICAL_OPERATOR_FLOW.md`

Key docs rule:

- `artifacts` inspects retained outputs
- trust/evidence remains separate

## 11. Non-Goals

- no trust verification
- no audit redesign
- no generic file browser
- no artifact editing
- no second storage model

## 12. Acceptance Signals

### Product

- operators can inspect what was produced
- artifacts feel session-linked and operational

### Architecture

- no parallel artifact store is introduced
- CLI reuses canonical retained-output substrate

### UX

- output is clear and inspectable
- session linkage is visible
- artifact scope does not blur into trust
