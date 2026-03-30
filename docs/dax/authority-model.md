# DAX Authority Model v1.0

**Status:** LOCKED
**Effective Date:** 2026-03-21

---

## Overview

DAX uses an **authority model** to track the source of truth for run state. This document defines the authority levels and migration strategy.

---

## Authority Levels

### 1. `dax-state-machine` (Canonical)

**Status:** PRIMARY

This is the authoritative source of truth for runs that use the new execution architecture:

- RunState is created on run creation
- State transitions happen through explicit transition functions
- RunState is primary in getSnapshot
- Lifecycle inference is used only for reconciliation

**Characteristics:**

- Deterministic state transitions
- Explicit step tracking
- Canonical approval objects
- Persisted run truth

**Guarantee Level:** D2-D3

---

### 2. `dax-legacy` (Compatibility)

**Status:** FALLBACK

This is the legacy source of truth for runs that use the old execution path:

- No RunState exists
- Status derived from session/lifecycle inference
- Approvals reconstructed from permissions
- Message archaeology for step tracking

**Characteristics:**

- Non-deterministic state derivation
- No explicit step tracking
- Approvals inferred from permission system
- Session-based truth

**Guarantee Level:** D0-D1

---

### 3. `dax` (Mixed)

**Status:** TRANSITIONAL

Some runs may show `dax` as authority, indicating a mixed state:

- RunState exists but is not primary
- Fallback to session inference in some paths
- Migration in progress

**Migration Target:** These should be rare. If encountered, investigate why RunState is not being used.

---

## Authority Decision Rules

When `getSnapshot()` is called:

```
1. Check if RunState exists
2. If RunState exists AND is consistent:
   → Return snapshot from RunState
   → authority = "dax-state-machine"
3. If RunState exists BUT has mismatches:
   → Log warning
   → Return snapshot from RunState (authoritative)
   → authority = "dax-state-machine"
4. If RunState does NOT exist:
   → Derive from session/lifecycle
   → authority = "dax-legacy"
   → Log deprecation warning
```

---

## Migration Strategy

### Phase 1: RunState Creation (DONE)

All new runs must create RunState on creation:

- [x] RunFactory creates RunState
- [x] RunState created before execution starts

### Phase 2: RunState as Primary (DONE)

getSnapshot prefers RunState:

- [x] RunState checked first
- [x] Lifecycle inference becomes reconciliation

### Phase 3: Deprecation Warnings (DONE)

Legacy path triggers warnings:

- [x] Fallback to legacy logs warning
- [x] Warnings visible in logs/metrics
- [x] Authority counters track distribution

### Phase 4: Legacy Path Removal (FUTURE)

Legacy path is deprecated:

- [ ] All runs use RunState
- [ ] Legacy path removed or errors

---

## Authority in RunSummary

RunSummary now includes authority information:

```typescript
{
  runId: string,
  status: RunStatus,
  authority: "dax-state-machine" | "dax-legacy" | "dax" | undefined,
  // ... other fields
}
```

---

## External API

External consumers (Soothsayer, Picobot) should:

1. **Check authority field** in RunSnapshot/RunSummary
2. **Prefer runs with `dax-state-machine` authority**
3. **Handle `dax-legacy` runs gracefully** but expect limited state info
4. **Plan migration** to state-machine runs

---

## Metrics & Monitoring

Track authority distribution over time:

```typescript
authority_distribution = {
  dax_state_machine: count,
  dax_legacy: count,
  dax_mixed: count,
}
```

**Target:** 100% `dax-state-machine` by end of hardening phase

---

## Version History

| Version | Date       | Changes                                                                   |
| ------- | ---------- | ------------------------------------------------------------------------- |
| 1.0.0   | 2026-03-21 | Initial locked contract                                                   |
| 1.0.11  | 2026-03-30 | Session-close handoff, planning fallback hardening, and final release polish |
| 1.0.10  | 2026-03-30 | Refine-contract upgrade, sharper control rail, and UI/finish-state polish |
| 1.0.9   | 2026-03-29 | Phase 3 complete: deprecation cleanup, authority counters, and production-readiness polish |
