import { createHash, randomUUID } from "node:crypto"

/**
 * Attests that a run changed the workspace, and what it changed.
 *
 * The gap this closes: `RunState.governance.mutationReceiptIds` and
 * `touchedFiles` were declared, initialised, and populated by no event, while
 * `rao/adapters.ts` built an operator-facing evidence claim — "Mutations
 * recorded (N)" — from them. For every event-authority run that array was empty,
 * so the RAO ledger reported no mutations for runs that had mutated, quietly.
 *
 * The rule this makes enforceable is invariant 6: a run that changed the tree
 * owes evidence that the change is correct, whatever its contract happened to
 * ask for. `execution/runtime-guard.ts` already applied that rule, but on a
 * parallel state object the reducer never sees.
 *
 * Mirrors `sdlc/evidence-receipt.ts`: the digest is over the thing being
 * attested, so a receipt cannot be reattached to different content.
 */
export type MutationReceipt = {
  schemaVersion: "dax.sdlc.mutation.v1"
  receiptId: string
  runId: string
  claim: string
  proofType: "workspace_diff"
  source: "dax"
  /** Paths the kernel observed as changed, not paths the actor claimed to touch. */
  changedPaths: string[]
  recordedAt: string
  /** sha256 of the diff itself, so the receipt commits to exact content. */
  digest: string
}

export function createMutationReceipt(input: {
  runId: string
  changedPaths: string[]
  /** The diff whose digest the receipt commits to. */
  diff: string
}): MutationReceipt {
  const digest = createHash("sha256").update(input.diff).digest("hex")
  const count = input.changedPaths.length

  return {
    schemaVersion: "dax.sdlc.mutation.v1",
    receiptId: randomUUID(),
    runId: input.runId,
    claim: `${count} file${count === 1 ? "" : "s"} changed`,
    proofType: "workspace_diff",
    source: "dax",
    changedPaths: input.changedPaths,
    recordedAt: new Date().toISOString(),
    digest,
  }
}
