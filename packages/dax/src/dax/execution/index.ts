export const EXECUTION_PHASE = ["explore", "plan", "execute", "verify", "record"] as const

export type ExecutionPhase = (typeof EXECUTION_PHASE)[number]
