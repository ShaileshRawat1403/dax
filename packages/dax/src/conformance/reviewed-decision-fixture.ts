import { spyOn } from "bun:test"
import * as ImplementationBinding from "@/capability/implementation-binding"
import { transitionEventAuthority } from "@/state/events/event-transitions"

/**
 * Narrow decision-boundary fixture, NOT compiled producer acceptance. Install
 * only after proposal/publication/activation, so no native grants are invented.
 * Real compiled producer/image controls are in grant-stage4d.test.ts.
 */
export async function reviewedDecisionFixture(runId: string) {
  const image =
    ImplementationBinding.daxExecutable().form === "compiled"
      ? undefined
      : spyOn(ImplementationBinding, "daxExecutable").mockReturnValue({
          form: "compiled",
          commit: "decision-fixture",
          runtime: Bun.revision,
          bundle: `sha256:${"b".repeat(64)}`,
        })
  await transitionEventAuthority(runId, "running", "execution_started", {})
  return () => image?.mockRestore()
}
