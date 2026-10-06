# Compiled TaskTool producer correction

Base: `94c638b02833f70b60fd0f4e7d444dd03ebb20aa`. Sole-owner validation;
no independent review, merge or release is claimed.

## Defects and correction

A genuinely compiled, activated reviewed root dispatched TaskTool through a
controlled local HTTP provider. With an eligible `general` child, the new child
prompt sorted before messages copied by `Session.fork`, because its ID was
allocated before the fork. The child selected a copied parent turn rather than
its own instruction. Allocate the new turn ID after copying history.

After that correction, the actual child read completed but TaskTool settlement
failed JSON validation: inherited model selection produced an undefined
`metadata.model`. Omit this optional field when unspecified. No result schema
is weakened and explicit model metadata remains unchanged.

## Production controls

The compiled fixture uses actual run creation, review approval, publication,
activation, TaskTool, child prompt loops and local provider requests. No
implementation-image, authority, executor or provider spy is used.

- Fresh delegation durably records the actual parent and selected child, then
  completes a real read under the parent's contract.
- Resume uses that same child and completes a second read; journal replay equals
  the projected state.
- A grant names an unavailable agent. TaskTool refuses fallback, records failure,
  creates no delegation record and leaves the entire stored session population
  unchanged. Checking UI `parentID` alone would miss ordinary fork sessions.

Initial fixture diagnostics wrongly requested primary agent Explore and assumed
fork UI ancestry. Those expectations were corrected; they were fixture errors,
not production defects. The retained ordering red log uses eligible `general`
and journal ancestry; the metadata red log is after the ordering correction.

## Validation

Pinned Bun 1.4.0, repo-root preload and isolated fixture homes. Full release gates:
**2,377 passed, 2 skipped, 0 failed**, including typechecks, lint, smoke, Rust and
release checks. The final strengthened session-population control and formatting
were subsequently checked with compiled/delegation regression tests:
**13 passed, 0 failed, 80 assertions**. Lockfile and manifests are unchanged.
Exact-commit three-platform CI remains required before integration.

This fills compiled delegation acceptance; actual remote MCP dispatch and
process-interruption acceptance remain outstanding. Two candidate grant gaps
remain open. v1.5.0, frozen evidence and the installed binary remain unchanged.

## Evidence

Compressed files are under `evidence/`; hashes cover decompressed bytes.

| Log | SHA-256 |
| --- | --- |
| `delegated-producer-ordering-red.log.gz` | `df0e46c41bab1a058465f3b22f59befa9c3db659a1864870e2f84c6a49e31f9c` |
| `delegated-producer-metadata-red.log.gz` | `86961572e281653305f01a6d330306ff95563985689b443bf9cc211cbecbbdff` |
| `delegated-producer-final-focused.log.gz` | `e4decea01359554a989d0b9d370ae57d5c25969e580e948d59d5ac4d78c999c9` |
| `delegated-producer-gates.log.gz` | `5645a8462c7374b2567a434c768fbe74324cd02db9918b0257eefae8673d0891` |
