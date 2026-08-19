---
title: DAX Non-Developer Quickstart
archetype: product
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - product
  - quickstart
---

# DAX Non-Developer Quickstart

This guide is the lightweight stable-release entry point for operators, reviewers, and non-developer users.

## What DAX Does In Plain Language

DAX is a governed execution system for AI-assisted work.

In practice, that means:

- you give DAX a task in natural language
- DAX can stream progress, request approvals, and produce artifacts
- audit and release-readiness stay attached to the same execution record

## Who This Is For

Use this guide if you want to:

- run DAX from the terminal without contributing code
- review governed execution and approvals
- check audit or release-readiness state

## Install

Start with the product prerelease/stable install guide:

- [Peer Pre-release Guide](./prerelease.md)

## 10-Minute Flow

1. Start DAX with `dax`.
2. Pick a provider or sign in if your model requires it.
3. Enter a simple prompt and confirm that streaming output appears.
4. If DAX asks for approval, review the request and approve or deny it.

## What To Watch

- approvals appear when DAX needs governed intervention
- audit shows trust posture and blockers
- release readiness stays separate from raw execution

## Common Fixes

- No streaming output: confirm your provider is configured and try a simpler prompt first.
- Approval appears unexpectedly: review the command/file context and approve only if it matches your intent.
- Audit shows warnings: open the audit surface first, then check release readiness separately.

## Next Reads

- [Product Start Here](./start-here.md)
- [Audit Agent Guide](./audit-agent.md)
- [Release Readiness](./release-readiness.md)
