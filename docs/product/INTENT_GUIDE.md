# Prompt Engineering and Intent Guide

DAX works best when your request describes a goal clearly enough to be turned into a governed plan.

This guide is about writing intents that lead to good execution, not just good-looking prompts.

## The Core Idea

DAX is not optimizing for poetic prompts. It is optimizing for usable operational intent.

A strong DAX prompt usually tells it:

- what you want
- where to focus
- what constraints matter
- what kind of output you want back

## A Simple Formula

Use this structure when in doubt:

`Goal + Scope + Constraints + Desired Output`

Example:

`Review this repository's authentication flow, focus on token refresh and local credential storage, avoid making changes, and return the top risks with file references.`

## What Good Intents Usually Have

### 1. A clear goal

Good:

- `Audit this repo for release blockers`
- `Explain this architecture in simple words`
- `Draft a low-risk cleanup plan for duplicate helper code`

Weak:

- `look around`
- `do something useful`

### 2. A bounded scope

Good:

- `Focus on the auth flow`
- `Only inspect the CLI path`
- `Limit this to documentation changes`

Weak:

- `check everything`

### 3. Useful constraints

Good:

- `Do not edit files yet`
- `Keep this read-only`
- `Prefer the safest small change first`
- `Summarize for a non-technical audience`

### 4. A desired shape of output

Good:

- `Return the top 5 risks`
- `Give me a step-by-step plan`
- `Produce a release-readiness checklist`
- `Explain it like I am new to the repo`

## Strong vs Weak Examples

### Repository understanding

Weak:

`Explain this repo`

Better:

`Explain this repository in simple words, identify the main entry points, and tell me what parts seem most important for first-time orientation.`

### Risk review

Weak:

`Review this`

Better:

`Review this repository for security, release, and maintainability risks. Keep it read-only and rank the findings by severity.`

### Safe mutation

Weak:

`Fix the docs`

Better:

`Improve the public-facing docs for readability and onboarding, but do not change product behavior. Prefer small, high-confidence edits and keep the tone clear for non-developers.`

## Intent Patterns That Work Well in DAX

### 1. Explain

Use when you want understanding before action.

Examples:

- `Explain how this system works in simple words`
- `Map the auth flow and explain the critical path`

### 2. Review

Use when you want findings, risks, or gaps.

Examples:

- `Review this repo for release blockers`
- `Audit this change for regressions`

### 3. Plan

Use when you want a proposed path before mutation.

Examples:

- `Create a safe cleanup plan for the docs structure`
- `Plan a low-risk migration away from deprecated auth logic`

### 4. Execute

Use when you are ready for change.

Examples:

- `Apply the first small docs cleanup from the plan`
- `Implement the auth wording fix and show the diff`

## How to Reduce Bad Outcomes

If you want DAX to be safer and more useful:

- say `read-only` when you only want analysis
- say `do not edit files yet` when you want planning first
- say `show the diff` when you expect a change
- say `summarize for non-developers` when audience matters
- say `keep this release-safe` when stability matters

## Good First Intents by Use Case

### For developers

- `Review this repo for architectural risk and testing gaps`
- `Explain the control flow from CLI entrypoint to execution engine`
- `Find the lowest-risk path to improve this subsystem`

### For non-developers

- `Explain this repository in simple words`
- `Tell me what this tool does and what it does not do`
- `Summarize the main risks without jargon`

### For release work

- `Check whether this repo looks ready for public release and list the remaining blockers`
- `Review docs, metadata, and install paths for public-facing inconsistencies`

## What to Avoid

Avoid prompts that are:

- too vague
- too broad
- contradictory
- trying to combine planning, implementation, release, and storytelling all at once

Instead of:

`Fully fix this product, improve docs, redesign onboarding, and make it enterprise-ready`

Use:

1. `Review the current gaps`
2. `Plan the highest-leverage improvements`
3. `Implement the first safe chunk`

## A Useful Mental Model

Think of DAX as an operator console, not a wish-granting oracle.

Good operator instructions are:

- specific
- staged
- inspectable
- reviewable

## Related Guides

- [User Guide](./USER_GUIDE.md)
- [Runs, Approvals and Recovery](./RUNS_APPROVALS_AND_RECOVERY.md)
- [Tool Reference and Risk Matrix](./TOOLS_AND_RISK_MATRIX.md)
