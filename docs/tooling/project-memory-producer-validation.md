# Operator-reviewed project memory producer

Base: `33bfebd220230376b80241256d6fcf1dedb7c703`.
Codex sole implementation and validation; no independent review claimed.

## Operator protocol

The existing privileged mutation channel protects all three endpoints:

1. `POST /project/facts/candidates`: supply an active canonical `runId`, a
   stable `pfc_` ID followed by 32 lowercase hexadecimal characters, and a
   schema-valid project-fact `change`. Conflicting retry content is rejected.
2. `GET /project/facts/candidates/:candidateID`: inspect the exact candidate
   content and its digest before deciding.
3. `POST /project/facts/candidates/:candidateID/review`: supply that exact
   `digest`, a nonblank operator `actor`, and `approved` or `rejected`.

The actor is a label supplied through DAX's existing trusted operator channel,
not a cryptographic human identity. Candidates are not active memory. Approval
and its exact content commitment are durably recorded before project publication.
The model cannot automatically promote its candidate. Failed publication can
resume against the persisted decision without duplicating the project fact.
A committed project event survives source-run retention. Retirement and
supersession use the same review protocol. No new event vocabulary is introduced.

## Scope and acceptance

Fresh SessionPrompt intent consumes active approved journal memory. A real
protected HTTP producer and fresh production consumer are exercised together;
retirement is exercised through the same HTTP path. The provider boundary is
controlled and deliberately rejects before a model call: these tests establish
intent consumption, not a successful real-provider response.

Focused tests: 16 passed, 0 failed, 85 assertions. Controls cover pending and
rejected candidates, changed review digests, conflicting concurrent publication,
mutated snapshots, publication interruption/retry, source-run retention, malformed
journal rejection before dispatch, and retired memory exclusion. Restoring the
missing digest check makes the negative control fail. Initial consumer fixtures
failed because their switched test home lacked a config directory and because an
expectation exceeded the existing 80-character intent excerpt; these fixture
failures are retained and are not presented as production causes.

Full Bun 1.4.0 release gates passed: 2,357 tests passed, two skipped, zero
failed, 8,973 assertions; typechecks, lint, five smoke evaluations, Rust and
release/integrity checks passed. Exact-commit hosted CI remains required. [Retained logs](evidence/project-memory-producer/README.md).

This proposes closure of `memory.no-producer` only. Legacy SQL constraints and
preferences remain outside the approved journal projection, leaving the aggregate
project-journal integration gap open. Historical rows are not silently promoted.
There is no new memory UI or automatic migration. OS process-kill recovery is
not claimed; tests inject persistence-boundary failures. No main integration,
release, installed binary replacement, or frozen evidence change.
