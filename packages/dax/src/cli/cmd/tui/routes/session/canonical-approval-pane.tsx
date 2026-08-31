import { createEffect, createMemo, createSignal, on, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import type { PermissionRequest, QuestionRequest } from "@dax-ai/sdk/v2"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import type { DisplayMode } from "@/dax/presentation/session-display"
import type { RunInspectorProjectionV1 } from "@/server/run-inspector-projection"
import { RAOPane } from "./rao-pane"
import {
  canResolveCanonicalApproval,
  canonicalApprovalHeading,
  canonicalApprovalResolutionRequest,
  pendingCanonicalApprovalCount,
  presentCanonicalApproval,
  resolveThenReadCanonicalApproval,
  selectAdjacentCanonicalApproval,
  selectCanonicalApproval,
} from "./canonical-approval-card"
import {
  acceptCanonicalInspectorRead,
  initialCanonicalInspectorState,
  rejectCanonicalInspectorRead,
} from "./canonical-inspector-state"

/** Canonical approval decisions; legacy compatibility remains delegated to RAOPane. */
export function CanonicalApprovalPane(props: {
  runID: string
  displayMode: DisplayMode
  refreshKey?: unknown
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  onAllResolved?: () => void
}) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const [state, setState] = createSignal(initialCanonicalInspectorState())
  const [selectedApprovalId, setSelectedApprovalId] = createSignal<string | undefined>()
  const [inFlight, setInFlight] = createSignal(false)
  let refreshEpoch = 0
  let lastRunID: string | undefined

  const read = async (runID: string, resetForRunChange = false) => {
    const epoch = ++refreshEpoch
    if (resetForRunChange) setState(initialCanonicalInspectorState())
    try {
      const response = await sdk.fetch(new URL(`/runs/${encodeURIComponent(runID)}/inspector`, sdk.url))
      if (!response.ok) throw new Error(`Inspector request failed (${response.status})`)
      const next = acceptCanonicalInspectorRead(await response.json())
      if (next.status === "unavailable") throw new Error(next.error)
      if (epoch === refreshEpoch) setState(next)
    } catch (error) {
      if (epoch === refreshEpoch) setState((previous) => rejectCanonicalInspectorRead(previous, error))
    }
  }

  createEffect(on([() => props.runID, () => props.refreshKey], ([runID]) => {
    const changed = lastRunID !== runID
    lastRunID = runID
    void read(runID, changed)
  }, { defer: false }))

  const snapshot = createMemo(() => {
    const current = state()
    return current.status === "ready" || current.status === "stale" ? current.snapshot : undefined
  })
  const canonical = createMemo<RunInspectorProjectionV1 | undefined>(() => {
    const current = snapshot()
    return current?.kind === "canonical" ? current : undefined
  })
  const selected = createMemo(() => canonical() ? selectCanonicalApproval(canonical()!, selectedApprovalId()) : undefined)
  const card = createMemo(() => canonical() ? presentCanonicalApproval(canonical()!, selected()?.approvalId) : undefined)
  const pendingCount = createMemo(() => canonical() ? pendingCanonicalApprovalCount(canonical()!) : 0)
  const approvalCount = createMemo(() => canonical()?.approvals.length ?? 0)
  const selectedPosition = createMemo(() => canonical()?.approvals.findIndex((approval) => approval.approvalId === selected()?.approvalId) ?? -1)
  const actionable = createMemo(() => canResolveCanonicalApproval({
    state: state(), runId: props.runID, approvalId: selected()?.approvalId, inFlight: inFlight(),
  }))
  const error = createMemo(() => {
    const current = state()
    return "error" in current ? current.error : undefined
  })
  const unreadableReason = createMemo(() => {
    const current = snapshot()
    return current?.kind === "authority_unreadable" ? current.reason : undefined
  })

  createEffect(() => {
    const next = selected()
    if (next && next.approvalId !== selectedApprovalId()) setSelectedApprovalId(next.approvalId)
  })

  const decide = async (decision: "approve" | "deny") => {
    const approvalId = selected()?.approvalId
    if (!approvalId || !actionable()) return
    const runID = props.runID
    const epoch = ++refreshEpoch
    setInFlight(true)
    try {
      await resolveThenReadCanonicalApproval({
        resolve: async (id, value) => {
          const request = canonicalApprovalResolutionRequest(runID, id, value)
          const response = await sdk.fetch(new URL(request.path, sdk.url), request.init)
          if (!response.ok) throw new Error(`Approval decision failed (${response.status})`)
        },
        read: async () => {
          const response = await sdk.fetch(new URL(`/runs/${encodeURIComponent(runID)}/inspector`, sdk.url))
          if (!response.ok) throw new Error(`Inspector refresh failed (${response.status})`)
          return response.json()
        },
      }, approvalId, decision).then((value) => {
        const next = acceptCanonicalInspectorRead(value)
        if (next.status === "unavailable") throw new Error(next.error)
        if (next.status === "ready" && next.snapshot.runId !== runID) {
          throw new Error(`Inspector response run mismatch: expected ${runID}`)
        }
        if (props.runID === runID && epoch === refreshEpoch) setState(next)
      })
    } catch (cause) {
      if (props.runID === runID && epoch === refreshEpoch) {
        setState((previous) => rejectCanonicalInspectorRead(previous, cause))
      }
    } finally {
      setInFlight(false)
    }
  }

  const moveSelection = (direction: -1 | 1) => {
    const next = canonical() && selectAdjacentCanonicalApproval(canonical()!, selected()?.approvalId, direction)
    if (next) setSelectedApprovalId(next.approvalId)
  }

  useKeyboard((event) => {
    if (!actionable() || event.ctrl || event.meta || event.shift) return
    if (event.name === "y") {
      event.preventDefault()
      void decide("approve")
    }
    if (event.name === "n") {
      event.preventDefault()
      void decide("deny")
    }
  })

  return (
    <Show
      when={snapshot()?.kind !== "legacy_unsupported"}
      fallback={
        <box flexDirection="column" gap={1} flexGrow={1}>
          <text fg={theme.warning} attributes={TextAttributes.BOLD}>LEGACY COMPATIBILITY APPROVALS</text>
          <RAOPane permissions={props.permissions} questions={props.questions} sessionID={props.runID} onAllResolved={props.onAllResolved} />
        </box>
      }
    >
      <box flexDirection="column" gap={1} flexGrow={1} minHeight={0}>
        <Show when={state().status === "loading"}>
          <text fg={theme.textMuted}>Loading validated canonical approval…</text>
        </Show>
        <Show when={state().status === "unavailable" || snapshot()?.kind === "authority_unreadable"}>
          <box flexDirection="column" border={["left"]} borderColor={theme.error} paddingLeft={1}>
            <text fg={theme.error} attributes={TextAttributes.BOLD}>CANONICAL APPROVAL UNAVAILABLE</text>
            <text fg={theme.textMuted} wrapMode="word">{unreadableReason() ? `Canonical authority unreadable: ${unreadableReason()}` : error() ?? "Canonical authority is unreadable; no compatibility approval state is shown."}</text>
          </box>
        </Show>
        <Show when={state().status === "stale"}>
          <box flexDirection="column" border={["left"]} borderColor={theme.warning} paddingLeft={1}>
            <text fg={theme.warning} attributes={TextAttributes.BOLD}>STALE — LAST VALIDATED CANONICAL SNAPSHOT</text>
            <text fg={theme.textMuted} wrapMode="word">{error()}</text>
          </box>
        </Show>
        <Show when={card()}>
          {(view) => (
            <box flexDirection="column" gap={1} borderStyle="round" borderColor={view().status === "pending" ? theme.warning : theme.borderSubtle} padding={1}>
              <box flexDirection="row" gap={1}>
                <text fg={view().status === "pending" ? theme.warning : theme.primary} attributes={TextAttributes.BOLD}>{canonicalApprovalHeading(view().status)}</text>
                <box flexGrow={1} />
                <text fg={theme.textMuted}>{pendingCount()} pending</text>
              </box>
              <Show when={approvalCount() > 1}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.textMuted}>Approval {selectedPosition() + 1}/{approvalCount()}</text>
                  <box onMouseUp={() => moveSelection(-1)} borderStyle="round" borderColor={theme.borderSubtle} paddingLeft={1} paddingRight={1}>
                    <text fg={theme.textMuted}>Previous</text>
                  </box>
                  <box onMouseUp={() => moveSelection(1)} borderStyle="round" borderColor={theme.borderSubtle} paddingLeft={1} paddingRight={1}>
                    <text fg={theme.textMuted}>Next</text>
                  </box>
                </box>
              </Show>
              <text fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="word">{view().title}</text>
              <text fg={theme.textMuted}>{view().type} · {view().risk} risk · {view().approvalId}</text>
              <text fg={theme.textMuted} wrapMode="word">Reason: {view().reason}</text>
              <text fg={theme.textMuted} wrapMode="word">If approved: {view().expectedConsequence}</text>
              <text fg={theme.textMuted} wrapMode="word">{view().correlation}</text>
              <text fg={theme.textMuted} wrapMode="word">{view().actionContext}</text>
              <text fg={theme.textMuted} wrapMode="word">{view().scope}</text>
              <text fg={theme.textMuted}>Requested: {view().requestedAt}</text>
              <Show when={view().status !== "pending"}>
                <text fg={theme.warning} wrapMode="word">Durable decision: {view().status}{view().decidedBy ? ` by ${view().decidedBy}` : ""}{view().decidedAt ? ` at ${view().decidedAt}` : ""}. Read only.</text>
              </Show>
              <Show when={inFlight()}>
                <text fg={theme.textMuted}>Recording decision…</text>
              </Show>
              <Show when={view().status === "pending"}>
                <box flexDirection="row" gap={1}>
                  <box onMouseUp={() => void decide("approve")} borderStyle="round" borderColor={actionable() ? theme.primary : theme.borderSubtle} paddingLeft={1} paddingRight={1}>
                    <text fg={actionable() ? theme.primary : theme.textMuted} attributes={TextAttributes.BOLD}>Approve once (Y)</text>
                  </box>
                  <box onMouseUp={() => void decide("deny")} borderStyle="round" borderColor={actionable() ? theme.error : theme.borderSubtle} paddingLeft={1} paddingRight={1}>
                    <text fg={actionable() ? theme.error : theme.textMuted} attributes={TextAttributes.BOLD}>Deny (N)</text>
                  </box>
                </box>
              </Show>
              <Show when={props.displayMode === "inspect"}>
                <text fg={theme.textMuted}>Canonical cursor: {canonical()?.authority.cursor}</text>
              </Show>
            </box>
          )}
        </Show>
        <Show when={canonical() && !card()}>
          <text fg={theme.textMuted}>No canonical approval records for this run.</text>
        </Show>
      </box>
    </Show>
  )
}
