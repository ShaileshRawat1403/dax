# Canonical reviewed revision supersession

This bounded D2 correction follows Astra's architecture approval. It grants no
execution authority and changes no ordinary/v1 approval policy.

`approval_resolved` may carry `supersededByApprovalId` only when expiring a pending
capability grant review. Before persistence, canonical replay requires complete
committed old/new subjects, exact run/contract ownership, a strictly newer pending
successor already requested in this journal, no newer competing request, and no
start/publication/activation. Resolved, duplicate, stale, cyclic, malformed and
cross-owner edges refuse. Skipped revision numbers are valid after private-write
interruptions; private superseded status is never proof.

Locked revision writes the private proposal, then constructs the successor request
and every canonical pending historical review expiry under the event owner lock.
Shared Journal validates the complete batch and publishes it once. An interruption
before the rename leaves no partial successor request/expiry; an uncertain return
after rename leaves the complete validated batch replayable. Future revision reads
canonical pending requests rather than private pending status, also recovering the
historical request-before-expiry crash shape. Review → event ordering remains fixed.

Native completion retains all existing settlement/provenance/invocation/output and
verification checks. Only expired review approvals with a validated chain reaching
the exact approved, published and activated current request from the common reviewed
loader are exempt from historical approval refusal. No proof, incomplete chain,
ordinary expired approval, ask expiry, denial or pending approval remains a blocker
before output artifacts. Older journals lacking explicit proof stay fail closed;
there is no inferred backfill, private-status exception or automatic re-dispatch.

Implementer focused evidence: 22 canonical tests, the genuine compiled producer
with 61 complete controls, and 2 SDK transport tests: **25 pass, 0 fail, 119 assertions**.
The producer proves actual r2/r3 completion, full replay and unchanged historical
blockers. Canonical tests prove two-link chains, byte-preserving invalid appends,
atomic batch rejection, two consecutive private-only revisions, post-rename
uncertainty and historical stranded pending recovery. Source package typecheck passed.
Raw logs live under `artifacts/validation/conformance-closeout/`.

Failed fixture evidence is retained: first command hit EMFILE before collection;
initial setup used wrong event names/risk/config directory; later compiled setups
read bindings from the publication artifact rather than its canonical proof and
attempted a new prompt while an ordinary approval was pending. These establish no
production bypass. The final fixture settles the assistant before adding historical
blockers, then calls the real completion adjudicator and checks no output artifacts.

Full release gates and exact three-platform CI remain pending at this candidate
checkpoint. This is implementer evidence, not independent acceptance or gap closure.
