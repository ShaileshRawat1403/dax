import path from "node:path"
import { Instance } from "@/project/instance"
import { Snapshot } from "@/snapshot"
import { createMutationReceipt, type MutationReceipt } from "@/sdlc/mutation-receipt"
import { recordNativeMutation } from "@/state/events/event-transitions"

type ObservationWindow = {
  baseline: string
  participants: Set<string>
  failure: NativeMutationObservationError | null
}

const windows = new Map<string, ObservationWindow>()
const lockTails = new Map<string, Promise<void>>()

export class NativeMutationObservationError extends Error {
  constructor(
    public readonly runId: string,
    public readonly stage: "baseline" | "diff" | "receipt" | "advance",
    message: string,
    options?: ErrorOptions,
  ) {
    super(`Native mutation observation failed for run ${runId} at ${stage}: ${message}`, options)
    this.name = "NativeMutationObservationError"
  }
}

async function withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const previous = lockTails.get(runId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => gate)
  lockTails.set(runId, tail)
  await previous
  try {
    return await fn()
  } finally {
    release()
    if (lockTails.get(runId) === tail) lockTails.delete(runId)
  }
}

function normalizeChangedPaths(files: string[]): string[] {
  return [...new Set(files.map((file) => path.relative(Instance.worktree, file).replaceAll("\\", "/")))].sort()
}

async function requiredBaseline(runId: string, stage: "baseline" | "advance"): Promise<string> {
  let baseline: string | undefined
  try {
    baseline = await Snapshot.track()
  } catch (error) {
    throw new NativeMutationObservationError(runId, stage, error instanceof Error ? error.message : String(error), {
      cause: error,
    })
  }
  if (!baseline) {
    throw new NativeMutationObservationError(
      runId,
      stage,
      "no Git snapshot is available; governed mutation cannot proceed without a kernel baseline",
    )
  }
  return baseline
}

/**
 * Opens or joins a run-scoped kernel observation window. This is awaited after
 * durable authorization and before the first possible external effect.
 */
export async function prepareNativeMutationObservation(runId: string, invocationId: string): Promise<void> {
  await withRunLock(runId, async () => {
    let window = windows.get(runId)
    if (window?.failure) throw window.failure
    if (!window) {
      window = {
        baseline: await requiredBaseline(runId, "baseline"),
        participants: new Set(),
        failure: null,
      }
      windows.set(runId, window)
    }
    window.participants.add(invocationId)
  })
}

export type NativeMutationObservationResult =
  | { status: "not_prepared" }
  | { status: "unchanged" }
  | { status: "recorded"; receipt: MutationReceipt; invocationIds: string[] }

/**
 * Observes everything that changed since the current baseline before the
 * invocation's terminal result is appended. Overlapping invocations are named
 * as one observation window; DAX does not fabricate per-tool attribution.
 */
export async function settleNativeMutationObservation(
  runId: string,
  invocationId: string,
): Promise<NativeMutationObservationResult> {
  return withRunLock(runId, async () => {
    const window = windows.get(runId)
    if (!window || !window.participants.has(invocationId)) return { status: "not_prepared" }
    if (window.failure) throw window.failure

    const invocationIds = [...window.participants]
    let observation: Awaited<ReturnType<typeof Snapshot.patch>>
    try {
      observation = await Snapshot.patch(window.baseline)
    } catch (error) {
      window.failure = new NativeMutationObservationError(
        runId,
        "diff",
        error instanceof Error ? error.message : String(error),
        { cause: error },
      )
      throw window.failure
    }
    if (observation.status === "failed") {
      window.failure = new NativeMutationObservationError(
        runId,
        "diff",
        `${observation.failure.code} (exit ${observation.failure.exitCode})`,
      )
      throw window.failure
    }

    const changedPaths = normalizeChangedPaths(observation.patch.files)
    let receipt: MutationReceipt | undefined
    if (changedPaths.length > 0) {
      if (!observation.diff.trim()) {
        window.failure = new NativeMutationObservationError(
          runId,
          "diff",
          "Git reported changed paths but returned an empty diff",
        )
        throw window.failure
      }
      receipt = createMutationReceipt({ runId, changedPaths, diff: observation.diff })
      try {
        await recordNativeMutation(runId, receipt, invocationIds)
      } catch (error) {
        window.failure = new NativeMutationObservationError(
          runId,
          "receipt",
          error instanceof Error ? error.message : String(error),
          { cause: error },
        )
        throw window.failure
      }
    }

    window.participants.delete(invocationId)
    if (window.participants.size === 0) {
      windows.delete(runId)
    } else {
      try {
        window.baseline = await requiredBaseline(runId, "advance")
      } catch (error) {
        window.failure =
          error instanceof NativeMutationObservationError
            ? error
            : new NativeMutationObservationError(runId, "advance", String(error), { cause: error })
        throw window.failure
      }
    }

    return receipt
      ? { status: "recorded", receipt, invocationIds }
      : { status: "unchanged" }
  })
}

/** Process-local cleanup for tests/abandoned coordination; never repairs durable history. */
export function discardNativeMutationObservation(runId: string, invocationId: string): void {
  const window = windows.get(runId)
  if (!window) return
  window.participants.delete(invocationId)
  if (window.participants.size === 0) windows.delete(runId)
}
