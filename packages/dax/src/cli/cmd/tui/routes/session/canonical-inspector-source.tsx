import { createContext, createEffect, createMemo, createSignal, on, useContext, type Accessor, type ParentProps } from "solid-js"
import { useSDK } from "@tui/context/sdk"
import type { RunInspectorProjectionV1, RunInspectorReadResultV1 } from "@/server/run-inspector-projection"
import {
  acceptCanonicalInspectorRead,
  initialCanonicalInspectorState,
  rejectCanonicalInspectorRead,
  type CanonicalInspectorState,
} from "./canonical-inspector-state"
import { shouldApplyCanonicalRefresh } from "./canonical-inspector-source-state"

export type CanonicalInspectorSource = {
  state: Accessor<CanonicalInspectorState>
  snapshot: Accessor<RunInspectorReadResultV1 | RunInspectorProjectionV1 | undefined>
  canonical: Accessor<RunInspectorProjectionV1 | undefined>
  refresh: (runId?: string) => Promise<CanonicalInspectorState>
  invalidate: (error: unknown, runId?: string) => void
}

const CanonicalInspectorSourceContext = createContext<CanonicalInspectorSource>()

/** One session-scoped, validated authority read shared by header and workstation panes. */
export function CanonicalInspectorSourceProvider(props: ParentProps<{ runID: string; refreshKey?: unknown }>) {
  const sdk = useSDK()
  const [state, setState] = createSignal<CanonicalInspectorState>(initialCanonicalInspectorState())
  let refreshEpoch = 0
  let lastRunID: string | undefined

  const refresh = async (runId = props.runID): Promise<CanonicalInspectorState> => {
    const epoch = ++refreshEpoch
    try {
      const response = await sdk.fetch(new URL(`/runs/${encodeURIComponent(runId)}/inspector`, sdk.url))
      if (!response.ok) throw new Error(`Inspector request failed (${response.status})`)
      const next = acceptCanonicalInspectorRead(await response.json(), runId)
      if (next.status === "unavailable") throw new Error(next.error)
      if (shouldApplyCanonicalRefresh({ requestEpoch: epoch, currentEpoch: refreshEpoch, requestedRunId: runId, currentRunId: props.runID })) setState(next)
      return next
    } catch (error) {
      const next = rejectCanonicalInspectorRead(state(), error)
      if (shouldApplyCanonicalRefresh({ requestEpoch: epoch, currentEpoch: refreshEpoch, requestedRunId: runId, currentRunId: props.runID })) setState(next)
      return next
    }
  }

  const invalidate = (error: unknown, runId = props.runID) => {
    if (props.runID === runId) setState((previous) => rejectCanonicalInspectorRead(previous, error))
  }

  createEffect(on([() => props.runID, () => props.refreshKey], ([runId]) => {
    const changed = lastRunID !== runId
    lastRunID = runId
    if (changed) {
      ++refreshEpoch
      setState(initialCanonicalInspectorState())
    }
    void refresh(runId)
  }, { defer: false }))

  const snapshot = createMemo(() => {
    const current = state()
    return current.status === "ready" || current.status === "stale" ? current.snapshot : undefined
  })
  const canonical = createMemo<RunInspectorProjectionV1 | undefined>(() => {
    const current = snapshot()
    return current?.kind === "canonical" ? current : undefined
  })

  return (
    <CanonicalInspectorSourceContext.Provider value={{ state, snapshot, canonical, refresh, invalidate }}>
      {props.children}
    </CanonicalInspectorSourceContext.Provider>
  )
}

export function useCanonicalInspectorSource() {
  const source = useContext(CanonicalInspectorSourceContext)
  if (!source) throw new Error("useCanonicalInspectorSource must be used within CanonicalInspectorSourceProvider")
  return source
}

export function useOptionalCanonicalInspectorSource() {
  return useContext(CanonicalInspectorSourceContext)
}
