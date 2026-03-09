# DAX Absorption Strategy

## Goal

DAX becomes the only main product.

Other repos are feature donors or reference material:

- `dax-cli`: highest-priority donor
- `workspace-mcp`: strategic kernel donor and runtime dependency
- `soothsayer`: selective UX/API/pattern donor
- `dao`: architecture-only donor

## Decision Rule

A feature should only move into DAX if it makes DAX better as a governed execution product.

Reject anything that:

- creates a second product shell inside DAX
- brings in unrelated enterprise CRUD/platform complexity
- duplicates behavior DAX already owns
- reintroduces old branding or transitional compatibility clutter

## Priority Order

### 1. `dax-cli`

Migrate first:

- missing DAX runtime features
- packaging and release improvements
- migration notes that protect compatibility

Reject by default:

- app shell
- desktop shell
- Cognito-branded surfaces
- duplicate runtime code

### 2. `workspace-mcp`

Use first as an external MCP dependency.

Align DAX to:

- lifecycle vocabulary
- kernel self-check semantics
- canonical violation shapes
- deterministic policy language

Port later only if repeated use proves it belongs in core DAX.

### 3. `soothsayer`

Mine carefully for:

- web UX ideas
- async execution patterns
- MCP broker lessons
- workflow visibility and analytics concepts

Do not import:

- full NestJS platform architecture
- DB/auth/worker stack as DAX core
- multi-user platform concerns into local-first DAX by default

### 4. `dao`

Keep only as reference for:

- reducers
- orchestration structure
- event-sourcing ideas
- policy simulation

## Execution Sequence

### Phase 1

- clean DAX docs and product identity
- lock repo boundaries
- formalize donor inventory

### Phase 2

- integrate `workspace-mcp` as a supported external MCP kernel
- validate read-only tool paths first

### Phase 3

- migrate selected `dax-cli` runtime deltas
- keep a strict migrate/reject list

### Phase 4

- adopt selected Soothsayer patterns only where DAX needs them
- decide later whether DAX needs lightweight web or async worker extensions

## Desired End State

DAX owns:

- CLI/TUI
- local server/API
- governed execution
- tool orchestration
- provider routing
- approvals
- memory
- optional MCP-powered kernel integrations

DAX does not become:

- a second Soothsayer
- a generic enterprise platform
- a mixed-brand migration repo
