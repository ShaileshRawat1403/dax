# DAX Release Gates & Non-Goals

## Status: Frozen for Production Release
This repository and its sub-packages are now under **Release Freeze** for the initial production-ready version. No new features, modes, or providers will be added until the production-ready criteria are met.

---

## Non-Goals (v1.0.0)
The initial production release of DAX explicitly **excludes** the following:
*   **Chat-only assistant behavior:** DAX is an execution-first engine, not a general-purpose chat interface.
*   **Hidden side-effects:** Any mutation *must* be reflected in the event stream and, where policy requires, approved.
*   **Multi-tenant state sharing:** Each session is isolated; cross-session or multi-user state synchronization is out of scope.
*   **Arbitrary provider expansion:** We are focusing on stabilizing the core `@ai-sdk/*` providers we have, not adding more at this time.
*   **GCP/Vertex work:** While integrated, the current push is for the core DAX execution layer, not GCP-specific extensions.

---

## Production Gate Checklist
The following criteria must be met and verified for the release:

### 1. Trust & Determinism
- [ ] No false claims: All reported outcomes must be grounded in tool outputs.
- [ ] Immutable event stream: Replay of a run must result in the same projected state.
- [ ] Contract Match: Execution logic must strictly follow the `workspace-mcp` kernel contract.

### 2. Execution Safety (RAO)
- [ ] Mutation Budgets: Hard limit on number of file/shell mutations per session.
- [ ] Loop Breaker: Detect and stop repeated tool calls with identical arguments.
- [ ] Sensitive Path Guards: Block access to `.env`, `.git/`, and credentials.
- [ ] Rollback Anchors: System must create a state marker/snapshot before first mutation.

### 3. Mode Integrity
- [ ] `Explore`, `Docs`, and `Plan` modes cannot mutate the workspace.
- [ ] Promotion path: Promotion from `Plan` to `Run` must be explicit and audited.

### 4. TUI Stability & Reliability
- [ ] No visual regressions or race conditions in TUI state projection.
- [ ] Successful E2E run on macOS, Linux, and Windows CI.

---

## References
- [Production Readiness Plan](./.dax/plans/production-readiness-plan.md)
- [Architecture Guide](./docs/architecture/ARCHITECTURE.md)
