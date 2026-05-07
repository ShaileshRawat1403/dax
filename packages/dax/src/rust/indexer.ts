import path from "path"
import { createHash } from "crypto"
import { Global } from "../global"
import { resolveRustBinary } from "./resolve-binary"

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")

export type DaxIndexerCommand = "build" | "query" | "symbols" | "imports" | "dump" | "version"

export type IndexedLanguage = "typescript" | "tsx" | "javascript" | "jsx" | "rust"

export type IndexedSymbol = {
  name: string
  kind: string
  exported: boolean
  line: number
  col: number
}

export type IndexedImport = {
  from: string
  names: string[]
  line: number
}

export type IndexedFile = {
  path: string
  lang: IndexedLanguage
  content_hash: string
  mtime_ns: number
  symbols: IndexedSymbol[]
  imports: IndexedImport[]
  parse_error?: string
}

export type DaxIndex = {
  schema_version: "dax.indexer.index.v1"
  project_id?: string
  repo_root: string
  generated_at: string
  language_versions: Record<string, string>
  exclude_fingerprint: string
  files: IndexedFile[]
}

export type BuildIndexRequest = {
  repoRoot: string
  cacheDir?: string
  projectId?: string
  force?: boolean
  excludes?: string[]
}

export type BuildIndexResult = {
  schema_version: "dax.indexer.index.v1"
  files_indexed: number
  duration_ms: number
  cache_dir: string
}

export type IndexQuery = {
  keywords: string[]
  touchedFiles?: string[]
  limit?: number
}

export type RelevanceHit = {
  path: string
  score: number
  reasons: string[]
}

export type QueryIndexResult = {
  hits: RelevanceHit[]
}

export type SymbolsResult = {
  symbols: IndexedSymbol[]
}

export type ImportsResult = {
  imports: IndexedImport[]
  importers: string[]
}

export class DaxIndexerError extends Error {
  readonly command: DaxIndexerCommand
  readonly exitCode: number | null
  readonly stderr: string

  constructor(args: { command: DaxIndexerCommand; exitCode: number | null; stderr: string }) {
    super(`dax-indexer ${args.command} failed: ${args.stderr.trim() || "unknown error"}`)
    this.name = "DaxIndexerError"
    this.command = args.command
    this.exitCode = args.exitCode
    this.stderr = args.stderr
  }
}

export type DaxIndexerOptions = {
  /**
   * Override the binary argv. Defaults to `cargo run -q -p dax-indexer-bin --`.
   * Production builds can point this to a compiled dax-indexer binary path.
   */
  binary?: string[]
  cwd?: string
}

function defaultCmd(command: DaxIndexerCommand): string[] {
  return [...resolveRustBinary("dax-indexer", "dax-indexer"), command]
}

function hashPath(input: string): string {
  return createHash("sha256").update(path.resolve(input)).digest("hex").slice(0, 24)
}

export function indexCacheDir(input: { repoRoot: string; projectId?: string }): string {
  return path.join(Global.Path.cache, "index", input.projectId ?? hashPath(input.repoRoot))
}

async function runDaxIndexerJson<T>(
  command: DaxIndexerCommand,
  input: unknown,
  options: DaxIndexerOptions = {},
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
    throw new DaxIndexerError({ command, exitCode, stderr })
  }

  return JSON.parse(stdout) as T
}

async function runDaxIndexerText(
  command: DaxIndexerCommand,
  input: unknown,
  options: DaxIndexerOptions = {},
): Promise<string> {
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
    throw new DaxIndexerError({ command, exitCode, stderr })
  }

  return stdout
}

export async function buildIndex(
  request: BuildIndexRequest,
  options?: DaxIndexerOptions,
): Promise<BuildIndexResult> {
  const repoRoot = path.resolve(request.repoRoot)
  const cacheDir = request.cacheDir ?? indexCacheDir({ repoRoot, projectId: request.projectId })
  return runDaxIndexerJson<BuildIndexResult>(
    "build",
    {
      repo_root: repoRoot,
      cache_dir: cacheDir,
      project_id: request.projectId,
      force: request.force ?? false,
      excludes: request.excludes ?? [],
    },
    options,
  )
}

export async function queryIndex(
  cacheDir: string,
  query: IndexQuery,
  options?: DaxIndexerOptions,
): Promise<RelevanceHit[]> {
  const response = await runDaxIndexerJson<QueryIndexResult>(
    "query",
    {
      cache_dir: cacheDir,
      keywords: query.keywords,
      touched_files: query.touchedFiles ?? [],
      limit: query.limit ?? 10,
    },
    options,
  )
  return response.hits
}

export async function getSymbols(
  cacheDir: string,
  file: string,
  options?: DaxIndexerOptions,
): Promise<IndexedSymbol[]> {
  const response = await runDaxIndexerJson<SymbolsResult>("symbols", { cache_dir: cacheDir, file }, options)
  return response.symbols
}

export async function getImports(cacheDir: string, file: string, options?: DaxIndexerOptions): Promise<ImportsResult> {
  return runDaxIndexerJson<ImportsResult>("imports", { cache_dir: cacheDir, file }, options)
}

export async function dumpIndex(cacheDir: string, options?: DaxIndexerOptions): Promise<DaxIndex> {
  return runDaxIndexerJson<DaxIndex>("dump", { cache_dir: cacheDir, format: "json" }, options)
}

export async function dumpIndexTree(cacheDir: string, options?: DaxIndexerOptions): Promise<string> {
  return runDaxIndexerText("dump", { cache_dir: cacheDir, format: "tree" }, options)
}

export async function getRelevantFiles(
  request: { repoRoot: string; query: string; limit?: number; touched?: string[]; cacheDir?: string; projectId?: string },
  options?: DaxIndexerOptions,
): Promise<RelevanceHit[]> {
  const repoRoot = path.resolve(request.repoRoot)
  const cacheDir = request.cacheDir ?? indexCacheDir({ repoRoot, projectId: request.projectId })
  await buildIndex({ repoRoot, cacheDir, projectId: request.projectId }, options)
  return queryIndex(
    cacheDir,
    {
      keywords: [request.query],
      touchedFiles: request.touched,
      limit: request.limit,
    },
    options,
  )
}
