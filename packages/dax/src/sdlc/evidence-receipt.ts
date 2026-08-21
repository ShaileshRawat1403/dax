import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import { CheckStatus, type CheckResult } from "./check-types"

export const EvidenceReceipt = z
  .object({
    schemaVersion: z.literal("dax.sdlc.receipt.v1"),
    receiptId: z.string(),
    runId: z.string(),
    claim: z.string(),
    proofType: z.literal("command_result"),
    source: z.literal("dax"),
    checkId: z.string(),
    status: CheckStatus,
    command: z.string(),
    cwd: z.string(),
    durationMs: z.number(),
    verifiedAt: z.string(),
    digest: z.string(),
  })
  .strict()
export type EvidenceReceipt = z.infer<typeof EvidenceReceipt>

export function createEvidenceReceipt(runId: string, result: CheckResult): EvidenceReceipt {
  const digest = createHash("sha256").update(JSON.stringify(result)).digest("hex")

  return {
    schemaVersion: "dax.sdlc.receipt.v1",
    receiptId: randomUUID(),
    runId,
    claim: `${result.label} ${result.status}`,
    proofType: "command_result",
    source: "dax",
    checkId: result.id,
    status: result.status,
    command: result.command,
    cwd: result.cwd,
    durationMs: result.durationMs,
    verifiedAt: result.finishedAt,
    digest,
  }
}
