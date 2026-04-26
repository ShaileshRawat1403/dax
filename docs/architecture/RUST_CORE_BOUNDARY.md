# Rust Core Boundary

## Purpose

DAX uses TypeScript for orchestration, product surfaces, provider integrations, ACP/MCP adapters, and fast workflow iteration.

DAX will use Rust only for deterministic, safety-critical, replayable, or performance-sensitive runtime components.

The goal is not to rewrite DAX in Rust.

The goal is to make DAX's deterministic runtime contract provable.

## Rust Owns

- run state machine
- canonical event replay
- transition validation
- policy decision evaluation
- approval gate evaluation
- audit posture calculation
- deterministic proof reports
- repo indexing and structured context extraction
- safe command execution, if needed later

## TypeScript Owns

- CLI and TUI
- ACP server
- MCP and FastMCP adapters
- provider integrations
- prompt assembly
- model streaming
- config and auth UX
- Project Memory UX
- SDK and API surface
- docs and release scripts

## Boundary Rule

TypeScript orchestrates.

Rust decides deterministic facts.

TypeScript renders and integrates.

## First Rust Milestone

Given a canonical DAX event log, Rust must reconstruct the same final run state every time.

This proves the runtime contract without claiming model output determinism.

## Non-Goals

- no full rewrite
- no TUI migration
- no provider migration
- no ACP rewrite
- no MCP rewrite
- no premature NAPI or WASM binding
- no duplicate policy logic across TypeScript and Rust

## Initial Integration Method

Rust will be added as a sidecar binary first.

TypeScript will call the Rust binary through a JSON boundary.

Later, if profiling proves the need, DAX may consider NAPI or WASM for specific hot paths.

## Success Criteria

- same event input produces same final state
- invalid transitions are rejected
- approval requirements are deterministic
- audit posture is derived from structured facts
- proof reports can be generated in CI
