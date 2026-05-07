import { createHash, randomUUID } from "node:crypto"
import type { CheckResult } from "./check-types"

export type EvidenceReceipt = {
  schemaVersion: "dax.sdlc.receipt.v1"
  receiptId: string
  runId: string
  claim: string
  proofType: "command_result"
  source: "dax"
  checkId: string
  status: CheckResult["status"]
  command: string
  cwd: string
  durationMs: number
  verifiedAt: string
  digest: string
}

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
