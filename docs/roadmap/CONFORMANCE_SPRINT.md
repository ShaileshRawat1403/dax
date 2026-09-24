# Conformance sprint: original nine-gap scope

Status: paused at the source checkpoint during the maintainer's absence. Recorded
2026-09-20 at the maintainer's request.
Implementation model: Sol. Reviewer: Astra 6, high reasoning. Released baseline:
DAX v1.5.0 at `88e74c97c25a8bf1e304554d8e2c4ff45533ff09`;
current sprint baseline: `20a16f361f1f61f7a348844cec3f324fdddc50c3`.

The original sprint scope was nine aggregate gaps. The complete-event-history
workstream, including compaction-replacement provenance, is integrated in `main`
at `7ccfc8a4cdd93ff054cabe2c43197438b88e8995`. Accepted record-class
coverage is **11/11**. `inv1.record-classes` is closed after production and replay
review; the [gap ledger](../../packages/dax/src/conformance/known-gaps.ts) now has
**eight open entries**. The
[post-merge main CI](https://github.com/ShaileshRawat1403/dax/actions/runs/35872303816)
passed on Ubuntu, macOS, and Windows. This did not publish a release. The eight
remaining gaps are deferred during the maintainer's absence; resume only after
reviewing the checkpoint and selecting a bounded next item.
The objective is stronger reconstruction of run history, consistent contract
permissions, and governed project memory. No release number or completion date
is assigned. Nine entries were the original target scope, not an estimate that all
nine would fit in one sprint; unfinished entries remain open and are carried forward
explicitly at sprint review.

## Implementation and review handoff

The complete-event-history workstream is integrated. The reviewed home visual pass
is integrated in checkpoint source and is not part of this gap ledger. For each
remaining gap, the
implementation model should read this plan, the current ledger, and relevant
conformance tests, then propose one bounded item before runtime work. Its review
handoff must pin the source commit, state the acceptance criteria covered, include
commands/results and negative controls, and identify remaining limitations.
Astra independently checks claims against the exact artifact and version. Model
selection alone does not make a review independent; record who implemented and
who reviewed, and follow the SOP when a second agent is active.

## Work order

1. Define behavioral acceptance tests and compatibility decisions for each group.
   Existing filename and source-pattern checks are tracking aids, not sufficient
   proof of implemented behavior. Decide event schemas, capability/grant semantics,
   and memory promotion authority before wiring production paths.
2. Deliver event-history coverage and capability permissions as separate bounded
   changes. The missing record classes can be delivered incrementally; the single
   ledger entry stays open until all five are covered.
3. Generalize journal storage and add scope ownership, then introduce the project
   journal. Preserve independent run replay and historical event compatibility.
4. Connect a governed memory writer only after project ownership, provenance,
   and permission checks exist. No direct model-to-authoritative-memory write.

## Backlog and acceptance

The rows preserve the original nine-gap sprint scope. `inv1.record-classes` is
**closed** at the integrated SHA above; the other eight rows remain **open** in the
current ledger. Dependencies refer to the gap IDs below.

| Gap ID | Deliverable | Acceptance evidence | Depends on |
| --- | --- | --- | --- |
| `inv1.record-classes` | Durable records for prompt contributions, context contributions, assistant messages, delegation, and compaction replacement. | Exercise real production producers for all five missing classes. Restart/replay reconstructs the effective model-visible history and delegation provenance; interrupted compaction remains unambiguous. Existing six classes still replay, and historical runs explicitly report unavailable history without inventing records. | Versioned event schema and retention/redaction decisions. |
| `inv5.capability-vocabulary` | One named registry for executable capabilities across native tools, plugins, workflows, and workers. | Enumerate production execution entry points, map each to a registered capability, reject unknown or duplicate names, and test that unmapped consequential actions cannot execute. | Inventory of execution entry points. |
| `inv5.capability-properties` | Validated intrinsic properties: risk, scope support, and verification requirements. | Reject malformed descriptors; keep run-specific paths, host permissions, and budgets in contract grants. Descriptor defaults cannot grant authority or weaken contract requirements. | `inv5.capability-vocabulary`. |
| `inv5.contract-grants` | Operator-reviewed contracts express permissions as grants against named capabilities. | Serialize and reload scoped grants without changing their meaning. Deny absent or out-of-scope grants; preserve contract immutability. Test the explicit compatibility policy for older contracts without silently widening authority. | Capability vocabulary and properties. |
| `inv5.grant-resolution` | Shared grant resolution on every consequential execution path. | Native edits, plugin/workflow actions, worker patches, and delegated actions receive consistent allow/ask/deny decisions for equivalent requests. Negative tests prove an alternate entry point cannot bypass a denial; receipts identify the governing contract/grant. | `inv5.contract-grants`. |
| `scope.journal-primitive` | Reusable append, locking, sequence/envelope validation, and replay machinery parameterized by scope. | Run and project journals use the same implementation. Concurrent appends, process interruption, malformed envelopes, and sequence corruption are tested; existing run replay and initialization recovery remain intact. | Scope identity and storage compatibility design. |
| `scope.aware-envelope` | Explicit event ownership and cross-scope provenance references. | Reject invalid or mismatched owners, replay historical run envelopes under a defined compatibility policy, and preserve source references without creating two authoritative owners for one transition. | Shared scope model; delivered with journal primitive. |
| `scope.project-journal` | Authoritative project journal for facts that outlive a run. | Promote, supersede, and retire project facts through journal events. Replay after restart derives the same project state; removing a source run does not erase project authority. Define how provenance remains inspectable under retention. | `scope.journal-primitive` and `scope.aware-envelope`. |
| `memory.no-producer` | Production memory promotion path consumed by future sessions. | A real production action proposes a candidate, obtains the required operator authority, and persists approved memory through the project journal. Later sessions read it; denied, revoked, and superseded candidates cannot silently become active memory. Test crash/retry idempotency. | Project journal, shared grant resolution, and explicit promotion policy. |

## Closure rules

- For each implemented slice, add behavioral regression tests covering the live
  producer, enforcement boundary, and consumer/replay path, including denial and
  interruption cases where relevant. Creating expected filenames is not closure.
- Remove a ledger entry and unwrap its `expectGap` checks only when the entire
  invariant is demonstrated. Replace weak structural checks with behavior checks
  as part of that change; do not suppress failures or mark missing coverage done.
- Preserve the v1.5.0 integrity fixes and all existing authority, approval,
  verification, sandbox, and worker safeguards. Models and companion products
  cannot become the owner of DAX authority.
- Use pinned Bun 1.4.0 and diff-appropriate checks for each change. Before merging
  runtime changes, pass full `release:gates` and applicable platform CI. Record
  tested commits, raw evidence, and any unavailable environment checks.
- Record solo review honestly while Codex is the sole agent. If another agent
  joins, apply the active multi-agent SOP rather than calling self-review
  independent cross-validation.
- At sprint review, publish closed/open gap counts with evidence and carry forward
  any unfinished acceptance criteria. Keep the historical v1.4.0 claims pack and
  v1.5.0 release record unchanged; future behavior belongs in a versioned update.

## Related planning

- [Product roadmap](../product/ROADMAP.md)
- [Harness evolution](DAX_HARNESS_EVOLUTION.md): H1/H4/H5 for history;
  H2/H3 for capability permissions. Project scope and memory are explicit work
  here rather than an implicit side effect of those workstreams.
- [Current ownership and status](../DAX_STATUS.md)
