# DAX Product Experience Roadmap

## Goal

DAX should feel like a complete product, not just a powerful codebase.

That means:

- clear first-run success
- strong default UX for developers
- understandable UX for non-technical users
- reliable operational surfaces for teams
- a consistent product story across CLI, TUI, local server, and MCP integrations

## Product Standard

DAX should aim to feel like a serious engineering product in the way strong developer companies ship products:

- opinionated defaults
- fast time to first value
- visible system state
- safe automation
- good failure messages
- graceful advanced workflows without exposing internals too early

## Current Strengths

Already strong:

- CLI surface breadth
- TUI architecture
- approvals and governance
- provider integration depth
- MCP integration support
- session and storage model

Current gaps:

- first-run onboarding is still too expert-friendly
- MCP and advanced capabilities are present but not fully legible in the UX
- there are multiple mental models visible in docs and repo structure
- the TUI is powerful, but not yet shaped around user journeys

## Experience Strategy

### Audience bands

DAX should support four user bands without splitting into different products:

1. First-time users
2. Daily technical operators
3. Non-technical or mixed technical/business users
4. Teams and integration-heavy users

The answer is not separate apps. The answer is progressive disclosure.

## TUI Roadmap

### Phase 1: clarity and confidence

Improve now:

- stronger home screen guidance around:
  - provider readiness
  - MCP readiness
  - project readiness
  - last active session
- clearer empty-state prompts with recommended first actions
- better session-state explanation:
  - what DAX is doing now
  - what is blocked
  - what needs approval
- normalize status language:
  - connected
  - waiting
  - blocked
  - needs approval
  - failed

### Phase 2: intentional sidebars and panes

Improve next:

- convert sidebar from “status dump” into “operational cockpit”
- make sections task-oriented:
  - runtime
  - approvals
  - MCP
  - diffs
  - todos
  - context usage
- add a lightweight MCP inspect flow:
  - connected servers
  - top available tools/resources/prompts
  - last MCP failures

### Phase 3: session usability

Improve next:

- stronger command palette with intent-first actions
- better transcript navigation and message jumping
- clearer tool-result rendering for MCP and non-MCP tools
- better interrupt/resume/fork affordances
- richer “what changed?” summary after edits

### Phase 4: non-technical mode

Improve later:

- ELI12 mode should be more than wording
- it should influence:
  - home prompts
  - approval wording
  - failure explanations
  - diff summaries
  - next-step suggestions

## CLI Roadmap

### Phase 1: complete operational CLI

Improve now:

- explicit doctor flows:
  - auth doctor
  - MCP doctor
  - environment doctor
  - project doctor
- consistent machine-readable output for ops commands
- better default help text grouped by task

### Phase 2: stronger admin/operator commands

Improve next:

- project bootstrap command
- session inspection and replay flows
- MCP inspection commands:
  - tools
  - prompts
  - resources
  - connectivity
- approval queue and policy inspection commands

### Phase 3: team/automation readiness

Improve later:

- stable server/API workflows for CI or remote operators
- explicit export/import bundles for session and audit flows
- clearer release and packaging commands

## Product Journeys To Optimize

### 1. First run in five minutes

User should be able to:

- launch DAX
- connect a provider
- confirm MCP if configured
- run one safe read-only task
- understand what happened

### 2. Daily engineering loop

User should be able to:

- open DAX
- resume context fast
- inspect diff/todos/approvals quickly
- run the next task with minimal ceremony

### 3. Safe file-changing loop

User should be able to:

- request a change
- see plan and tool usage
- approve only what matters
- review diff
- verify and continue

### 4. Team/operator loop

User should be able to:

- diagnose provider/auth/MCP issues
- inspect session/audit state
- attach to a running server
- export artifacts for review or automation

## Support-Everyone Principle

DAX should support everyone by layering, not by flattening.

That means:

- beginner mode should be simpler, not weaker
- expert mode should be faster, not noisier
- advanced systems like MCP should be visible when useful, not omnipresent
- product defaults should protect users from complexity until they need it

## Near-Term Execution Priorities

### Now

- make MCP feel intentional in DAX, not hidden
- improve home screen orientation
- add doctor/inspection flows
- unify status language across TUI and CLI

### Soon

- improve session navigation and result rendering
- add MCP inspect UX
- strengthen approval and diff review ergonomics

### Later

- lightweight web mode or remote operator shell if demand proves real
- deeper team and automation flows without turning DAX into Soothsayer

## Architectural Constraint

Every UX improvement should preserve one product truth:

- DAX is the execution product
- not a clone of Soothsayer
- not a migration bundle of old repos
- not a generic enterprise shell

The TUI and CLI should become better product surfaces for the same DAX runtime, not parallel applications.
