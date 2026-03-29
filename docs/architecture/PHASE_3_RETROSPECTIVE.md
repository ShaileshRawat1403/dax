# Architectural Retrospective: The Road to Phase 3

## Overview

This document tracks the evolution of DAX from a property-based command runner to a **projection-first governed execution workstation driven by a canonical event language**.

## The Progression

### Phase 1: Canonical Lifecycle Language
Established the foundational vocabulary for DAX. Defined the core boundaries of a run (Intent -> Plan -> Execution) and introduced the first strongly-typed event schemas.

### Phase 2: Projections
Moved the workstation state model from direct storage access to a projection-first architecture. This decoupled the TUI from the underlying database, allowing views to be derived pure-functionally from the event stream.

### Phase 3.1: Hardened Intervention Surfaces
Formalized the "pause-and-decide" model. Introduced trackable `Intervention` entities with unique IDs, allowing operators to understand exactly why execution is blocked (ambiguity, recovery, or risk).

### Phase 3.2: Speculative Previews
Implemented the "Proposed Change" write surface. By projecting speculative diffs from pending approvals into the workstation, we ensured that operators never have to grant "blind" permissions.

### Phase 3.3: Narrative Polish
Refined the operational feed. By pre-computing evocative messages at the gateway level, we transformed the narrative from a technical log into a high-signal situational awareness stream.

### Phase 3.4: Legacy Cleanup & Trust Normalization
Finalized the architectural transition. Retired legacy event families (like `trust.updated`) in favor of canonical ones (`audit.posture_updated`) while maintaining full replay compatibility for historical sessions.

## Current End-State

DAX is now a **projection-first workstation**. The event log is the immutable spine, and every user-facing surface—from the narrative feed to the speculative diff preview—is a real-time projection of that canonical execution language.
