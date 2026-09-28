# Operator capability identity — bounded implementation note

This branch enrolls the built-in task-graph operators at their actual dispatch
boundary. It does not introduce grants, change approval policy, or claim that
custom operators, workflow constructors, workers, commands or context reads are
covered. The eight aggregate gaps stay open pending independent review.

`packages/dax/tsconfig.json` narrows ambient type discovery to checkout-local
types. The new managed worktree is under a home directory with unrelated,
incomplete `@types/d3-*` packages. Without this setting, a frozen install
typecheck fails before reaching DAX code; the identical typecheck with an
explicit local `--typeRoots` passed. This has no runtime effect.

## Producer and compatibility boundary

`OperatorRouter.register` resolves only the five DAX-owned graph executors:
explore, git, verify, release, and artifact. The mapping binds the registered
object’s private construction brand, its exact prototype, its captured original
execute function and the task's operator type. This is not a guarantee that
trusted in-process code cannot alter helper methods inside an executor.
Registration captures the operator type once; a custom getter cannot change the
map key mid-registration. Git action identity rejects accessors and inherited
values rather than reading a changing action while resolving and invoking the
executor.
`runGraph` resolves that binding before constructing a context pack and checks it
again immediately before invoking the captured function. Git resolves one of
add, commit, push, checkout, or status from the task action; the existing absent
action defaults to commit. Each action has its own validated descriptor. A
foreign object claiming a built-in type, a changed execute function, unknown
Git action, or duplicate registration rejects before calling the executor.

Caller-registered non-built-in operators remain compatible but have no
descriptor and are **not counted as enrolled**. Their direct invocation outside
`runGraph` is not addressed. The graph's post-execution RAO checks, user/HITL
approval paths, durable lifecycle, report writes, and Git operations retain their
prior behavior. Identity does not grant those operations, make post-execution
checks into pre-execution permission checks, or promise confinement. Descriptor
scope is `opaque` and risk/verification are conservative descriptions.

Workflow class constructors and their direct call sites, worker launch, command
interpolation, prompt-time context reads, arbitrary trusted plugin code, and
custom operators require separate follow-up slices. Legacy execution contracts
and no-contract interactive behavior are unchanged. No events, migration,
historical attestation, model-visible metadata, or public source vocabulary are
introduced. No ledger entry closes on this partial coverage.

## Behavioral controls

- The real task-graph caller completes a Git-status action in a disposable repo.
- Existing Explore and repo-health graph paths continue to run their registered
  built-ins. A caller-supplied custom graph operator retains existing execution.
- A custom executor claiming `git` cannot publish; duplicate registration keeps
  the selected executor. Changed execute functions and unknown Git actions fail
  before effects. Prototype copies, proxies, and pre-registration replacement
  of the built-in method do not acquire identity. A post-lookup action switch
  cannot reuse another capability. Dynamic type/action getters and inherited
  actions cannot retarget a registration or action.
- All nine built-in descriptors validate, contain no grants, and remain frozen.

Evidence must include focused tests, pinned Bun 1.4.0 `release:gates`, and
exact-SHA Ubuntu/macOS/Windows CI. Astra's independent Tier 2 review is pending;
Sol's own checks cannot close either capability gap.
