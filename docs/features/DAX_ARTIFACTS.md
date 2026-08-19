---
title: Artifacts
archetype: feature
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - feature
  - artifacts
last_reviewed: 2026-08-19
---

# Artifacts

Artifacts are retained execution outputs associated with DAX work.

In the canonical runtime, artifacts currently come from real retained-output surfaces such as:

- tool attachments
- truncated tool output references
- session diffs
- workspace file outputs (durable project files retained as artifacts)

> The `workspace_file` kind covers durable project files written during governed
> execution (packages/dax/src/cli/cmd/artifacts.ts:11).

Use:

```bash
dax artifacts
dax artifacts --format json
dax artifacts --session <session-id>
```

Artifacts answer:

- what outputs exist
- where they came from
- which session they belong to

Artifacts do not answer trust or verification questions yet. Those stay in later audit/evidence surfaces.
