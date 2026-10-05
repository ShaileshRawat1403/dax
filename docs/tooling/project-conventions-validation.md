# Approved project conventions in production dispatch

Base: `008f633286d08069df8d9f41cf7d4c1e1913b851`.
Codex sole implementation and validation, not independent cross-validation.

Production SessionPrompt now reads active `convention` facts from the project
journal on every model dispatch. Pending candidates contribute nothing. Approved
conventions are ordered by promotion sequence, supplied as system instructions,
and recorded under the explicit `project_convention` prompt source kind using
an opaque project event reference. The existing post-plugin commitment pipeline
continues to distinguish supplied sources from surviving effective input.

Raw convention titles/content are not copied to the run journal. Continuation
requires the project store; run replay reconstructs commitments and references,
not the original convention text. Malformed authority propagates before provider
dispatch. Retirement excludes the fact from later turns. Journal conventions do
not mint grants or override permission, scope, verification or completion checks.
They are operator-authored model instructions, not executable policy rules.

The actual SessionPrompt loop and provider-adapter path are tested with controlled
streaming output: pending exclusion, approved input, commitment provenance,
raw-text omission, retirement on a later root session, and malformed-journal
rejection without provider input. Prompt/journal regressions passed 38 tests,
226 assertions before the additional controls. The final focused prompt,
scope and journal regression suite passed 45 tests, 265 assertions. The first
gate stopped at a test assertion typing/lint mismatch; the second found an
obsolete source-text scope test that mistook a provenance source label for an
event type. The corrected scope test checks actual event discriminants and
rejects every project transition in the run vocabulary. Both failures are
[retained](evidence/project-conventions/README.md). Full Bun 1.4.0 gates passed: 2358 passed, 2 skipped,
0 failed, 8991 assertions, with typechecks, lint, smoke, Rust,
integrity and release checks green. Exact-commit hosted CI remains required.

Adding a prompt source kind extends the event vocabulary; older binaries do not
support new records. Existing frozen release evidence remains untouched. No
project-journal gap closure is proposed: SQL preferences and constraints still
need an explicit authority/compatibility migration. No main integration, release,
installed binary replacement, or new UI.
