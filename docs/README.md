# DAX Documentation Index

Use this index based on your role and goal.

## Start Here

- [start-here.md](start-here.md): first successful run in minutes
- [distribution.md](distribution.md): install and release channels
- [release-readiness.md](release-readiness.md): end-to-end release smoke and sign-off guide

## Non-Developers

- [non-dev-quickstart.md](non-dev-quickstart.md): 10-minute practical flow
- [non-developer-guide.md](non-developer-guide.md): deeper plain-language usage guide

## Shipped Product Docs

DAX features that are implemented and ready for production use.

- [build-on-dax.md](build-on-dax.md): fork, customize, and ship
- [PROVIDERS.md](PROVIDERS.md): provider setup and auth matrix
- [prerelease.md](prerelease.md): beta install and validation
- [audit-agent.md](audit-agent.md): audit profiles, findings, and release gating
- [integrations-github-ci.md](integrations-github-ci.md): CI artifact + GitHub automation
- [WORKSPACE_DECISION_RECORD.md](WORKSPACE_DECISION_RECORD.md): product ownership and workspace roles
- [REPO_BOUNDARIES.md](REPO_BOUNDARIES.md): canonical DAX runtime surface and quarantined legacy paths
- [DAX_DONOR_ASSESSMENT.md](DAX_DONOR_ASSESSMENT.md): behavior-first reuse assessment for `cli/`, `core/`, and `tui/`
- [DAX_CLI_DONOR_INVENTORY.md](DAX_CLI_DONOR_INVENTORY.md): what `dax-cli` may still donate to DAX
- [WORKSPACE_MCP_WITH_DAX.md](WORKSPACE_MCP_WITH_DAX.md): use your Soothsayer kernel from DAX
- [CANONICAL_OPERATOR_FLOW.md](CANONICAL_OPERATOR_FLOW.md): product contract for `plan`, `run`, and `approvals`

## Contributor / Current Merge Target

Active development tracks and merge planning for contributors.

- [DAX_EXECUTION_CONTROL_PLANE_MERGE_PLAN.md](DAX_EXECUTION_CONTROL_PLANE_MERGE_PLAN.md): merge order and explicit deferrals for `feature/dax-execution-control-plane`
- [CONTRIBUTOR_START_HERE.md](CONTRIBUTOR_START_HERE.md): canonical product surface and contribution entrypoint
- [SESSION_LEARNING_FRAMEWORK.md](SESSION_LEARNING_FRAMEWORK.md): living prompt-engineering and session-learning artifact
- [DAX_SESSION_LEARNING_FEATURE.md](DAX_SESSION_LEARNING_FEATURE.md): how session learning can evolve from a living artifact into a reusable DAX feature
- [DAX_PRODUCT_VALIDATION.md](DAX_PRODUCT_VALIDATION.md): as-is vs to-be review of DAX as a working product system before further implementation
- [LEGACY_REMOVAL_PLAN.md](LEGACY_REMOVAL_PLAN.md): freeze policy and removal order for root legacy paths
- [DAX_ABSORPTION_STRATEGY.md](DAX_ABSORPTION_STRATEGY.md): how to absorb donor features into DAX without bloating it
- [DAX_EXECUTION_MODEL.md](DAX_EXECUTION_MODEL.md): architecture north star for the DAX work lifecycle

## Future Design Docs

Specifications for features that are designed but not yet implemented. These documents describe intended behavior and serve as implementation guides for future development.

### Workstation Design

- [DAX_WORKSTATION_UI_BLUEPRINT.md](DAX_WORKSTATION_UI_BLUEPRINT.md): session-centered workstation model for plan, run, approvals, artifacts, and audit
- [DAX_TUI_WORKSTATION_ARCHITECTURE.md](DAX_TUI_WORKSTATION_ARCHITECTURE.md): recommended TUI layout and pane roles for the DAX session workstation
- [DAX_TUI_DITA_PANE_MODEL.md](DAX_TUI_DITA_PANE_MODEL.md): DITA-informed information architecture for DAX TUI panes
- [DAX_TUI_REFACTOR_SPEC.md](DAX_TUI_REFACTOR_SPEC.md): implementation-ready refactor spec for the existing session-centric TUI
- [DAX_TUI_FOCUS_MODEL.md](DAX_TUI_FOCUS_MODEL.md): Pass 3 focus contract layered over the current prompt-first, dialog-priority TUI
- [DAX_TUI_OVERLAY_MODEL.md](DAX_TUI_OVERLAY_MODEL.md): Pass 4 overlay contract for workstation subviews, return behavior, and footer ownership
- [DAX_TUI_DETAIL_POLISH.md](DAX_TUI_DETAIL_POLISH.md): Pass 5 polish contract for readability, density, empty states, and calmness
- [DAX_WORKSTATION_MOCKUP_VARIANTS.md](DAX_WORKSTATION_MOCKUP_VARIANTS.md): three grounded workstation directions: operator-minimal, balanced, and governance-heavy
- [DAX_WORKSTATION_SIDEBAR_SPEC.md](DAX_WORKSTATION_SIDEBAR_SPEC.md): sidebar contract for card order, state rules, clickability, and default operator truth in the balanced workstation
- [DAX_WORKSTATION_STREAM_SPEC.md](DAX_WORKSTATION_STREAM_SPEC.md): center-stream contract for allowed message classes, forbidden message classes, interruptions, and short outcome behavior
- [DAX_STREAM_SPINE_AND_STAGE_DIVIDERS.md](DAX_STREAM_SPINE_AND_STAGE_DIVIDERS.md): rendering contract for execution spine rows and quiet stage dividers in the workstation stream
- [DAX_TUI_FIXED_MOCKUP.md](DAX_TUI_FIXED_MOCKUP.md): single fixed user-testable workstation mockup for this branch across normal, compact, and narrow terminal widths
- [DAX_TUI_USER_TEST_SCRIPT.md](DAX_TUI_USER_TEST_SCRIPT.md): first user-test runbook for validating the workstation and `/explore` as the first true agentized TUI flow
- [DAX_WORKSTATION_OVERLAY_SPEC.md](DAX_WORKSTATION_OVERLAY_SPEC.md): evidence-layer contract for verify, release, artifacts, timeline, and inspect overlays
- [DAX_WORKSTATION_OVERLAY_LAYOUTS.md](DAX_WORKSTATION_OVERLAY_LAYOUTS.md): internal layout contract for verify, release, artifacts, timeline, inspect, and approvals overlays
- [DAX_WORKSTATION_INTERACTION_SPEC.md](DAX_WORKSTATION_INTERACTION_SPEC.md): focus, open-close, and shortcut behavior across stream, sidebar, and overlays
- [DAX_WORKSTATION_REFINED_MOCKUP.md](DAX_WORKSTATION_REFINED_MOCKUP.md): single committed balanced-workstation direction combining stream, sidebar, overlays, and footer
- [DAX_WORKSTATION_SCREEN_LAYOUT.md](DAX_WORKSTATION_SCREEN_LAYOUT.md): final terminal screen layout spec for the balanced workstation, including regions, proportions, width tiers, overlay placement, and canonical mockup
- [DAX_APPROVAL_INTERRUPTION_SPEC.md](DAX_APPROVAL_INTERRUPTION_SPEC.md): how approvals interrupt the workstation through stream events, sidebar state, and a focused decision overlay
- [DAX_TERMINAL_CONSTRAINTS.md](DAX_TERMINAL_CONSTRAINTS.md): width tiers, sidebar collapse behavior, overlay sizing, scrolling, and resize rules for the workstation
- [DAX_TUI_IMPLEMENTATION_PLAN.md](DAX_TUI_IMPLEMENTATION_PLAN.md): final bridge from workstation design into TUI layout regions, component boundaries, overlay routing, resize handling, and event-loop responsibilities
- [DAX_EXECUTION_OPERATOR_TONE.md](DAX_EXECUTION_OPERATOR_TONE.md): hard voice contract for DAX as a calm execution operator across stream, sidebar, and overlays
- [DAX_NEXT_PRODUCT_DECISION.md](DAX_NEXT_PRODUCT_DECISION.md): strategic choice for the product layer after the workstation phase

### Session & Trust Models

- [DAX_SESSION_MODEL_V2.md](DAX_SESSION_MODEL_V2.md): runtime model for sessions as durable governed work lifecycles
- [DAX_TRUST_MODEL.md](DAX_TRUST_MODEL.md): session-level trust inputs, posture ladder, and degradation rules
- [DAX_SESSION_TIMELINE.md](DAX_SESSION_TIMELINE.md): append-oriented timeline model for meaningful session progression over time
- [DAX_AUDIT_VERIFICATION.md](DAX_AUDIT_VERIFICATION.md): verification model for evaluating session trust posture and evidence
- [DAX_VERIFICATION_SURFACE.md](DAX_VERIFICATION_SURFACE.md): first operator-facing verification surface for session trust judgment
- [DAX_SESSION_TIMELINE_SURFACE.md](DAX_SESSION_TIMELINE_SURFACE.md): first operator-facing surface contract for readable session progression
- [DAX_SESSION_TIMELINE_DENSITY_REVIEW.md](DAX_SESSION_TIMELINE_DENSITY_REVIEW.md): real-session review of timeline density, wording, and grouping gaps
- [DAX_SESSION_PROGRESS_LAYERS.md](DAX_SESSION_PROGRESS_LAYERS.md): hard separation between transcript, timeline, and verification layers
- [DAX_WORKSTATION_TIMELINE_SURFACE.md](DAX_WORKSTATION_TIMELINE_SURFACE.md): workstation timeline as a structured session drilldown that complements Activity
- [DAX_SESSION_HISTORY_SURFACE.md](DAX_SESSION_HISTORY_SURFACE.md): CLI-first browsing and inspection surface for durable session records

### Release & Lifecycle

- [DAX_RELEASE_READINESS.md](DAX_RELEASE_READINESS.md): readiness model for handoff and shipping judgment above verification
- [DAX_RELEASE_SURFACE.md](DAX_RELEASE_SURFACE.md): CLI-first surface contract for exposing handoff and shipping readiness
- [DAX_RELEASE_READINESS_REVIEW.md](DAX_RELEASE_READINESS_REVIEW.md): real-session review of readiness ladder balance, blockers, and missing-evidence wording
- [DAX_SDLC_STAGE_MODEL.md](DAX_SDLC_STAGE_MODEL.md): higher-order SDLC stage grouping over session progression and judgment surfaces
- [DAX_REAL_WORK_EVALUATION.md](DAX_REAL_WORK_EVALUATION.md): evidence-first runbook for evaluating the full operator loop on real tasks
- [DAX_RUN_LIFECYCLE_MODEL.md](DAX_RUN_LIFECYCLE_MODEL.md): evidence-driven lifecycle contract for `dax run`, session closure, interruption, and abandonment
- [DAX_RUN_LIFECYCLE_IMPLEMENTATION.md](DAX_RUN_LIFECYCLE_IMPLEMENTATION.md): narrow implementation bridge for making lifecycle truth visible across history, verification, and readiness
- [DAX_RUN_LIFECYCLE_REFINEMENT_2.md](DAX_RUN_LIFECYCLE_REFINEMENT_2.md): second lifecycle refinement bridge for distinguishing unfinished lightweight runs from completed artifact-heavy executions

### Write Governance

- [DAX_WRITE_GOVERNANCE_MODEL.md](DAX_WRITE_GOVERNANCE_MODEL.md): evidence-driven model for write intent, approvals, artifact detection, and trust-surface visibility
- [DAX_WRITE_GOVERNANCE_IMPLEMENTATION.md](DAX_WRITE_GOVERNANCE_IMPLEMENTATION.md): implementation bridge for making created project files visible as canonical retained artifacts across history, verification, and readiness
- [DAX_WRITE_GOVERNANCE_ENFORCEMENT.md](DAX_WRITE_GOVERNANCE_ENFORCEMENT.md): governance-enforcement model for safe writes, approval-gated writes, anomalies, and trust consequences
- [DAX_WRITE_GOVERNANCE_ENFORCEMENT_IMPLEMENTATION.md](DAX_WRITE_GOVERNANCE_ENFORCEMENT_IMPLEMENTATION.md): narrow implementation bridge for surfacing governed, blocked, and ungated writes in trust and readiness
- [DAX_WRITE_GOVERNANCE_POLICY_REFINEMENT.md](DAX_WRITE_GOVERNANCE_POLICY_REFINEMENT.md): policy refinement for distinguishing harmless, governed, sensitive, and partial writes
- [DAX_WRITE_GOVERNANCE_PARTIAL_BLOCKED.md](DAX_WRITE_GOVERNANCE_PARTIAL_BLOCKED.md): policy pass for distinguishing completed ungated writes from blocked, partial, and no-durable-result write outcomes

### Explore & Mode Design

- [DAX_MODE_MODEL.md](DAX_MODE_MODEL.md): mode inheritance model for Operator, ELI12, and Explore without breaking the execution-operator identity
- [DAX_SUBAGENT_MODEL.md](DAX_SUBAGENT_MODEL.md): specialist-operator model for Git, Explore, Verify, Release, and Artifact without separate personalities
- [DAX_SKILLS_MODEL.md](DAX_SKILLS_MODEL.md): skills as reusable capability packs for prompts, tools, checks, workflows, and output contracts
- [DAX_EXPLORE_MODE.md](DAX_EXPLORE_MODE.md): structured repository-understanding mode that returns maps, entry points, reading order, unknowns, and follow-up targets
- [DAX_EXPLORE_EXECUTION_GRAPH.md](DAX_EXPLORE_EXECUTION_GRAPH.md): five-pass Explore workflow for tracing repository boundaries, entry points, execution flow, integrations, and evidence with confidence
- [DAX_EXPLORE_OUTPUT_CONTRACT.md](DAX_EXPLORE_OUTPUT_CONTRACT.md): stable Explore deliverable covering required sections, confidence labels, evidence markers, citations, and follow-up targets
- [DAX_EXPLORE_IMPLEMENTATION_PLAN.md](DAX_EXPLORE_IMPLEMENTATION_PLAN.md): implementation bridge for promoting Explore from a validated engine into mode plumbing, operator routing, and session-ready product capability
- [DAX_EXPLORE_REAL_REPO_EVALUATION.md](DAX_EXPLORE_REAL_REPO_EVALUATION.md): local multi-repo validation of Explore signal quality, reading order, false positives, and unknown handling
- [DAX_EXPLORE_SESSION_VALIDATION.md](DAX_EXPLORE_SESSION_VALIDATION.md): validation of `/explore` as a session-native command, including output fit, ELI12 usefulness, and command ergonomics
- [DAX_INSPECTION_LOCK_RESILIENCE.md](DAX_INSPECTION_LOCK_RESILIENCE.md): reliability bridge for making inspection paths tolerate transient database lock contention

### Planning, Artifacts & Audit

- [PLANNING_EXECUTION_DECISION.md](PLANNING_EXECUTION_DECISION.md): why planning should become a first-class command separate from execution
- [DAX_PLAN_DESIGN.md](DAX_PLAN_DESIGN.md): command contract and behavior map for `dax plan`
- [DAX_PLAN_IMPLEMENTATION_V1.md](DAX_PLAN_IMPLEMENTATION_V1.md): thin implementation plan for `dax plan` over the canonical planning substrate
- [DAX_ARTIFACTS_DESIGN.md](DAX_ARTIFACTS_DESIGN.md): product definition and scope boundary for canonical artifacts
- [DAX_ARTIFACTS_BEHAVIOR_PASS.md](DAX_ARTIFACTS_BEHAVIOR_PASS.md): canonical runtime and donor comparison for artifact behavior
- [DAX_ARTIFACTS_IMPLEMENTATION_V1.md](DAX_ARTIFACTS_IMPLEMENTATION_V1.md): thin implementation contract for `dax artifacts`
- [DAX_AUDIT_DESIGN.md](DAX_AUDIT_DESIGN.md): product definition and trust boundary for canonical audit posture
- [DAX_AUDIT_BEHAVIOR_PASS.md](DAX_AUDIT_BEHAVIOR_PASS.md): canonical runtime and donor comparison for trust/evidence behavior
- [DAX_AUDIT_IMPLEMENTATION_V1.md](DAX_AUDIT_IMPLEMENTATION_V1.md): thin implementation contract for `dax audit` as an inspect-first trust summary
- [DAX_OPERATOR_SURFACE_EXPOSURE.md](DAX_OPERATOR_SURFACE_EXPOSURE.md): operator-surface decision for what belongs in list, show, inspect, judgment, and later workstation defaults

### Integrations

- [TUI_MCP_MAP.md](TUI_MCP_MAP.md): where MCP and `workspace-mcp` appear in the current DAX TUI
- [PRODUCT_EXPERIENCE_ROADMAP.md](PRODUCT_EXPERIENCE_ROADMAP.md): how to make DAX feel complete as a product

## Technical Deep Dives

- [SESSIONS.md](SESSIONS.md)
- [STREAMING.md](STREAMING.md)
- [MEMORY.md](MEMORY.md)
- [ARTIFACTS.md](ARTIFACTS.md)
