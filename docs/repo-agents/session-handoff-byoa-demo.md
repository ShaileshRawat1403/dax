---
title: BYOA Acceptance Receipts
archetype: repo-agents
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - repo-agents
  - byoa
---

# BYOA Acceptance Receipts (2026-07-11)

This handoff records the completed macOS acceptance proof for DAX's governed
external-worker path. It replaces the stale pre-release notes.

## Host boundary

- Host: macOS, with the Seatbelt isolation probe passing.
- Worker: Claude Code `2.1.206` in non-interactive `acceptEdits` mode.
- Worker environment: disposable checkout, allowlisted worker credentials only.
- Policy: `docs/product/**` write scope; `package.json` forbidden; system safety
  rules remained in force.
- DAX-owned verification: `bun test packages/dax/src/worker/worker-sandbox.test.ts`.
  The verifier ran with network denied under the same Seatbelt boundary.

The source checkout was not modified by either worker run. DAX persisted a
kernel-computed patch draft and required an explicit human decision; approval
marks that artifact as approved rather than silently applying it to the source
repository.

## Denial receipt

- Run: `ses_0ae2d631effefILmZbr37Ff6m0`
- Approval: `apr_7cf39e2abcad6043`
- Verification receipt: `c44f4a8f-2552-4bd2-aba4-3b193e81fee4`
- Evidence digest: `fc4a25ae1f6aecbf6211181c3e20717acfd52bb0879cb46fd5ec7fff18e8ae94`
- Terminal outcome: `failed` after an explicit operator denial.

The worker's patch described Cursor as a supported worker. DAX currently ships
Claude Code, Codex CLI, and Gemini CLI adapters, so the operator denied it.
This is an intentional governance receipt: a passed technical verification did
not override an inaccurate product claim.

## Approval receipt

- Run: `ses_0ae1dbf01ffeFT1s1meTbhzndF`
- Approval: `apr_02aaffcf0f211834`
- Verification receipt: `6f5802ad-81d6-4ccd-a538-3991bc4091d7`
- Evidence digest: `a27be721d8f0e7976b6f74d495a5afe88c03a0f5541024862dc9b61e0311b2aa`
- Terminal outcome: `completed` after explicit operator approval.

The corrected patch named the supported worker examples, changed exactly one
file inside the declared scope, and passed all 10 sandbox verification checks.

## What this proves

1. DAX fails closed unless the host's OS-isolation probe succeeds.
2. An external worker can make a bounded change in a disposable checkout.
3. DAX, rather than the worker, computes the diff and runs verification.
4. A real operator can deny an accurate technical result for a product-truth
   reason, then approve the corrected successor.
5. A fresh CLI process can recover the canonical approval receipt and complete
   the event-authority state transition.

Useful inspection commands:

```bash
dax session show ses_0ae2d631effefILmZbr37Ff6m0
dax session show ses_0ae1dbf01ffeFT1s1meTbhzndF
```
