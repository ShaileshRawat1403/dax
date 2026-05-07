import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { rmSync } from "fs"
import { appendLedgerEntry, appendToLedgerFile, loadLedgerFile, verifyLedgerChain } from "./ledger"

describe("dax-ledger Rust adapter", () => {
  test(
    "appends and verifies an in-memory chain",
    async () => {
      const first = await appendLedgerEntry(null, { z: 1, a: 2 }, "2026-05-07T00:00:00Z")
      const second = await appendLedgerEntry(first, { kind: "run.completed" }, "2026-05-07T00:00:01Z")

      expect(first.schema_version).toBe("dax.ledger.entry.v1")
      expect(first.seq).toBe(0)
      expect(first.prev_hash).toBe("")
      expect(second.seq).toBe(1)
      expect(second.prev_hash).toBe(first.chain_hash)

      await expect(verifyLedgerChain([first, second])).resolves.toEqual({ ok: true })
    },
    120_000,
  )

  test(
    "detects tampered ledger bodies",
    async () => {
      const first = await appendLedgerEntry(null, { kind: "run.created" }, "2026-05-07T00:00:00Z")
      const second = await appendLedgerEntry(first, { kind: "run.completed" }, "2026-05-07T00:00:01Z")
      const tampered = { ...second, body: { kind: "run.failed" } }

      const result = await verifyLedgerChain([first, tampered])

      expect(result.ok).toBeFalse()
      expect(result.seq).toBe(1)
      expect(result.error).toContain("body hash mismatch")
    },
    120_000,
  )

  test(
    "appends to and exports a JSONL ledger file",
    async () => {
      const dir = path.join(os.tmpdir(), `dax-ledger-test-${Date.now().toString(36)}`)
      const ledgerPath = path.join(dir, "run_1.jsonl")

      try {
        const first = await appendToLedgerFile(ledgerPath, { kind: "run.created" }, "2026-05-07T00:00:00Z")
        const second = await appendToLedgerFile(ledgerPath, { kind: "run.completed" }, "2026-05-07T00:00:01Z")
        const exported = await loadLedgerFile(ledgerPath)

        expect(first.seq).toBe(0)
        expect(second.seq).toBe(1)
        expect(exported.verified).toBeTrue()
        expect(exported.entries.map((entry) => entry.chain_hash)).toEqual([first.chain_hash, second.chain_hash])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    120_000,
  )
})
