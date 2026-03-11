# DAX Skills Model

This document defines skills as reusable capability packs.

Skills package execution capability. They do not define persona or tone.

## Core Rule

Skills are capability packs, not personalities.

A skill may package:

- prompts
- tools
- checks
- workflow steps
- output contracts

A skill may not package:

- a competing persona
- a different voice contract
- a different stream identity

## Purpose

Skills let DAX reuse proven workflows without embedding every specialized behavior directly into the base runtime.

They provide:

- reusable execution patterns
- reusable investigation flows
- domain-specific checks
- consistent output shape

## Skill Structure

Each skill should define:

### Prompt framing

- what the skill is trying to accomplish
- what question shape it supports

### Tools

- which tools are needed
- which tools are optional

### Checks

- which validations should run
- which evidence must be gathered

### Workflow steps

- ordered execution pattern
- escalation points
- stop conditions

### Output contract

- required sections
- structured return format
- evidence expectations

## Example Skills

### repo-explore

Packages:

- entry-point discovery
- orchestration mapping
- integration inventory
- reading-order recommendation

### git-review

Packages:

- status collection
- diff review
- commit-summary generation

### release-readiness

Packages:

- readiness checks
- blocker reporting
- missing-evidence reporting

### artifact-audit

Packages:

- retained-output grouping
- artifact-kind classification
- artifact inspection workflow

## Relationship To Modes

Modes affect framing and explanation behavior.

Skills affect capability and workflow packaging.

Examples:

- Explore mode + repo-explore skill
- Operator mode + release-readiness skill
- ELI12 + artifact-audit skill for simpler explanations

## Relationship To Sub-Agents

Sub-agents may use skills.

Examples:

- Explore sub-agent may use `repo-explore`
- Release sub-agent may use `release-readiness`
- Artifact sub-agent may use `artifact-audit`

Skills support sub-agents, but do not replace them.

## Non-Goals

Skills are not:

- personas
- UI modes
- separate assistants

They should never change the voice contract of DAX.

## Product Guardrail

If a skill changes how DAX sounds, the skill is doing the wrong job.

If a skill changes what DAX can do and how it structures the work, the skill is correct.
