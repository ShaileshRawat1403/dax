import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ensureDir } from "../storage/json";

export interface LedgerEvent {
  type: string;
  payload: any;
}

export interface LedgerRow extends LedgerEvent {
  ts: string;
  prev: string | null;
  hash: string;
}

export function ledgerPath(projectDir: string): string {
  return join(projectDir, ".dax", "ledger.jsonl");
}

function hashEvent(event: Omit<LedgerRow, 'hash'>, prevHash: string | null): string {
  const h = createHash("sha256");
  h.update(prevHash || "");
  h.update(JSON.stringify(event));
  return h.digest("hex");
}

export function recordEvent(projectDir: string, event: LedgerEvent): void {
  const path = ledgerPath(projectDir);
  ensureDir(join(projectDir, ".dax"));
  const last = readLastEvent(projectDir);

  const row: Omit<LedgerRow, 'hash'> = {
    ...event,
    ts: new Date().toISOString(),
    prev: last?.hash || null,
  };
  const hash = hashEvent(row, row.prev);
  const finalRow: LedgerRow = { ...row, hash };

  appendFileSync(path, JSON.stringify(finalRow) + "\n");
}

export function readLastEvent(projectDir: string): LedgerRow | null {
  const path = ledgerPath(projectDir);
  if (!existsSync(path)) return null;

  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  if (!lines.length) return null;

  return JSON.parse(lines[lines.length - 1]) as LedgerRow;
}

export function readEvents(projectDir: string, limit = 100): LedgerRow[] {
  const path = ledgerPath(projectDir);
  try {
    const raw = readFileSync(path, "utf8");
    const rows = raw.split("\n").filter(Boolean).map(line => JSON.parse(line) as LedgerRow);
    return rows.slice(-limit);
  } catch {
    return [];
  }
}

export type VerificationResult = { ok: true, count: number } | { ok: false, error: string };

export function verifyLedger(projectDir: string): VerificationResult {
  const path = ledgerPath(projectDir);
  if (!existsSync(path)) return { ok: true, count: 0 };

  const raw = readFileSync(path, "utf8");
  const rows: LedgerRow[] = raw.split("\n").filter(Boolean).map(line => JSON.parse(line));
  
  let prev: string | null = null;
  for (const row of rows) {
    const { hash, ...eventWithoutHash } = row;
    const expected = hashEvent(eventWithoutHash, prev);
    if (expected !== hash) {
      return { ok: false, error: "hash_mismatch" };
    }
    prev = hash;
  }
  return { ok: true, count: rows.length };
}
