import { isGenericSessionShell } from "@/session/visibility"

type SessionShellLike = {
  parentID?: string
  summary?: unknown
  share?: {
    url?: string
  }
  title: string
  time: {
    created: number
    updated: number
    archived?: number
  }
}

const EMPTY_SHELL_MAX_AGE_MS = 60_000

export function isPlaceholderSessionShell(session: SessionShellLike) {
  if (!isGenericSessionShell({ ...session, id: "session_placeholder_check" })) return false
  return session.time.updated - session.time.created <= EMPTY_SHELL_MAX_AGE_MS
}

export function visibleSessionList<T extends SessionShellLike>(sessions: readonly T[]) {
  return sessions.filter((session) => !isPlaceholderSessionShell(session))
}
