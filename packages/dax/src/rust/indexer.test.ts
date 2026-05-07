import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { buildIndex, dumpIndex, dumpIndexTree, getImports, getRelevantFiles, getSymbols, queryIndex } from "./indexer"

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dax-indexer-ts-"))
  fs.mkdirSync(path.join(dir, "src"), { recursive: true })
  fs.mkdirSync(path.join(dir, "crates/demo/src"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "src/approval.ts"),
    `
import { Store } from "./store"
export interface ApprovalRequest { id: string }
export function createApproval(request: ApprovalRequest) { return request.id }
const localOnly = new Store()
`,
  )
  fs.writeFileSync(
    path.join(dir, "src/store.ts"),
    `
export class Store {}
`,
  )
  fs.writeFileSync(
    path.join(dir, "crates/demo/src/lib.rs"),
    `
pub struct LedgerEntry;
pub fn append_entry() {}
use std::path::PathBuf;
`,
  )
  return {
    repoRoot: dir,
    cacheDir: path.join(dir, ".cache", "index"),
  }
}

describe("dax-indexer Rust adapter", () => {
  test(
    "builds an index and queries relevant files",
    async () => {
      const { repoRoot, cacheDir } = fixture()
      const build = await buildIndex({ repoRoot, cacheDir, projectId: "fixture" })

      expect(build.schema_version).toBe("dax.indexer.index.v1")
      expect(build.files_indexed).toBe(3)

      const hits = await queryIndex(cacheDir, { keywords: ["approval store"], limit: 3 })
      expect(hits[0].path).toBe("src/approval.ts")
      expect(hits.map((hit) => hit.path)).toContain("src/store.ts")
    },
    60_000,
  )

  test(
    "returns symbols and imports for an indexed file",
    async () => {
      const { repoRoot, cacheDir } = fixture()
      await buildIndex({ repoRoot, cacheDir })

      const symbols = await getSymbols(cacheDir, "src/approval.ts")
      expect(symbols.map((symbol) => symbol.name)).toContain("ApprovalRequest")
      expect(symbols.map((symbol) => symbol.name)).toContain("createApproval")

      const imports = await getImports(cacheDir, "src/approval.ts")
      expect(imports.imports[0]?.from).toBe("./store")
      expect(imports.importers).toEqual([])
    },
    60_000,
  )

  test(
    "dumps the cached index",
    async () => {
      const { repoRoot, cacheDir } = fixture()
      await buildIndex({ repoRoot, cacheDir, excludes: ["ignored/"] })

      const index = await dumpIndex(cacheDir)
      expect(index.schema_version).toBe("dax.indexer.index.v1")
      expect(index.files.some((file) => file.path === "crates/demo/src/lib.rs")).toBe(true)

      const tree = await dumpIndexTree(cacheDir)
      expect(tree).toContain("src/approval.ts")
    },
    60_000,
  )

  test(
    "getRelevantFiles builds before querying",
    async () => {
      const { repoRoot, cacheDir } = fixture()
      const hits = await getRelevantFiles({ repoRoot, cacheDir, query: "LedgerEntry", limit: 1 })

      expect(hits[0].path).toBe("crates/demo/src/lib.rs")
    },
    60_000,
  )
})
