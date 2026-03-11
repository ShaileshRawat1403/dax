# DAX Session Learning Feature

This document captures how the living session-learning artifact can evolve into a product feature.

## Purpose

DAX should not only execute work. It should also learn from how work was framed, constrained, corrected, and completed.

The goal is to turn high-value sessions into reusable operational knowledge.

## What The Feature Should Capture

For important sessions, DAX should be able to extract:

- intent evolution
- clarification path
- prompt patterns that improved output quality
- execution patterns that reduced risk
- anti-patterns that caused drift or noise
- product opportunities revealed by repeated friction

## Feature Boundaries

Session learning is not:

- a transcript dump
- generic summarization
- a motivational recap
- a replacement for audit or verification

Session learning is:

- pattern extraction from real work
- reusable lessons from governed execution
- a bridge between session history and product improvement

## Candidate User-Facing Surfaces

### 1. Session lesson summary

Given a completed session, DAX could return:

- what worked
- what failed
- what constraints mattered
- what should be reused next time

### 2. Prompt and execution pattern library

DAX could group repeated lessons into:

- framing patterns
- sequencing patterns
- safety/governance patterns
- Explore/review/release patterns

### 3. Product feedback extraction

Repeated session friction could be surfaced as:

- likely feature gap
- likely workflow gap
- likely noise source
- likely documentation gap

### 4. Team learning packs

Across many sessions, DAX could generate:

- best-practice playbooks
- reusable workflow templates
- onboarding lessons for non-developers and mixed teams

## Minimum Viable Feature Direction

The first useful version should stay small:

1. capture a session-learning summary for selected sessions
2. store the extracted lesson structure
3. allow review of:
   - prompt pattern
   - execution pattern
   - anti-pattern
   - feature opportunity

That is enough to validate whether session learning is genuinely useful before expanding it into a larger product surface.

## Product Rule

Only lessons grounded in real session evidence should become durable learning.

If the pattern is not repeated or not supported by the session record, DAX should not present it as a stable lesson.
