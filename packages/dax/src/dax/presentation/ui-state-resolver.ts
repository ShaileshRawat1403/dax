// DAX UI Interaction Contract v0.1 — projection mechanism for Layer 2.
// See docs/dax/ui-interaction-contract.md.
//
// Surfaces should not make independent display decisions. This module is the
// single source of display truth for Header, Inspector, and Footer.

export type RunState =
  | "ready"
  | "working"
  | "cooling_down"
  | "provider_delayed"
  | "compacting"
  | "resuming"
  | "complete"
  | "failed"

export type UserState = "waiting_for_approval" | "waiting_for_answer"

export type SafetyState = "policy_blocked" | "auth_required"

export type ServiceHealth = "healthy" | "degraded" | "unavailable"

export type EnvironmentHealth = {
  provider: ServiceHealth
  mcp: ServiceHealth
  lsp: ServiceHealth
}

export type FocusState = "none" | "transcript" | "input" | "inspector"

export type ActiveUIState = {
  run: RunState
  user: UserState | null
  environment: EnvironmentHealth
  safety: SafetyState[]
  focus: FocusState
}

export type HeaderState =
  | "policy_blocked"
  | "auth_required"
  | "failed"
  | "waiting_for_approval"
  | "waiting_for_answer"
  | "cooling_down"
  | "provider_delayed"
  | "compacting"
  | "resuming"
  | "working"
  | "complete"
  | "ready"

export type HeaderProjection = {
  state: HeaderState
  label: string
  requiresAction: boolean
  winner: string
  priority: number
  completedAt?: number
}

export type InspectorState =
  | "closed"
  | "approval_card"
  | "question_card"
  | "safety_block"
  | "auth_required"

export type InspectorProjection = {
  state: InspectorState
  requiresFocusTrap: boolean
  openedBy?: string
  content?: string
}

export type FooterHealth = "healthy" | "degraded" | "unavailable"

export type FooterProjection = {
  health: FooterHealth
  label: string
  reason?: string
  services: EnvironmentHealth
}

export type ResolvedUISurface = {
  header: HeaderProjection
  inspector: InspectorProjection
  footer: FooterProjection
}

const COMPLETE_DECAY_MS = 3_000

const HEADER_PRIORITY: Record<HeaderState, number> = {
  policy_blocked: 1,
  auth_required: 2,
  failed: 3,
  waiting_for_approval: 4,
  waiting_for_answer: 5,
  cooling_down: 6,
  provider_delayed: 7,
  compacting: 8,
  resuming: 9,
  working: 10,
  complete: 11,
  ready: 12,
}

const HEADER_LABEL: Record<HeaderState, string> = {
  policy_blocked: "DAX · Policy blocked",
  auth_required: "DAX · Auth required",
  failed: "DAX · Failed",
  waiting_for_approval: "DAX · Waiting for you",
  waiting_for_answer: "DAX · Needs answer",
  cooling_down: "DAX · Cooling down",
  provider_delayed: "DAX · Provider delayed",
  compacting: "DAX · Compacting context",
  resuming: "DAX · Resuming",
  working: "DAX · Working",
  complete: "DAX · Complete",
  ready: "DAX · Ready",
}

const ACTION_REQUIRING_STATES: ReadonlySet<HeaderState> = new Set<HeaderState>([
  "policy_blocked",
  "auth_required",
  "waiting_for_approval",
  "waiting_for_answer",
])

// Fixed iteration order for environment health collapse. Required services
// are evaluated in this order so the footer "reason" string is deterministic.
const SERVICES = ["provider", "mcp", "lsp"] as const

type Candidate = {
  state: HeaderState
  label: string
  requiresAction: boolean
  winner: string
  priority: number
  completedAt?: number
}

function candidate(state: HeaderState, winner: string): Candidate {
  return {
    state,
    label: HEADER_LABEL[state],
    requiresAction: ACTION_REQUIRING_STATES.has(state),
    winner,
    priority: HEADER_PRIORITY[state],
  }
}

function collectRunCandidate(
  active: ActiveUIState,
  now: number,
  previous: ResolvedUISurface | null,
): Candidate {
  switch (active.run) {
    case "failed":
      return candidate("failed", "run.failed")
    case "cooling_down":
      return candidate("cooling_down", "run.cooling_down")
    case "provider_delayed":
      return candidate("provider_delayed", "run.provider_delayed")
    case "compacting":
      return candidate("compacting", "run.compacting")
    case "resuming":
      return candidate("resuming", "run.resuming")
    case "working":
      return candidate("working", "run.working")
    case "ready":
      return candidate("ready", "run.ready")
    case "complete": {
      const previousCompletedAt =
        previous?.header.state === "complete" && previous.header.completedAt !== undefined
          ? previous.header.completedAt
          : now
      if (now - previousCompletedAt < COMPLETE_DECAY_MS) {
        return { ...candidate("complete", "run.complete"), completedAt: previousCompletedAt }
      }
      return candidate("ready", "run.complete.decayed")
    }
  }
}

function resolveHeader(
  active: ActiveUIState,
  now: number,
  previous: ResolvedUISurface | null,
): HeaderProjection {
  const candidates: Candidate[] = []

  if (active.safety.includes("policy_blocked")) {
    candidates.push(candidate("policy_blocked", "safety.policy_blocked"))
  }
  if (active.safety.includes("auth_required")) {
    candidates.push(candidate("auth_required", "safety.auth_required"))
  }

  if (active.user === "waiting_for_approval") {
    candidates.push(candidate("waiting_for_approval", "user.waiting_for_approval"))
  }
  if (active.user === "waiting_for_answer") {
    candidates.push(candidate("waiting_for_answer", "user.waiting_for_answer"))
  }

  candidates.push(collectRunCandidate(active, now, previous))

  const winner =
    candidates.toSorted((a, b) => a.priority - b.priority)[0] ?? candidate("ready", "fallback.ready")

  if (winner.state === "complete") {
    return { ...winner, completedAt: winner.completedAt ?? now }
  }

  const { completedAt: _unused, ...rest } = winner
  return rest
}

function resolveInspector(header: HeaderProjection): InspectorProjection {
  switch (header.state) {
    case "policy_blocked":
      return {
        state: "safety_block",
        requiresFocusTrap: true,
        openedBy: header.winner,
        content: "policy_blocked",
      }
    case "auth_required":
      return {
        state: "auth_required",
        requiresFocusTrap: true,
        openedBy: header.winner,
        content: "auth_required",
      }
    case "waiting_for_approval":
      return {
        state: "approval_card",
        requiresFocusTrap: true,
        openedBy: header.winner,
        content: "approval",
      }
    case "waiting_for_answer":
      return {
        state: "question_card",
        requiresFocusTrap: true,
        openedBy: header.winner,
        content: "question",
      }
    default:
      return { state: "closed", requiresFocusTrap: false }
  }
}

function resolveFooter(environment: EnvironmentHealth): FooterProjection {
  for (const service of SERVICES) {
    if (environment[service] === "unavailable") {
      return {
        health: "unavailable",
        label: "● Env unavailable",
        reason: `${service} unavailable`,
        services: environment,
      }
    }
  }
  for (const service of SERVICES) {
    if (environment[service] === "degraded") {
      return {
        health: "degraded",
        label: "● Env degraded",
        reason: `${service} degraded`,
        services: environment,
      }
    }
  }
  return { health: "healthy", label: "● Env", services: environment }
}

export function resolveUIState(
  active: ActiveUIState,
  now: number,
  previous: ResolvedUISurface | null,
): ResolvedUISurface {
  const header = resolveHeader(active, now, previous)
  return {
    header,
    inspector: resolveInspector(header),
    footer: resolveFooter(active.environment),
  }
}

// Development-only invariant checks. Callers must gate to development mode;
// this function does not read globals on its own.
export function assertResolvedUIStateInvariants(projection: ResolvedUISurface): void {
  if (projection.inspector.state === "closed" && projection.inspector.content) {
    throw new Error("Contract violation: closed inspector cannot have content")
  }
  if (projection.header.requiresAction && projection.inspector.state === "closed") {
    throw new Error("Contract violation: required action must open inspector")
  }
  if (projection.inspector.state === "closed" && projection.inspector.requiresFocusTrap) {
    throw new Error("Contract violation: closed inspector cannot trap focus")
  }
  if (projection.header.state === "complete" && projection.header.completedAt === undefined) {
    throw new Error("Contract violation: complete header must record completedAt")
  }
  if (projection.header.state !== "complete" && projection.header.completedAt !== undefined) {
    throw new Error("Contract violation: completedAt is only valid on complete header")
  }
}

export const IDLE_ACTIVE_UI_STATE: ActiveUIState = {
  run: "ready",
  user: null,
  environment: {
    provider: "healthy",
    mcp: "healthy",
    lsp: "healthy",
  },
  safety: [],
  focus: "none",
}

export const IDLE_UI_PROJECTION: ResolvedUISurface = resolveUIState(IDLE_ACTIVE_UI_STATE, 0, null)
