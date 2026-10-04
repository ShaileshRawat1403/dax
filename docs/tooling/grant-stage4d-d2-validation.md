# D2 operator API candidate validation

Status: uncommitted candidate, based on accepted
`7fc5cd14f2719ce54ef603c462cfe1efb9b083d5`. This is implementer evidence, not
independent acceptance. No final D2 SHA, full-gate success or CI result is claimed.

## Candidate behavior

Existing `POST /runs` accepts a strict structured `capabilityReview` opt-in for an
explicit generic workflow. Pure compiler/image preflight refuses fallback,
worker requirements and required verification before session/authority writes.
Existing v1/no-contract request behavior remains separate. Review inspection,
revision and explicit start use the three run-scoped endpoints in the approved
proposal. Revision/start compare revision, approval ID, proposal digest, contract
digest and complete ordered binding-manifest digest under the review lock.
Start holds start → review → event locks, validates publication/activation/current
bindings, claims `execution_started`, then dispatches after releasing locks.

Reviewed queued and activated-but-never-started waiting-approval session entries
refuse before provider, message or action effects; the latter needs actual
canonical `startedAt`. Proven inspection remains readable. A claim left before
prompt dispatch never retries automatically. Existing provider-stop adjudication
and failure transitions remain proof-owned.

Grant-set/ask approvals validate actor, decision and remember combinations before
any append; neither resumes a workflow. The API exposes their canonical subjects.
A successor creates new reviewed authority and approvals, with provenance metadata
only. Neutral intent plus explicit reviewed roots can grant native writes while
the unchanged compiler requires no verification; this generic slice is not called
read-only. Unsupported required verification is still refused.

## Implementer checks so far

Pinned Bun 1.4.0 uses the existing checksum-verified toolchain, frozen lockfile and
owned feature checkout. Early production typechecks passed before SDK generation.
DAX lint passed with unchanged suppressions. A targeted run passed **147 tests,
947 assertions across 12 files**, including the original compiled producer.

The latest compiled producer passed **58 complete controls**: the retained 41 D1
controls, 16 D2 Hono API controls and one source API refusal control. Actual modules,
local deterministic HTTP model, native binding/image checks and subprocesses are
used; no authority/image/provider/dispatch gate is substituted. Cross-process API
start yields one accepted response and one refusal, one canonical start and one
initial user message/model pipeline. Controls cover every pin individually,
invalid actor/remember/type combinations, revision/fresh approval, queued entries,
never-started waiting, publication proof recovery, claim-before-dispatch uncertainty,
ask routing, denied inspection, successor isolation and consequential scope display.
The ask route fixture appends the real correlated/deadlined tuple after actual
activation/start; D3 must separately prove actual tool → wait → binding recheck.
Raw latest result: `artifacts/validation/conformance-closeout/d2-producer-seventh.log`.

Earlier logs remain retained: first mounted-fixture URL was wrong; third ask fixture
omitted its required kind; fifth/sixth waiting fixture assumed a binding without
explicit filesystem scope. These failed setups establish no production finding.
The second/fourth compiled runs were green at their smaller matrix sizes.

## Outstanding checks and precise limitations

Complete release gates, exact source commit/push and
Ubuntu/macOS/Windows CI remain required. The pinned hey-api generator refreshes
unrelated templates and inherited ungenerated schemas/endpoints; its recursive
Provider JSON reference warnings and unknown identifier type changes are retained.
Unrelated SDK consumers then fail typecheck. This is generator drift, not an accepted
D2 runtime or client change. The approved SDK approach keeps existing runtime
bytes and transplants only D2 types/methods/schema fields. Do not claim globally
reproducible SDK generation while that broader drift is deferred.

Automatic approval review initially rejected generated-runtime replacement as
uncommitted-change loss. The maintainer explicitly authorized the exact 26-file
saved plan; the implementer read that human reply in the root thread before the
normal approval path executed the hash-guarded restoration. All 26 files match
accepted bytes; four additive API files and full generation archives are retained.
Both SDK transports passed **2 tests / 24 assertions**, and all five workspace
typechecks passed. SDK/plugin ambient Node types are explicitly scoped to their
declared dependency: unrelated empty ancestor d3 type folders otherwise caused
TS2688. DOM libraries and client runtime bytes remain unchanged. Full generation
is intentionally not globally reproducible in this bounded API slice.

A genuine revised r2 run reaches provider stop/idle but canonical completion
refuses because native completion currently requires every historical approval
approved, including superseded/expired r1. Fresh r1 and publication-recovery runs
complete canonically. Astra approved a separate explicit canonical supersession proof correction; no historical approval denial or completion proof rule was weakened.

D3 MCP/tool/ask/delegation producer coverage, D4 live activity presentation and
C2–C5 remaining conformance work are separate. No main merge, profile activation,
installed-binary replacement, release or gap closure is claimed.
