# Project settings cutover: work in progress

Sole-owner checkpoint, 2026-10-05. No independent review, merge, release or gap closure.

The actual protected operator API and effective PM readers pass three controls
(24 assertions) under Bun 1.4.0: approval-only adoption, exact-digest rejection,
stale legacy rejection, predecessor-bound replacement, stale replacement rejection,
legacy write refusal, original SQLite preservation, and source-run retention.
Strict schema controls reject duplicate preferences and unknown authority fields.
Package typecheck and diff whitespace checks pass.

Raw focused output is retained in `evidence/project-settings-first-controls.log.gz`.
This is not full acceptance. Remaining work includes concurrent replacement,
persistence fault injection, denial, malformed authority, restart, user-facing
review guidance, the complete pinned gate and exact-commit three-platform CI.

The preceding Rust fixture correction at
`32b4a2e0ce3d01c0214d3aa0e0ce75f41be712cf` passed all three platforms:
https://github.com/ShaileshRawat1403/dax/actions/runs/37308437846.
Its controlled fixture reuse reproduces the ranking failure mechanism; the
original hosted failure's exact timestamp collision remains unproven.
