# Caller registration descriptor candidate

Base: `f898f7322a4d56a3c6488c8606e480455c63a58a`.
No accepted gap closure or main integration is claimed.

Caller tools and graph operators receive strict conservative logical descriptors
in separate `custom.tool.v1.` and `custom.operator.v1.` namespaces: high risk,
opaque scope and verification required. They provide no code attestation, origin
proof or authority. Caller code remains excluded from reviewed grants without
an implementation binding; acknowledging its identity does not change that.
The existing `legacy_unenrolled` review reason means absence of review binding,
not absence of a descriptive runtime identity.

Production dispatch controls preserve v1 permissions, initialized receivers,
native alias separation, replacement compatibility and stale-handle rejection.
Graph type/executor mutation is rejected before effects. The original vocabulary
and properties wrappers reported CLOSED; those assertions now run normally.
Ledger removal awaits complete coverage assessment and integration.

Validation under Bun 1.4.0:
- Dispatch regressions: 75 passed, 388 assertions.
- Complete release gates: 2,352 passed, 2 skipped, zero failures, 8,933 assertions;
  typechecks, lint, smoke, Rust and release checks passed.
- Final added production review control and stage-3 regressions: 39 passed,
  242 assertions. This test was added after the complete gate; hosted CI must
  validate the final commit.

The earlier WIP CI failed four obsolete expectations that caller executors lack
any descriptor. Their replacements retain authorization and executor behavior
assertions. The retained failure is not reported as a successful run.

[Durable raw logs and checksums](evidence/caller-capability-coverage/README.md).

The prerequisite Windows cleanup correction passed all three platforms at
`f898f73`: https://github.com/ShaileshRawat1403/dax/actions/runs/37253279656.
Unrelated historic intermittents remain tracked. No release or installed binary
change, accepted gap-count change, or branch integration occurred.
