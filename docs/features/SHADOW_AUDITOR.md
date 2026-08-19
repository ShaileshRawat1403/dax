---
title: Shadow Auditor
archetype: feature
status: active
owner: Shailesh Rawat
maintainer: Shailesh Rawat
version: 0.1.0
tags:
  - dax
  - feature
  - audit
---

# Shadow Auditor

The Shadow Auditor is a background agent that proactively evaluates execution contracts before tools run, providing blast radius analysis to help operators understand the scope and risk of planned changes.

## Overview

Shadow Auditor runs automatically after an execution contract is compiled, analyzing:

- **Risk Level**: low, medium, high, or critical
- **Reason**: Why the changes are classified at that level
- **Affected Areas**: Which subsystems or files will be impacted

## How It Works

1. **Contract Compilation**: When you submit an intent, DAX compiles it into an execution contract
2. **Shadow Analysis**: The Shadow Auditor analyzes the contract in the background
3. **Blast Radius Display**: The risk assessment appears in the workstation sidebar

## Risk Classification

| Level        | Criteria                                                                      |
| ------------ | ----------------------------------------------------------------------------- |
| **Low**      | Read-only operations, documentation changes, small refactors                  |
| **Medium**   | Single file edits, small feature additions                                    |
| **High**     | Multi-file changes (>5 files), configuration changes, core file modifications |
| **Critical** | Security-sensitive files, major refactors, release-critical paths             |

## Viewing Blast Radius

The blast radius appears in the session sidebar:

```
⚡ Blast Radius: HIGH
   Reason: Modifies 7 files across config and core
   Areas: [src/server], [config], [.github/workflows]
```

## Use Cases

- **Pre-Execution Awareness**: Understand scope before approving
- **Risk-Based Approval**: Higher-risk changes may require more scrutiny
- **Scope Validation**: Verify the plan matches your intent

## Configuration

Shadow Auditor runs automatically. No explicit configuration required.

## Technical Details

- Runs asynchronously after contract compilation
- Uses the default configured model for analysis
- Results stored in session state under `blast_radius`
- Gracefully handles failures (logs error, continues execution)
