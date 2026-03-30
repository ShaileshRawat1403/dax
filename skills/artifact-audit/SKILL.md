---
name: "artifact-audit"
description: "Inspect release artifacts, generated outputs, screenshots, and manifests for completeness, consistency, and operator value."
---

# Artifact Audit

Use this skill when the task is to review the outputs of a run or release rather than the source code alone.

## Use when

- the user wants screenshots, manifests, bundles, or generated files checked
- a release produced assets that need verification
- an output directory needs completeness or consistency review
- the question is whether an artifact provides real value to an operator or user

## Workflow

1. Identify artifact kinds and intended audience.
2. Check completeness and naming consistency.
3. Check integrity signals such as manifests, checksums, or expected companion files.
4. Inspect usability and clarity for human-facing artifacts.
5. Report missing evidence, broken links, or mismatched expectations.

## Output contract

Return:

1. `Artifact inventory`
2. `What is correct`
3. `What is missing or mismatched`
4. `User-facing quality notes`
5. `Recommended fixes`
