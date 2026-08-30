import type { ExecutionContract } from "./execution-contract"
import { appendEventOnly } from "@/state/events/event-transitions"
import { verifyWorkerPatch } from "@/worker/worker-verification"
import { runSandboxedWorkerCheck } from "@/worker/worker-sandbox"
import type { CheckDefinition, CheckResult } from "@/sdlc/check-types"

type NativeVerificationEffectsShape = {
  run: (check: CheckDefinition) => Promise<CheckResult>
}

const defaultEffects: NativeVerificationEffectsShape = {
  run: runSandboxedWorkerCheck,
}

/** Test seam for the external process only; canonical production logic remains in this module. */
export const NativeVerificationEffects = {
  current: defaultEffects,
  set(effects: Partial<NativeVerificationEffectsShape>) {
    NativeVerificationEffects.current = { ...defaultEffects, ...effects }
  },
  reset() {
    NativeVerificationEffects.current = defaultEffects
  },
}

export type NativeVerificationDecision =
  | { status: "not_required" }
  | { status: "unspecified" }
  | { status: "passed"; receiptIds: string[] }
  | { status: "failed"; receiptIds: string[]; failureSummary: string }

/**
 * Executes the immutable contract's complete validation plan and records its
 * outcome. The provider can propose completion, but it cannot choose which
 * checks count or manufacture their result.
 */
export async function recordNativeVerification(input: {
  runId: string
  contract: ExecutionContract
  cwd: string
}): Promise<NativeVerificationDecision> {
  const postconditions = input.contract.runtimePolicy?.postconditions
  if (postconditions?.verificationRequired !== true) return { status: "not_required" }

  const commands = postconditions.validationCommands
  if (commands.length === 0) return { status: "unspecified" }

  const verification = await verifyWorkerPatch({
    runId: input.runId,
    cwd: input.cwd,
    commands,
    run: NativeVerificationEffects.current.run,
  })

  await appendEventOnly(input.runId, "verification_recorded", {
    status: verification.passed ? "passed" : "failed",
    receipts: verification.receipts,
    checks: verification.checks,
  })

  const receiptIds = verification.receipts.map((receipt) => receipt.receiptId)
  return verification.passed
    ? { status: "passed", receiptIds }
    : {
        status: "failed",
        receiptIds,
        failureSummary: verification.failureSummary ?? "DAX native verification failed",
      }
}
