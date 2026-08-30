import {
  RunInspectorReadResultV1,
  type RunInspectorProjectionV1,
  type RunInspectorReadResultV1 as InspectorRead,
} from "@/server/run-inspector-projection"

export type CanonicalInspectorState =
  | { status: "loading"; stale: false }
  | { status: "ready"; snapshot: InspectorRead; stale: false }
  | { status: "stale"; snapshot: RunInspectorProjectionV1; stale: true; error: string }
  | { status: "unavailable"; stale: false; error: string }

export const initialCanonicalInspectorState = (): CanonicalInspectorState => ({ status: "loading", stale: false })

export function acceptCanonicalInspectorRead(value: unknown): CanonicalInspectorState {
  const parsed = RunInspectorReadResultV1.safeParse(value)
  if (!parsed.success) {
    return { status: "unavailable", stale: false, error: "Inspector response failed canonical contract validation." }
  }
  return { status: "ready", snapshot: parsed.data, stale: false }
}

export function rejectCanonicalInspectorRead(previous: CanonicalInspectorState, error: unknown): CanonicalInspectorState {
  const message = error instanceof Error ? error.message : "Canonical inspector read unavailable."
  if (previous.status === "stale") {
    return { status: "stale", snapshot: previous.snapshot, stale: true, error: message }
  }
  if (previous.status === "ready" && previous.snapshot.kind === "canonical") {
    return { status: "stale", snapshot: previous.snapshot, stale: true, error: message }
  }
  return { status: "unavailable", stale: false, error: message }
}
