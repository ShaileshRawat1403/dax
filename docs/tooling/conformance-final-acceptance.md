# Final conformance candidate acceptance

Sole-owner candidate, 2026-10-07. Base: compiled producer checkpoint `47a64fd`.
The candidate ledger has **zero open entries within the approved sprint scope**.
Published main still has eight until exact-candidate validation and integration.
This is not independent review, an error-free guarantee or release publication.

## Scope decision and compatibility

This follows [Stage 4d C2](../roadmap/GRANT_STAGE4D_PROPOSAL.md#8-binding-boundary-and-honest-closure-criteria):
unsupported implementations need not become executable to satisfy mediation;
reviewed attempts must be denied before effects. Unavailable allow bindings and
missing lookup paths are different. No external acknowledgement is substituted
for attesting local code, and no new generic sandbox/binding format is invented.

Compiled, known-image generic reviewed runs support native/session capabilities
and explicitly acknowledged remote MCP. Plugins, legacy custom registrations,
local MCP, workers and verifier executables have no supported reviewed allow
binding; their attempted actions are denied or their required activation/start
is refused. Future support for those implementations is a distinct feature
backlog, not a promise made by this closeout. Source/unknown images cannot use
reviewed execution. Trusted plugin loading/hooks and service initialization remain
the documented trusted-code boundary, not arbitrary-code containment.

V1 and no-contract producers preserve their explicit compatibility policy and
report record-only/no-contract lookup; they do not acquire reviewed V2 authority.
Historical journals and SQL project facts are not silently migrated. New scope
and provenance events require a matching development binary; v1.5.0 must not
read these newer journals. Frozen release evidence and the installed binary remain
unchanged. Provider-adapter commitments are not provider receipt or transcripts.

## Grant producer inventory

All thirteen declared authority paths retain their identity checks, existing
permissions and narrower child authority. Different evidence states stay explicit:

| Path | Actual acceptance / boundary |
| --- | --- |
| native_tool | Real compiled SessionPrompt read; unbound registered custom-tool attempt is durably denied before its file-writing executor. Published V2 contract, scoped grants, shared lookup and replay are asserted. |
| batch_leaf | Actual model-selected batch allows read and durably denies write with no target file. |
| mcp_tool | Real SDK server/client tool call; another server is durably denied with zero effects. Actual route-mediated ask, remembered same-tuple dispatch and fresh-root denial. |
| operator_shell | Actual SessionPrompt shell denied before owned process effect; late permission denials retained. |
| operator_graph | Genuine runGraph selected executor denied for root and derived child; explicit no-contract compatibility remains. |
| command_shell | Actual markdown command snippet denied before effect. |
| context_attachment | Actual file attachment contributes controlled content; enforced record and replay. |
| template_reference | Actual @file lookup and content; malformed/missing authority and ownership refuse without effects. |
| mcp_resource | Actual MCP SDK read and cross-server zero-effect denial, source-proven V2 identity without private item name retention. |
| mcp_prompt | Actual command-prompt SDK fetch and cross-server zero-effect denial with the same privacy boundary. |
| workflow | All four actual fixed constructors with matching candidate contracts refuse pending dispatch at the specific shared review barrier before steps/messages/provider calls; public reviewed API refuses unsupported workflow starts. This is barrier/preflight refusal, not an invented action receipt. |
| worker | Actual worker workflow refuses pending authority before checkout/launch; worker-required reviewed activation/start is unsupported and refused. Adapter identity mutation controls remain. No successful reviewed worker launch is claimed. |
| verification_command | Actual worker-verification default runner is durably denied before a permitted package test command; actual scoped SDLC likewise denies. Genuine unscoped/v1 operator commands remain compatible. |

The compiled matrix additionally covers exact approval/publication/activation,
immutable binding changes, corrupted identity/authority, real child dispatch and
resume with no fallback, concurrency at explicit start, every review barrier,
canonical supersession, completion before artifact effects and real OS kill/restart
with zero provider replay. The kill control covers one unsettled primary assistant
boundary, not every possible crash window or rollback of arbitrary external effects.

[Unsupported producer controls](compiled-unsupported-producer-validation.md),
[final paths](compiled-final-mediation-validation.md),
[compiled MCP](compiled-mcp-producer-validation.md),
[actual ask](compiled-grant-ask-validation.md),
[delegation](delegated-producer-validation.md),
[graph](graph-reviewed-authority-validation.md),
[SDLC](scoped-sdlc-verification-validation.md),
[debug](debug-no-contract-boundary-validation.md),
[session integrity](session-storage-identity-validation.md) and
[OS interruption](compiled-process-interruption-validation.md) retain raw evidence.

## Eight-gap reconciliation

| Original gap | Candidate acceptance |
| --- | --- |
| inv5.capability-vocabulary | Real production executor/catalog inventory; conservative custom descriptors, duplicate/unknown/mutated identities rejected. contract-capability, adapter and catalog suites. |
| inv5.capability-properties | Closed descriptor schema rejects authority fields/malformed properties; conservative defaults grant nothing. Same production registry suites. |
| inv5.contract-grants | Actual reviewed producer publishes/reloads a nonempty V2 grant set after named operator approval. Legacy compilation is now a compatibility regression, not a false gap probe. |
| inv5.grant-resolution | Above thirteen-path inventory plus genuine compiled allows, asks, durable denials and unsupported barriers. No unsupported form is enabled to hide missing attestation. |
| scope.journal-primitive | Shared scope journal implementation; journal, project-journal, initialization and process-contention/recovery suites. |
| scope.aware-envelope | Run V2 cutover and scope-authority controls reject mixed versions, wrong owners and corrupt references without rewriting historical V1. |
| scope.project-journal | Protected exact-digest fact/settings approval, publication, supersession and retirement; production PM readers; replay after source-run removal. Historical SQL is explicitly adopted, not auto-authoritative. |
| memory.no-producer | Protected proposal/review/publication and fresh SessionPrompt/intent consumers; denied/retired/changed facts excluded, idempotent interruption/concurrency controls. Actor is the existing trusted operator-channel label, not a cryptographic human identity. |

[Project settings](project-settings-validation.md),
[memory producer](project-memory-producer-validation.md),
[convention consumer](project-conventions-validation.md) and
[envelope cutover](run-envelope-cutover-validation.md) preserve narrower slice
results and limitations. Their historical counts are not current acceptance.
The previously integrated record-class gap remains closed at documented 11/11
producer coverage; unknown historical coverage stays unknown.

## Ledger integrity and remaining release work

The old two gap probes always compiled V1 and expected V2: they measured the
intentional compatibility policy instead of reviewed production. Their V2 grant
and enforcement assertions now run on the actual compiled producer; explicit
V1 expectations remain ordinary regressions. No failing implementation check is
hidden or skipped. Empty-ledger mechanism tests use an isolated synthetic ledger
and still fail when a gap closes, including asynchronous checks. Empty does not
mean all future bugs are impossible.

Final full gates, exact-SHA three-platform CI, comprehensive stack integration and
post-merge CI are still required. Only after published-main ancestry verification
may clean merged branches/worktrees be removed. Preserve dependencies, user data,
configuration and durable evidence. No new version/tag/assets/binary is authorized
by this acceptance record alone.

## Final local gates and source provenance

Validated feature working tree based on `47a64fd5c2e751f14cac4e3590c1d173aac8d03e`;
its commit contains the exact production/test changes. Bun 1.4.0 focused final
conformance selection: **14 passed, 0 failed, 136 assertions**. Full isolated root
release gates: **2,383 passed, 2 skipped, 0 failed**, workspace typecheck/lint,
5/5 smoke evaluations, Rust fmt/clippy/tests and release checks passed.
Final documentation integrity and diff checks pass. The initial empty-ledger
TypeScript description type and one incorrect relative link were fixture/docs
errors corrected before final gates; retained evidence includes them.

The predecessor [producer CI 37602838410](https://github.com/ShaileshRawat1403/dax/actions/runs/37602838410)
passed all three platforms. This candidate still requires its own exact-SHA CI.
All successful and failed earlier runtime correction gates remain in the linked
slice records; this final green result does not erase them or establish unknown
Windows latency causes.

Hashes cover decompressed bytes under `evidence/`.

| Log | SHA-256 |
| --- | --- |
| `final-closeout-focused.log.gz` | `e7e8d1a69d746e438502a036b2961e382beab3a56f6ff30b61a7653509bdffa7` |
| `final-closeout-typecheck-fixture-red.log.gz` | `6d9259608e44ba53c25fde62e7a55c1092ae1492c8ec76c99f5c3fc2851bd738` |
| `final-closeout-link-red.log.gz` | `21a9c0fe34eee0f2329f1bae5f9cb65e89e2ad6db6477516b02699ae77e9db62` |
| `final-closeout-gates.log.gz` | `f8c73b6ef49914b296e96c39882fd819b4a24a5ed3790bb30f3bbf4632e3c8ab` |
| `final-closeout-unsupported-producer.log.gz` | `86408369c9f72061f2ecdc8e095116c4297405fe9304b5e7a6c26f19c5395de1` |

The candidate's first hosted run stopped at an unexplained Windows typecheck
launcher exit, before tests. [Cold typecheck and diagnostic correction](checkout-local-typechecks-validation.md)
retains that failure, the independent ambient-type finding and final cold/full
checks; it does not waive platform acceptance. Host preview startup is additionally
verified there. Exact-SHA CI must pass at the successor correction before integration.
