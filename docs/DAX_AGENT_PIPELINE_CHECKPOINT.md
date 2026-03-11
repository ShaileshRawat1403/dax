# DAX Agent Pipeline Checkpoint

## What is this checkpoint?

This document freezes the implementation of the **first deterministic agent execution path** in DAX. It marks the transition from "direct CLI command execution" to "governed agent graph execution."

## Real layers vs Stubbed layers

### Real, live layers:
- **Planner:** Generates a deterministic `TaskGraph` based on the intent. Dependency resolution is fully implemented.
- **Operator Router:** Routes tasks to specialist operators based on `operator_type`.
- **Runtime Execution Loop:** The `runGraph` loop executes tasks in dependency order, handling success, failure, and checking for RAO boundaries.
- **Explore Operator:** The real `repo-explore` skill logic is now inside the `ExploreOperator`. The task graph passes real findings (boundaries, entry points, execution flow, integrations) to the final report generation task.
- **CLI Pipeline (`dax explore`):** The `dax explore` command now successfully uses the full agent pipeline from Prompt → Intent → Plan → Execute → Result.

### Stubbed / Incomplete layers:
- **Intent Interpreter:** `interpretIntent` is currently heuristic-based rather than LLM-backed.
- **Session/Workstation Wiring:** The execution engine correctly mutates `task.status` and `task.result` locally, but `runGraph` doesn't yet push milestones, events, or state changes into a live DAX `Session` or the TUI stream.
- **RAO Governance Hooks:** The loop checks for `result.requiresApproval` and pauses safely, but it is not yet wired to the canonical DAX `raiseApproval` or policy subsystems.

## Old direct path removed
The old direct `runExploreOperator` CLI command binding and the internal `src/explore/operator.ts` file have been completely replaced. The `explore` logic is now exclusively driven through the `ExploreOperator` in `packages/dax/src/operators/explore.ts`.

## Next agentized surfaces
1. **Workstation Integration (Narrow Proof):**
   - Route `/explore` session execution through the graph instead of the old direct path.
   - Emit graph milestones into the TUI stream:
     - `Intent interpreted`
     - `Plan created`
     - `Boundary pass completed`
     - `Entry-point pass completed`
     - `Execution-flow pass completed`
     - `Report prepared`
2. **RAO Wiring:** Connect `runGraph` blocks to real DAX session approvals.
3. **TaskGraph persistence:** Persist the task graph into the DAX session to allow resuming and debugging.