import { readFile } from "node:fs/promises"
import { createRustProofReport, replayRunStateWithRust, type DaxCoreProofReport, type DaxCoreRunState } from "@/rust/core"

export type ReplayVerificationResult =
  | { includeState: false; proof: DaxCoreProofReport }
  | { includeState: true; proof: DaxCoreProofReport; state: DaxCoreRunState }

export async function readReplayEventsFile(filePath: string): Promise<unknown[]> {
  let text: string
  try {
    text = await readFile(filePath, "utf8")
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Cannot read events file: ${msg}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Events file is not valid JSON: ${filePath}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Events file must contain a JSON array, got ${typeof parsed}: ${filePath}`)
  }

  return parsed
}

export async function verifyReplayEvents(
  events: unknown[],
  options: { includeState: boolean },
): Promise<ReplayVerificationResult> {
  const proof = await createRustProofReport(events)

  if (options.includeState) {
    const state = await replayRunStateWithRust(events)
    return { includeState: true, proof, state }
  }

  return { includeState: false, proof }
}

export function formatReplayProof(proof: DaxCoreProofReport): string {
  const lines: string[] = [
    "DAX Replay Verification",
    "",
    `Result:               ${proof.result}`,
    `Events:               ${proof.eventCount}`,
  ]

  if (proof.finalStatus) lines.push(`Final status:         ${proof.finalStatus}`)
  if (proof.stateHash)   lines.push(`State hash:           ${proof.stateHash}`)

  lines.push(`Event sequence hash:  ${proof.eventSequenceHash}`)

  if (proof.result === "pass") {
    lines.push("")
    lines.push("The event log replayed successfully through the Rust deterministic core.")
  }

  if (proof.error) {
    lines.push("")
    lines.push(`Error: ${proof.error}`)
  }

  return lines.join("\n")
}
