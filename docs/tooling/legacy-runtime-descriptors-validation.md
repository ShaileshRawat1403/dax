# Caller registration descriptor candidate

Base: `bdde33e3c26ecb4fff11edf442e2a0b4a7644194`.
Work in progress; no accepted closure or integration is claimed.

Caller tools and graph operators receive conservative logical descriptors in
separate `custom.tool.v1.` and `custom.operator.v1.` namespaces. Descriptors
are high risk, opaque and require verification. They provide no code attestation,
origin proof or grant; arbitrary caller code remains unbindable for reviewed
allow grants. Built-in-name spoofing remains refused. Caller type/executor
mutation is rejected before graph effects, including after handle selection.

Focused production/catalog/graph controls: 27 passed, 342 assertions. Package
typecheck passed. The original vocabulary and properties gap wrappers each
reported CLOSED; their conformance assertions are now ordinary tests. Ledger
entries remain until broader controls and full gates establish closure. The
initial restricted run and the obsolete catalog assertion are retained locally;
no full gate or candidate CI acceptance is claimed yet.

Implementation is preserved while the exact Windows failures from CI
37252092838 are diagnosed. No release or accepted gap count changes.
