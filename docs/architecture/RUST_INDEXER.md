# Rust Indexer — `dax-indexer`

**Status:** Phase 1 implemented.

This document tracks the implemented Phase 1 surface and remaining roadmap. See [`RUST_PROOF_LADDER.md`](./RUST_PROOF_LADDER.md) for the broader Rust strategy and [`RUST_CORE_BOUNDARY.md`](./RUST_CORE_BOUNDARY.md) for the TS↔Rust split.

## Purpose

`dax-indexer` is a Rust sidecar that produces structured, compressed views of a local codebase. It builds a static index: file tree, exported symbols per file, import edges, definition locations, and structural relevance hints that DAX can query before deciding which files to read.

This is not a semantic index. There are no embeddings, no vector search, no LLM calls. It is a deterministic, fast, language-aware structural index built on `tree-sitter`.

## Architecture boundary

`RUST_CORE_BOUNDARY.md` already lists repo indexing and structured context extraction as Rust-owned work. That makes `dax-indexer` a strong Rust fit: indexing is deterministic, performance-sensitive, replayable against a fixed tree, and easy to validate with fixtures.

The boundary still matters:

- TypeScript owns project identity, project root selection, CLI/TUI integration, MCP/ACP surfaces, permission prompts, and prompt assembly.
- Rust owns deterministic extraction and structural scoring from an explicit repo root and explicit include/exclude rules.
- `dax-indexer` does not replace the existing external `codesearch` tool, which searches third-party API/library documentation.
- `dax-indexer` does not replace LSP. LSP remains the live semantic layer for hover, diagnostics, references, implementations, and language-server-specific intelligence.
- Index results are advisory. DAX still chooses which files to read through existing tool and permission paths.
- The indexer must respect DAX's project boundary, repo ignore files, and sensitive-path policy before paths or symbol names are surfaced to a model.

The Phase 1 implementation updates `crates/README.md`, ships a `dax-indexer` sidecar, and exposes a typed TS adapter in `packages/dax/src/rust/indexer.ts`.

## Why this matters

Every agent CLI hits the same wall: context window economics. Sending whole files into the prompt is wasteful, slow, and expensive. The agent ends up reading the same files repeatedly across turns because nothing remembers the structural shape of the repo.

| Problem | Without indexer | With indexer |
| --- | --- | --- |
| "Where is `foo` defined?" | grep + read multiple files | one query returns file:line |
| "What does this module export?" | read the file | one query returns the symbol list |
| "Which files import `X`?" | recursive grep, slow on large repos | one query returns the dependency edges |
| "Which 5 files are most relevant to query Y?" | LLM reads the tree and guesses | scored shortlist from the index |
| Cold-start cost on a new repo | LLM reads ~20 files to orient | LLM reads the index summary (~1 page) and asks for specific files |

The leverage is real if it is integrated carefully. This capability should reduce DAX's per-task token cost while keeping the existing read/search permission model intact.

## Implemented crate layout

```
crates/
├── dax-indexer/             # library
│   ├── src/
│   │   └── lib.rs           # index model, build/cache/query/extraction
└── dax-indexer-bin/         # sidecar binary
    └── src/main.rs          # commands: build | query | symbols | imports | dump
```

## Supported languages (Phase 1)

| Language | Grammar | What's extracted |
| --- | --- | --- |
| TypeScript / TSX | `tree-sitter-typescript` | exported declarations, default exports, interfaces, types, enums, imports |
| JavaScript / JSX | `tree-sitter-javascript` | exports (CJS + ESM), imports, top-level functions/classes |
| Rust | `tree-sitter-rust` | `pub` items, mod tree, use statements, impl blocks |

Phase 2 adds Python, Go. Phase 3 considers Markdown headings (for docs) and JSON paths (for config).

## On-disk format

Index data should live under DAX's cache directory, not state: `${Global.Path.cache}/index/<project-id>/index.json` plus `<project-id>/files/<file-hash>.json` per file. `project-id` should come from `Project.Info.id` when available, with a path hash fallback for non-git projects. TypeScript owns that resolution and passes the explicit cache path to the sidecar.

```json
{
  "schema_version": "dax.indexer.index.v1",
  "project_id": "<Project.Info.id>",
  "repo_root": "/abs/path/to/repo",
  "generated_at": "2026-05-07T10:00:00.000Z",
  "language_versions": {
    "javascript": "tree-sitter-javascript:0.25",
    "rust": "tree-sitter-rust:0.24",
    "typescript": "tree-sitter-typescript:0.23"
  },
  "exclude_fingerprint": "sha256:...",
  "files": [
    {
      "path": "packages/dax/src/foo.ts",
      "lang": "typescript",
      "content_hash": "sha256:...",
      "mtime_ns": 1730000000000000000,
      "symbols": [
        { "name": "Foo", "kind": "class", "exported": true, "line": 12, "col": 0 },
        { "name": "fooHelper", "kind": "function", "exported": false, "line": 45, "col": 4 }
      ],
      "imports": [
        { "from": "./bar", "names": ["Bar", "BarOptions"], "line": 3 }
      ]
    }
  ]
}
```

The cache is derived data and must never be committed. It stores paths, symbol names, import specifiers, and locations, but not source bodies. Paths and symbol names can still reveal sensitive information, so default excludes must cover `.git`, `.dax`, dependency/vendor directories, env files, key files, and other paths already elevated by DAX's permission-risk rules.

## Public Rust API

```rust
pub struct Index { /* ... */ }

impl Index {
    pub fn build(repo_root: &Path, opts: &BuildOptions) -> Result<Self, IndexError>;
    pub fn load(cache_dir: &Path) -> Result<Self, IndexError>;
    pub fn save(&self, cache_dir: &Path) -> Result<(), IndexError>;

    pub fn files(&self) -> &[FileEntry];
    pub fn symbols(&self, file: &str) -> &[Symbol];
    pub fn definitions(&self, name: &str) -> Vec<Definition>;
    pub fn importers(&self, file: &str) -> Vec<String>;
    pub fn imports_report(&self, file: &str) -> ImportsReport;
    pub fn relevance(&self, query: &Query, limit: usize) -> Vec<RelevanceHit>;
}

pub struct Query {
    pub keywords: Vec<String>,
    pub touched_files: Vec<String>,   // for "near my recent edits"
    pub filter_lang: Option<Language>,
}

pub struct RelevanceHit {
    pub path: String,
    pub score: f32,
    pub reasons: Vec<String>,    // "symbol match: Foo", "imports ./bar"
}
```

## Sidecar JSON contract

| Command | Stdin | Stdout |
| --- | --- | --- |
| `dax-indexer build` | `{ "repo_root": "...", "cache_dir": "...", "force": false, "excludes": [...] }` | `{ "files_indexed": N, "duration_ms": M, "cache_dir": "..." }` |
| `dax-indexer query` | `{ "cache_dir": "...", "keywords": [...], "touched_files": [...], "limit": 10 }` | `{ "hits": [<RelevanceHit>] }` |
| `dax-indexer symbols` | `{ "cache_dir": "...", "file": "..." }` | `{ "symbols": [<Symbol>] }` |
| `dax-indexer imports` | `{ "cache_dir": "...", "file": "..." }` | `{ "imports": [...], "importers": [...] }` |
| `dax-indexer dump` | `{ "cache_dir": "...", "format": "json" \| "tree" }` | full index or human-readable tree |

## TypeScript bridge

`packages/dax/src/rust/indexer.ts`

```typescript
export async function buildIndex(request: BuildIndexRequest): Promise<BuildIndexResult>
export async function queryIndex(cacheDir: string, query: IndexQuery): Promise<RelevanceHit[]>
export async function getSymbols(cacheDir: string, file: string): Promise<IndexedSymbol[]>
export async function getImports(cacheDir: string, file: string): Promise<ImportsResult>
export async function dumpIndex(cacheDir: string): Promise<DaxIndex>
export async function dumpIndexTree(cacheDir: string): Promise<string>
export async function getRelevantFiles(request: {
  repoRoot: string
  query: string
  limit?: number
  touched?: string[]
  cacheDir?: string
  projectId?: string
}): Promise<RelevanceHit[]>
```

The high-level `getRelevantFiles` is what DAX uses to enrich likely target files before choosing specific read/search operations. Lower-level functions are for tools, MCP integrations, and future Soothsayer surfaces.

Runtime integration into DAX's intent context-selection loop remains behind an explicit flag:

```typescript
const INDEXER_ENABLED = process.env.DAX_INDEXER === "1" || process.env.DAX_INDEXER === "true"
```

When the flag is off, DAX keeps using the current prompt-hint, ripgrep, LSP, and MCP paths. When the flag is on, `refineIntent` calls `getRelevantFiles`, merges structural hits into `targetFiles`, and records indexer availability in `contextSignals`. If the sidecar is missing or the cache cannot be built, DAX records a clear indexer-unavailable signal and continues with the non-indexer planning path.

## Test strategy

| Layer | Coverage |
| --- | --- |
| Rust unit (`cargo test -p dax-indexer`) | Fixture mini-repo spanning TS and Rust; build, relevance, save/load |
| TS bridge (`packages/dax/src/rust/indexer.test.ts`) | End-to-end build + query round-trip on the fixture repo |
| Intent integration (`packages/dax/src/intent/interpret.test.ts`) | `DAX_INDEXER=1` enriches likely targets from structural relevance |
| Eval scenario (`evals/scenarios/indexer_extracts_symbols.json`) | Smoke suite: fixture repo, expect symbol set per file |
| Eval scenario (`evals/scenarios/indexer_relevance_top_3.json`) | Smoke suite: known query, expect specific top-3 file ranking |

## Phased delivery

| Phase | Scope | Shippable signal |
| --- | --- | --- |
| 1 | TypeScript/TSX, JavaScript/JSX, and Rust support. File tree + exports + imports. Cache layer. CLI commands. TS bridge. Two eval scenarios in CI. | Implemented. `dax-indexer build/query/symbols/imports/dump` work through Rust and TS tests. |
| 2 | Wire `getRelevantFiles` into DAX's local repo context-selection path behind `DAX_INDEXER=1`. | Implemented. Intent refinement can merge structural relevance hits into likely targets. |
| 2b | Add Python and Go. Improve relevance: import-graph distance, recency boost from `touched_files`. | Agent visibly reads fewer irrelevant files per task; token usage on cold-start tasks drops. |
| 3 | Incremental indexing on file change (via existing `@parcel/watcher` integration). Live updates without full rebuild. | Index stays warm across edits; rebuild cost amortizes to per-changed-file. |

Phase 1 is the minimum shippable cut and the most leverage per line of code.

## Non-goals

- **No semantic understanding.** No embeddings, no vector search, no LLM-assisted ranking. Relevance is structural (symbol match, import distance, path match). LLM-assisted ranking is a separate future product layer.
- **No cross-language symbol resolution.** A TS file calling into a Rust crate via FFI is two graphs, not one. Each language is its own world.
- **No fuzzy matching at the grammar level.** Tree-sitter parses; we do not attempt to recover from broken syntax beyond what the grammar tolerates. Files that fail to parse are flagged and skipped.
- **No real-time watch in v1.** Phase 1 is "build on demand or on cache miss". Watch mode is Phase 3.
- **No custom IR.** We extract from `tree-sitter` parse trees directly; no intermediate representation, no semantic analysis pass.
- **No replacement for external documentation search.** `codesearch` remains the tool for APIs, libraries, SDKs, and internet-backed examples.
- **No replacement for LSP.** The indexer is a cold/warm structural map; LSP is still the live semantic service.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Tree-sitter grammar drift between releases | Pin grammar versions in `Cargo.toml`; record in `language_versions` field of every index for easy invalidation. |
| Index staleness vs. fast file changes | Cache is keyed on `(content_hash, mtime_ns)` per file; rebuild affected files only. Hash mismatch triggers a re-extract. |
| Massive repos (>10k files) bloat the index | Lazy load: keep a slim top-level index in memory and demand-load per-file detail. Phase 1 measures; Phase 2 optimizes. |
| Symbol naming collisions across files | Disambiguate by path. `definitions(name)` returns all matches with locations. |
| Privacy: index leaks sensitive metadata | Index stores no source code, but paths and symbol names still matter. Respect repo ignore rules and DAX sensitive-path exclusions before caching or surfacing entries. |
| Build time on first run is slow on large repos | Parallel parse via `rayon`. Phase 1 target: ≤2s for 1k files on a typical dev laptop. |
| Stale project identity or cache collisions | TypeScript passes a cache path derived from `Project.Info.id`, with schema version and exclude fingerprint included in the index metadata. |

## Relationship to other crates

| Crate | Relationship |
| --- | --- |
| `dax-core` | independent; no integration in Phase 1 |
| `dax-policy` | independent; future: `dax-policy` could consult the index to classify "is this path part of the project surface?" |
| `dax-audit` | independent |
| `dax-ledger` | independent |
| `dax-storage` | independent candidate. Future: index cache could move to SQLite if filesystem cache becomes a measured bottleneck. |

The indexer stands alone. It is one of the strongest Rust investments because it has no dependencies on the runtime/policy/audit triad and it directly improves DAX's local-codebase ergonomics.

## Out-of-scope follow-ups (track elsewhere)

- Symbol-level diffing across commits (track API surface changes over time)
- Index-aware approval policies (`dax-policy` consults the index to decide if a path is "project code" vs. "vendored deps")
- LSP-style hover and definition provider exposed via MCP
- Embedding layer for semantic search (a different problem; build only after structural index is well-used)

## Decision log

- **Tree-sitter for the cold structural map** — LSP requires a running language server per language; tree-sitter is in-process, fast, deterministic, and language-bundled. LSP remains the live semantic complement.
- **JSON cache over SQLite** — Phase 1 doesn't need transactions or concurrent writers. JSON is debuggable and grep-able. Migrate to `dax-storage` if profiling shows JSON I/O is the bottleneck.
- **Per-file cache files over one big index file** — incremental rebuild only writes the changed files; easier on filesystems and on git diff if the cache ever lands in version control (it won't, but the option stays open).
- **Structural relevance only in Phase 1** — a working structural index outperforms a broken semantic one. We can always add embeddings later; we cannot easily remove them once they're in production.
- **Separate sidecar binary** — consistent with `dax-core`, `dax-policy`, `dax-audit`. No FFI, no NAPI, no WASM in the dev loop.
