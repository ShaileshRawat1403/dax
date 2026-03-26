# DAX Tool Reference and Risk Matrix

This guide explains the main tool categories DAX can use and the kinds of governance attention they typically deserve.

Exact behavior depends on the active workflow, permissions, and risk posture, but this guide gives operators and contributors a practical mental model.

## Why This Matters

DAX is easier to trust when you know what kinds of actions it can take.

At a high level, DAX can:

- inspect
- search
- fetch
- plan
- delegate
- edit
- execute
- write to project memory

Not all of those carry the same risk.

## Quick Risk Matrix

| Category | Typical tools | Default risk profile | What it usually means |
| --- | --- | --- | --- |
| Read-only inspection | `list`, `read`, `glob`, `grep`, `codesearch`, `websearch`, `webfetch` | Low | Safe information gathering |
| Planning and guidance | `skill`, `todoread`, `todowrite`, `plan_enter`, `plan_exit` | Low to Medium | Organizing work and structure |
| Delegation | `task` | Medium | Launching sub-work or sub-agents |
| Mutation | `edit`, `multiedit`, `write`, `apply_patch` | Medium to High | Changing files |
| Command execution | `shell` | Medium to Critical | Running commands that may affect files, installs, or systems |
| Project memory | `pm_note`, `/pm` commands | Low to Medium | Storing notes and guardrails |
| Interactive gates | `question` | Variable | Asking the user to decide |

## Read-Only Tools

These tools are mostly used to understand a project before DAX acts.

### `list`

Shows directory contents.

Use it for:

- getting oriented
- seeing project structure
- identifying likely entry points

### `read`

Reads file contents.

Use it for:

- understanding source files
- inspecting configs
- reviewing docs

### `glob`

Finds files by pattern.

Use it for:

- locating files by name or extension
- finding likely config, test, or entry files

### `grep`

Searches text patterns.

Use it for:

- locating identifiers
- tracing feature usage
- finding TODOs, env vars, or command names

### `codesearch` and `websearch`

Search code or the web for supporting context.

Use them for:

- comparison
- research
- upstream references

### `webfetch`

Fetches the contents of a URL directly.

Use it for:

- official docs
- release pages
- install scripts

## Planning and Organization Tools

### `todowrite` and `todoread`

These tools manage a structured task list for the current working session.

Use them for:

- multi-step implementation
- tracking progress
- keeping work visible

### `skill`

Loads specialized instructions for a certain workflow or domain.

Use it for:

- focused tasks with a known pattern
- domain-specific procedures

### `plan_enter` and `plan_exit`

These help DAX move into and out of planning mode.

Use them for:

- structured planning before mutation
- keeping execution intentional

## Delegation

### `task`

Launches sub-work through a task/sub-agent flow.

Use it for:

- bounded parallel work
- isolated subtasks
- specialized follow-up actions

Governance note:

- this is more powerful than a read-only lookup
- it should be used for a clear reason, not as an escape hatch from thinking

## Mutation Tools

These tools can change the project and usually deserve more scrutiny.

### `edit`

Applies targeted edits to an existing file.

### `multiedit`

Applies multiple coordinated edits.

### `write`

Writes file content, often for new files or full replacements.

### `apply_patch`

Applies structured patches.

Use mutation tools for:

- docs cleanup
- code fixes
- small refactors
- new config or support files

Governance note:

- these are often approval-worthy in stricter policies
- changes should usually be explained and reviewable

## Command Execution

### `shell`

Runs a command in the local environment.

This is one of the most powerful tools DAX has.

Use it for:

- tests
- build commands
- package inspection
- git status and release checks

Be cautious with:

- installs
- destructive commands
- commands with side effects outside the repo

## Project Memory

### `pm_note`

Stores a daily status report style note in local project memory.

Related commands:

- `/pm note`
- `/pm list`
- `/pm rules`
- `/pm rules add`

Use PM for:

- durable context
- daily notes
- lightweight guardrails
- project-specific reminders

See the full [Project Memory Guide](./PROJECT_MEMORY.md).

## How RAO Usually Relates to Tools

As a rule of thumb:

- read-only tools are easiest to allow
- mutation tools deserve more review
- shell is the highest-variance surface
- approvals become more likely as the action becomes more destructive or less reversible

If you want to tune this behavior, read [Policy Customization and RAO Tuning](./POLICY_TUNING.md).

## What Users Should Expect

Users should not need to memorize every tool.

What they do need to know is:

- DAX can inspect, plan, and act
- risky actions should be more visible than safe ones
- the tool surface exists to make work inspectable, not magical

## Related Guides

- [User Guide](./USER_GUIDE.md)
- [Policy Customization and RAO Tuning](./POLICY_TUNING.md)
- [Project Memory Guide](./PROJECT_MEMORY.md)
