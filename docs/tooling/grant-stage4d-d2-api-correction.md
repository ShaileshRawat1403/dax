# D2 reviewed API contract correction

Status: corrective candidate on `fix/d2-api-contract-takeover`, based on
`198948c110f9b8085350f9445595f19be40c55dc`. This document records validation
of the API/SDK contract correction; it is not an acceptance or gap-closure
claim.

## Finding addressed

The reviewed D2 routes returned standard Hono validator failures and
`ReviewedRunRefusal` responses that were not represented by their OpenAPI
responses or generated SDK types. The SDK request union also omitted the
`generic` and `worker_run` workflow hints used by the reviewed contracts.

## Correction

- Added the actual standard-validator response schema (`data`, `error[]`,
  `success: false`) without conflating it with the legacy plural-`errors`
  response.
- Declared validator, missing-run, semantic-refusal, and malformed-body
  responses on reviewed create, revise, start, and approval routes.
- Regenerated only the affected tracked OpenAPI/SDK types and kept runtime
  transport behavior unchanged.
- Added real Hono route/OpenAPI controls, v1/v2 SDK transport controls, and
  compile-time request/error-shape controls. The controls assert no journal or
  provider effects for invalid, missing, or refused requests.

## Validation

- Focused API contract suite: **3 passed, 42 assertions**.
- DAX typecheck, SDK typecheck, DAX lint, and `git diff --check`: passed.
- A full pinned Bun 1.4.0 `release:gates` attempt reached all checks and then
  recorded **2,274 passed, 2 skipped, 65 failed, 1 error**. The failures were
  retained in `/private/tmp/dax-d2-api-release-gates-third.log`; the dominant
  symptom was `EADDRINUSE` from MCP/compiled fixtures, with
  separate host-only proxy and seatbelt failures. Concurrent resource exhaustion
  was not established. This is not reported as a
  green full gate.

The earlier seven test-only lint failures at `77422f5` were corrected in
`198948c`; their retained evidence remains in the prior D2 validation record.
No merge, release, activation, installed-binary replacement, or gap closure is
claimed. The exact branch SHA and three-platform CI result remain required
before maintainer integration.
