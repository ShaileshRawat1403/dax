# DAX Overhaul Plan

## Product Thesis

DAX is the execution control plane for AI-assisted SDLC.

DAX should not compete as:

- another AI IDE
- another coding chat shell
- a generic "autonomous engineer"

DAX should compete as the governed layer that turns natural language into controlled engineering work with:

- approvals
- auditability
- reusable team constraints
- model and tool neutrality
- explainable execution

## Positioning

### Primary Category

Governed AI execution for software delivery.

### Core Promise

DAX helps teams and ambitious builders execute software work through AI with explicit control, traceability, and customization.

### Best User Segments

- engineering teams adopting AI under real delivery constraints
- platform and developer productivity teams
- technical founders operating with mixed technical and non-technical collaborators
- open-source builders who want a local customizable execution runtime

### Anti-Positioning

DAX is not primarily:

- an IDE replacement
- an AGI claim
- a "replace developers" product
- a prompt toy

## Product Pillars

### 1. Governed Execution

All impactful actions flow through:

- intent
- plan
- action
- approval
- verification
- evidence

### 2. Open Customization

Users should be able to safely customize:

- agents
- prompts
- policies
- workflows
- tools
- domain packs

### 3. Human-Readable Trace

DAX should produce an operator-grade execution narrative, not raw tool spam.

### 4. Learning and Understanding

DAX should explain:

- what it changed
- why it changed it
- what was verified
- what remains risky

## Architecture Direction

## Keep

These are aligned with the target product and should remain the canonical core:

- `packages/dax/src/session`
- `packages/dax/src/tool`
- `packages/dax/src/provider`
- `packages/dax/src/project`
- `packages/dax/src/governance`
- `packages/dax/src/rao`
- `packages/dax/src/pm`
- `packages/dax/src/doctor`
- `packages/dax/src/docops`
- `packages/dax/src/mcp`
- `packages/dax/src/auth`
- `packages/dax/src/plugin`
- `packages/dax/src/server`
- `packages/dax/src/cli`
- `packages/dax/src/dax`

## Refactor In Place

These areas appear valuable but need sharper boundaries and naming:

- `packages/dax/src/policy`
- `packages/dax/src/skill`
- `packages/dax/src/command`
- `packages/dax/src/share`
- `packages/dax/src/format`
- `packages/dax/src/ide`
- `packages/dax/src/acp`

Refactor goals:

- make governance semantics clearer than wildcard allow/ask/deny
- define stable public extension contracts
- separate product UX helpers from runtime-critical logic
- reduce naming overlap between "agent", "mode", "command", "skill", and "tool"

## Quarantine For Removal

These paths should remain read-only during the transition and then be deleted once references are gone:

- `cli/`
- `core/`
- `tui/`

These create architectural drag because they contradict the repo boundary story.

## Delete Early

These should be cleaned up in the first overhaul phase because they reduce trust:

- placeholder `LICENSE`
- placeholder `CONTRIBUTING.md`
- broken or incomplete doc references
- missing screenshot references in public-facing docs

## Target Product Shape

DAX should be organized around five stable surfaces:

### 1. Runtime Core

- session orchestration
- tool execution
- provider routing
- project and filesystem context

### 2. Governance Core

- permission evaluation
- approval workflows
- policy packs
- audit evidence
- decision ledger

### 3. Operator Experience

- terminal UI
- CLI
- review and approval surfaces
- explanation and learning views

### 4. Extension SDK

- plugin hooks
- custom tool contract
- custom agent and workflow contract
- config schema and migration rules

### 5. Delivery Integrations

- MCP
- GitHub
- CI and release evidence
- export and import

## Minimal-Effort Strategic Refactor

This is the lowest-effort sequence that materially improves product quality.

### Phase 1. Trust and Boundary Cleanup

- replace placeholder license and contributing docs
- update README and architecture docs to the new positioning
- mark root legacy paths as deprecated in code comments and docs
- remove dead doc references and missing public assets

Outcome:
The repo becomes externally credible without deep code changes.

### Phase 2. Make Canonical Ownership Obvious

- keep all new work inside `packages/dax`
- add a legacy removal tracker
- stop referencing root legacy code in any docs
- add CI checks that block new files under root legacy paths

Outcome:
The repository starts behaving like a real product, not an experiment.

### Phase 3. Harden Governance Claims

- rename policy messaging so it matches current implementation
- add richer metadata for approvals and denials
- add tests for approval, denial, persistence, and replay flows
- define "governed execution" as the source of truth rather than "deterministic" in the strict formal sense

Outcome:
The product promise becomes honest and strong.

### Phase 4. Stabilize Extension Surface

- document supported plugin hooks and mark unstable hooks explicitly
- stop implicit or surprising mutation of user extension directories where possible
- separate local customization from enterprise-managed policy/config
- publish 2-3 supported customization patterns instead of many loose ones

Outcome:
DAX becomes adoptable by external builders and teams.

### Phase 5. Build Enterprise Feature Wedge

Focus the roadmap on:

- policy packs
- approval routing
- execution evidence bundles
- release-readiness checks
- team learning and explanation mode

Outcome:
DAX becomes differentiated from IDE-first coding agents.

## Proposed Module Simplification

Longer term, the product should converge toward a simpler internal map:

- `runtime/`
- `governance/`
- `experience/`
- `extensions/`
- `integrations/`
- `platform/`

This does not need to be a big-bang rename. It can be achieved gradually by moving only when touching code.

## Deletion Policy

Delete only when one of these is true:

- the path is documented as legacy and unused
- the path duplicates shipped behavior
- the path increases onboarding confusion more than it preserves migration value

Do not preserve duplicate code "just in case". Archive rationale in docs, not runtime paths.

## Success Criteria

The overhaul is successful when:

- a new contributor can identify the canonical product surface in under 5 minutes
- the public docs match the real implementation
- approvals and audit traces are demonstrably testable
- customization is explicit and stable
- DAX reads as a governed SDLC product, not a stitched-together experiment

## Recommended First Execution Batch

1. Replace `LICENSE` and `CONTRIBUTING.md`
2. Rewrite top-level `README.md` around the new positioning
3. Add a `docs/LEGACY_REMOVAL_PLAN.md`
4. Remove broken doc references and missing asset references
5. Add CI guardrails against new files in `cli/`, `core/`, and `tui/`
6. Expand tests around governance and approval behavior
