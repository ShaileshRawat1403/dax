import path from "path"
import { resolveRustBinary } from "./resolve-binary"

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")

export type DaxLedgerCommand = "append" | "verify" | "append-file" | "export" | "version"

export type LedgerEntry = {
  schema_version: "dax.ledger.entry.v1"
  seq: number
  ts: string
  prev_hash: string
  body_hash: string
  chain_hash: string
  body: unknown
}

export type VerifyLedgerResult = {
  ok: boolean
  error?: string
  seq?: number
}

export type LedgerExport = {
  entries: LedgerEntry[]
  verified: boolean
}

export class DaxLedgerError extends Error {
  readonly command: DaxLedgerCommand
  readonly exitCode: number | null
  readonly stderr: string

  constructor(args: { command: DaxLedgerCommand; exitCode: number | null; stderr: string }) {
    super(`dax-ledger ${args.command} failed: ${args.stderr.trim() || "unknown error"}`)
    this.name = "DaxLedgerError"
    this.command = args.command
    this.exitCode = args.exitCode
    this.stderr = args.stderr
  }
}

export type DaxLedgerOptions = {
  /**
   * Override the binary argv. Defaults to `cargo run -q -p dax-ledger-bin --`.
   * Production builds can point this to a compiled dax-ledger binary path.
   */
  binary?: string[]
  cwd?: string
}

function defaultCmd(command: DaxLedgerCommand): string[] {
  return [...resolveRustBinary("dax-ledger", "dax-ledger"), command]
}

async function runDaxLedgerJson<T>(
  command: DaxLedgerCommand,
  input: unknown,
  options: DaxLedgerOptions = {},
): Promise<T> {
  const argv = options.binary ? [...options.binary, command] : defaultCmd(command)
  const cwd = options.cwd ?? REPO_ROOT

  const proc = Bun.spawn(argv, {
    cwd,
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new DaxLedgerError({ command, exitCode, stderr })
  }

  return JSON.parse(stdout) as T
}

export async function appendLedgerEntry(
  prev: LedgerEntry | null,
  body: unknown,
  ts: string,
  options?: DaxLedgerOptions,
): Promise<LedgerEntry> {
  return runDaxLedgerJson<LedgerEntry>("append", { prev, body, ts }, options)
}

export async function verifyLedgerChain(
  entries: LedgerEntry[],
  options?: DaxLedgerOptions,
): Promise<VerifyLedgerResult> {
  return runDaxLedgerJson<VerifyLedgerResult>("verify", { entries }, options)
}

export async function appendToLedgerFile(
  ledgerPath: string,
  body: unknown,
  ts: string,
  options?: DaxLedgerOptions,
): Promise<LedgerEntry> {
  return runDaxLedgerJson<LedgerEntry>("append-file", { path: ledgerPath, body, ts }, options)
}

export async function loadLedgerFile(ledgerPath: string, options?: DaxLedgerOptions): Promise<LedgerExport> {
  return runDaxLedgerJson<LedgerExport>("export", { path: ledgerPath }, options)
}
