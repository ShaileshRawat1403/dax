import { Session } from "./index"

type SessionVisibilityLike = {
  id: string
  parentID?: string
  summary?: unknown
  share?: {
    url?: string
  }
  title: string
  time: {
    created?: number
    updated?: number
    archived?: number
  }
}

const GENERIC_SHELL_TITLES = new Set(["External run", "Initial intent"])
const CURATED_HIDE_GRACE_MS = 5 * 60 * 1000

export function isGenericSessionShell(session: SessionVisibilityLike) {
  if (session.parentID) return false
  if (session.time.archived) return false
  if (session.summary) return false
  if (session.share?.url) return false
  return GENERIC_SHELL_TITLES.has(session.title) || Session.isDefaultTitle(session.title)
}

export async function shouldHideSessionFromCuratedLists(
  session: SessionVisibilityLike,
  options?: {
    status?: string
    now?: number
  },
) {
  if (!isGenericSessionShell(session)) return false
  if (options?.status && ["created", "queued", "running", "waiting_approval"].includes(options.status)) return false
  const messages = await Session.messages({ sessionID: session.id, limit: 1 }).catch(() => [])
  if (messages.length > 0) return false
  if (options?.status && ["completed", "failed", "cancelled"].includes(options.status)) return true

  const now = options?.now ?? Date.now()
  const updatedAt = session.time.updated ?? session.time.created ?? 0
  return now - updatedAt > CURATED_HIDE_GRACE_MS
}
