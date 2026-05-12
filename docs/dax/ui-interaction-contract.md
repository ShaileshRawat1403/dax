# DAX UI Interaction Contract v0.1

> **Surfaces should not make independent display decisions.**

Header, Transcript, Input, Inspector, and Footer render a resolved projection of active run, user, safety, environment, and focus state. The Command Palette is a navigation surface and does not consume the resolver.

This contract exists because DAX previously allowed multiple surfaces to explain the same execution state. Header, Footer, Inspector, Sidebar, and Transcript competed for display truth. The resolver exists to make state ownership explicit.

Header, Footer, Inspector, Sidebar, and Transcript stop arguing because none of them owns the truth anymore.

---

## Relationship to `docs/UX_CONTRACT.md`

`docs/UX_CONTRACT.md` defines the 4-layer DAX UX architecture: Execution Kernel, Projection Layer, Interaction Layer, Authoring Layer. This contract specifies the **concrete projection mechanism** for Layer 2 (the Projection Layer). It does not replace `UX_CONTRACT.md`; it implements the rule that Layer 2 must be purely derived from kernel state.

---

## 1. Surface Responsibility

Each surface answers one primary question.

| Surface | Only question it answers |
|---|---|
| Header | What state is DAX in, and do I need to act? |
| Transcript | What has DAX done, and what is it doing now? |
| Input | How do I instruct DAX? |
| Inspector | What decision, evidence, or detail am I inspecting? |
| Footer | What environment am I in, and is it healthy? |
| Command Palette | Where do I access secondary actions? |

If a component answers the wrong question, it belongs in another surface or should be removed.

---

## 2. Resolver Ownership

The UI state resolver is the source of display truth for primary DAX surfaces.

The resolver is a pure projection function:

```ts
resolveUIState(active, now, previous)
```

Rules:

- Same inputs produce the same output.
- The resolver emits snapshots only.
- The resolver does not emit transitions.
- The resolver does not write transcript history.
- The resolver does not read globals.
- The resolver does not call `Date.now()`.
- The resolver does not log.
- The resolver does not validate producer correctness.
- Contradictory inputs are resolved by priority ladder, not rejected.
- `previous` is `null` on first resolve.

The resolver decides display. The run engine, approval queue, runtime events, and user interaction layer decide history. The transcript may be read by diagnostic tools. The transcript must not depend on resolver output to decide history.

---

## 3. Active UI State

The resolver consumes bounded state.

```ts
type ActiveUIState = {
  run: RunState
  user: UserState | null
  environment: EnvironmentHealth
  safety: SafetyState[]
  focus: FocusState
}
```

- Run state is single-valued.
- User state is single-valued because the operator resolves one governance item at a time.
- Safety state is an array because safety conditions can stack.
- Environment health preserves per-service detail.
- Focus state is separate from governance state.

---

## 4. Header Priority

Header shows the highest-priority active state. When the displayed state resolves, Header re-evaluates all remaining active states.

Priority order:

1. `policy_blocked`
2. `auth_required`
3. `failed`
4. `waiting_for_approval`
5. `waiting_for_answer`
6. `cooling_down`
7. `provider_delayed`
8. `compacting`
9. `resuming`
10. `working`
11. `complete`
12. `ready`

`complete` holds for 3 seconds after it first wins the header, then decays to `ready` unless a higher-priority state is active.

Interruption is an event, not a persistent header state. It belongs in the transcript. After interruption, the resolver re-resolves to the current active state.

**Debounce: deferred to v0.2.** The resolver may currently produce header changes at any rate. Consumers must not invent debounce locally; debounce will be added to the resolver when the first Header consumer lands.

---

## 5. Transcript Rules

The transcript is append-only and human-readable. The transcript contains no controls, inputs, or state widgets.

The transcript logs user actions and state transitions that affect Header, Inspector, Footer health, or operator trust. It does not log internal UI recalculations.

Logged:

- User instruction submitted
- User approval granted
- User approval denied
- User answered a question
- User interrupted execution
- User opened Inspector or Inspect mode
- Approval requested
- Approval resolved
- Provider cooldown started
- Provider cooldown ended
- Policy block raised
- Policy block cleared
- Auth required
- Tool failed
- Run resumed
- Compaction started
- Compaction completed
- Audit finding raised
- Environment degraded
- Environment restored

Not logged by default:

- Internal render recalculation
- Header debounce
- Pane mode switching
- Minor tool lifecycle ticks
- Repeated identical state updates

Inline transcript alerts are allowed. Interactive controls are not allowed. Controls belong in the Inspector.

---

## 6. Inspector Rules

The Inspector is closed by default. The Inspector is never empty.

**Auto-opens for** (resolver-driven, derived from `ActiveUIState`):

- Pending approvals
- Pending questions
- Policy blocks
- Auth requirements

**May open on user action for** (not resolver-driven; opened explicitly by the user or surface code):

- Selected evidence
- Diff review
- Audit findings

When a safety-critical decision is pending, Inspector receives focus and traps focus.

Esc minimizes the Inspector decision posture. It does not resolve the decision. The pending decision remains active and visible through Header state.

If `requiresAction === true`, the Inspector must not be closed. The reverse is not required: the Inspector may be open for non-required inspection.

---

## 7. Input Rules

Input is a distinct interaction surface.

When a safety-critical decision is pending:

- Input remains visible.
- Input is visually de-emphasized.
- Inspector owns focus.
- Submitting another instruction queues it behind the pending decision.

If the pending approval is granted, the queued instruction may proceed. If the pending approval is denied, the queued instruction is dropped with a transcript line.

Example transcript line:

```
User submitted a follow-up instruction while approval was pending.
Approval was denied.
Queued instruction was dropped.
```

---

## 8. Footer Rules

Footer owns environment state, not run state. Footer is passive. Footer is not part of the normal Tab cycle. Footer may show one collapsed environment health signal. Environment details open through the Command Palette or Inspector.

Footer health collapse:

- `healthy` when all required services are healthy.
- `degraded` when at least one service is degraded and none are unavailable.
- `unavailable` when any required service is unavailable.

v0.1 treats `provider`, `mcp`, and `lsp` as required services. Per-service required/optional designation is deferred to v0.2.

---

## 9. Focus Rules

Focus is rendered state, not governance state.

Valid focus states:

- `none`
- `transcript`
- `input`
- `inspector`

`none` is valid during cold start and pre-mount.

Normal Tab cycle: `Transcript ↔ Input ↔ Inspector`. Footer is not part of the normal Tab cycle.

---

## 10. Debug Overlay

The debug overlay shows both input state and resolved projection. It must show why the resolver chose the visible state.

Example:

```
Active
  run: cooling_down
  user: waiting_for_approval
  safety: []
  environment: { provider: healthy, mcp: degraded, lsp: healthy }
  focus: inspector

Resolved
  header: DAX · Waiting for you
    winner: user.waiting_for_approval
    priority: 4
  inspector: approval_card
    opened_by: user.waiting_for_approval
  footer: degraded
    reason: mcp degraded
```

The debug overlay reads resolver output. It does not inspect resolver internals.

---

## 11. Enforcement

The contract is enforced through four layers:

1. Unit tests for `ui-state-resolver.ts`.
2. PR checklist tied to this contract.
3. Import boundary rule for Transcript.
4. Development-only runtime invariant assertions.

Transcript modules must not import button, input, approval, or control primitives.

Development invariants catch impossible projection states early. Callers are responsible for gating invariant assertions to development mode.

Example invariants:

```ts
if (projection.inspector.state === "closed" && projection.inspector.content) {
  throw new Error("Contract violation: closed inspector cannot have content")
}

if (projection.header.requiresAction && projection.inspector.state === "closed") {
  throw new Error("Contract violation: required action must open inspector")
}
```

---

## 12. Compatibility Scope

Contract v0.1 governs all new UI code immediately. Existing surfaces may temporarily violate the contract during migration. Any migrated surface must consume the resolved UI projection. Once Header, Footer, Inspector, and Transcript consume the resolver, old independent display logic is deprecated.

`WorkstationLifecycle` (in `packages/dax/src/dax/presentation/workstation.ts`) remains the producer-side vocabulary. Phase 2 of the refactor introduces a `lifecycleToActiveUIState` mapper that bridges the existing producer state machine to `ActiveUIState`. The resolver does not consume `WorkstationLifecycle` directly.

---

## 13. Implementation Philosophy

Build the resolver first.
Make it testable.
Make it observable.
Then simplify the UI against it.

---

## 14. Non-goals

This contract does not govern:

- Theme tokens
- Color palette
- Microcopy polish
- Accessibility specifics
- Animation curves
- Persona behavior
- Command Palette internals
- Provider setup flows
- MCP setup flows
- LSP setup flows
