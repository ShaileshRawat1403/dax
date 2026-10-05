# Project settings authority cutover

Codex sole-owner implementation decision, 2026-10-05. Base convention candidate:
`80283a5a0b14bb9ab535d883155fcc633e1a749a`. No independent acceptance or release.

## Compatibility and authority

Existing SQLite data remains readable and unchanged for projects that have not
explicitly adopted journal-owned settings. Memory/convention promotion does not
implicitly enroll their preferences or constraints. Enrollment requires a
protected operator candidate, exact-digest review, and durable approval before
an atomic `project_settings_adopted` append.

The adopted payload names the exact legacy-settings digest and a complete typed
snapshot: risk mode, preferences, and constraints. The project lock serializes
legacy writes with adoption. A changed legacy snapshot rejects stale adoption;
there is no automatic import, row deletion, or inference that historical rows
were approved. The operator selects the exact proposed snapshot.

After adoption, effective PM reads use the project journal only. Legacy writers
refuse with a stable review-required error rather than mutating a second authority.
Replacing settings uses a complete snapshot and the exact prior settings event
ID; stale and concurrent replacements fail before publication. Retirement of a
constraint is represented by its absence from an explicitly reviewed replacement
snapshot. No setting grants tool authority or broadens contracts or permissions.

Run approvals retain only the exact project-change commitment and references.
Project replay preserves effective settings after source-run retention. Legacy
SQLite notes and RAO events remain diagnostics/telemetry, not parallel project
settings authority. Historical logs and frozen release evidence are unchanged.

## Production acceptance

- Real protected project API: adopt, inspect, review, replace, deny, retry.
- Effective PM preference, constraint and state readers switch only after adoption.
- Existing audit and operator consumers receive these projections; malformed
  authority must not become an empty/default policy through catch-and-fallback.
- Legacy projects keep existing settings behavior. Enrolled writers clearly
  request operator review; their user-facing commands must explain the protocol.
- Wrong digest, stale legacy snapshot, changed candidate, denied review, missing
  source, stale predecessor and concurrent replacement leave authority unchanged.
- Fault-injected publication retries produce one settings transition; replay
  after source-run removal preserves it.
- Full pinned Bun gates and exact-SHA Ubuntu/macOS/Windows CI before integration.

No aggregate closure is claimed by this design. All producer/reader/compatibility
controls must pass before removing the project-journal ledger entry.
